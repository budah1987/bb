import {
  countThreadRecapTriggers,
  getLatestThreadSequence,
  getThreadNotes,
  setThreadRecap,
} from "@bb/db";
import type { Thread } from "@bb/domain";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { generateThreadRecap } from "./recap-generation.js";

type RecapAutoTriggerDeps = Pick<AppDeps, "db" | "hub" | "config"> &
  LoggedWorkSessionDeps;

/**
 * How many completed turns pass before a recap regenerates on cadence alone.
 * This is the floor that guarantees a recap eventually refreshes even when a
 * thread produces no salient events at all.
 */
export const RECAP_TURN_CADENCE = 4;

/**
 * Minimum wall time between automatic regenerations. The turn cadence bounds
 * how often a recap goes stale; this bounds how often a burst of fast turns can
 * bill for inference. Both must pass.
 */
export const RECAP_AUTO_MIN_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Threads with a recap generation in flight right now. Automatic triggers fire
 * from event ingestion, which can process several turn completions back to
 * back, and a recap takes seconds — without this a burst starts several
 * overlapping generations that all write the same row.
 *
 * Process-local on purpose: it guards concurrency inside one server, and a
 * second server racing here would waste one inference call, not corrupt state
 * (the last write wins and every recap is regenerable).
 */
const inFlightThreadIds = new Set<string>();

export function isRecapGenerationInFlight(threadId: string): boolean {
  return inFlightThreadIds.has(threadId);
}

export interface RecapCooldownArgs {
  generatedAt: number | null;
  intervalMs: number;
  now: number;
}

/** True when the last generation is recent enough that another should wait. */
export function isWithinRecapCooldown(args: RecapCooldownArgs): boolean {
  if (args.generatedAt === null) return false;
  return args.now - args.generatedAt < args.intervalMs;
}

export interface ShouldAutoGenerateRecapArgs {
  completedTurns: number;
  generatedAt: number | null;
  hasRecap: boolean;
  now: number;
  recapEnabled: boolean;
  recapSourceSeq: number | null;
  maxSeq: number;
  salientEvents: number;
}

export type RecapAutoSkipReason =
  | "cooldown"
  | "no-new-events"
  | "not-enabled"
  | "waiting-for-cadence";

export type ShouldAutoGenerateRecapDecision =
  | { generate: true }
  | { generate: false; reason: RecapAutoSkipReason };

/**
 * The whole automatic-recap policy, as a pure function so it can be tested
 * without an event stream or a model.
 *
 * Order matters: the cheapest and most decisive checks run first, and the gate
 * that stops threads nobody reads from ever costing anything runs before all of
 * them.
 */
export function shouldAutoGenerateRecap(
  args: ShouldAutoGenerateRecapArgs,
): ShouldAutoGenerateRecapDecision {
  // The gate. A recap is only worth generating for a thread whose recap someone
  // has actually opened; otherwise every active thread in bb pays a recurring
  // inference tax for prose no one reads.
  if (!args.recapEnabled) {
    return { generate: false, reason: "not-enabled" };
  }
  // A recap that already reflects the newest event is current by definition.
  if (args.hasRecap && args.recapSourceSeq === args.maxSeq) {
    return { generate: false, reason: "no-new-events" };
  }
  if (
    isWithinRecapCooldown({
      generatedAt: args.generatedAt,
      intervalMs: RECAP_AUTO_MIN_INTERVAL_MS,
      now: args.now,
    })
  ) {
    return { generate: false, reason: "cooldown" };
  }
  // A thread whose recap was enabled but never generated should get one at the
  // next turn rather than waiting out the full cadence.
  if (!args.hasRecap) {
    return { generate: true };
  }
  if (
    args.completedTurns >= RECAP_TURN_CADENCE ||
    args.salientEvents > 0
  ) {
    return { generate: true };
  }
  return { generate: false, reason: "waiting-for-cadence" };
}

export interface MaybeGenerateThreadRecapArgs {
  thread: Thread;
}

/**
 * Called on root turn completion. Decides cheaply, then generates in the
 * background — event ingestion must never block on inference.
 */
export function maybeGenerateThreadRecapInBackground(
  deps: RecapAutoTriggerDeps,
  args: MaybeGenerateThreadRecapArgs,
): void {
  const threadId = args.thread.id;
  if (inFlightThreadIds.has(threadId)) return;

  const notes = getThreadNotes(deps.db, threadId);
  // Cheapest possible exit for the common case: a thread whose recap has never
  // been opened costs one indexed read per turn and nothing else.
  if (!notes.recapEnabled) return;

  const maxSeq = getLatestThreadSequence(deps.db, { threadId });
  const sinceSeq = notes.recapSourceSeq ?? 0;
  const counts = countThreadRecapTriggers(deps.db, { sinceSeq, threadId });
  const decision = shouldAutoGenerateRecap({
    completedTurns: counts.completedTurns,
    generatedAt: notes.recapGeneratedAt,
    hasRecap: notes.recapBody !== null,
    maxSeq,
    now: Date.now(),
    recapEnabled: notes.recapEnabled,
    recapSourceSeq: notes.recapSourceSeq,
    salientEvents: counts.salientEvents,
  });
  if (!decision.generate) return;

  inFlightThreadIds.add(threadId);
  void (async () => {
    try {
      const outcome = await generateThreadRecap(deps, {
        maxSeq,
        thread: args.thread,
      });
      if (!outcome.recap) return;
      setThreadRecap(deps.db, {
        recapBody: outcome.recap,
        recapSourceSeq: maxSeq,
        threadId,
      });
      deps.hub.notifyThread(threadId, ["notes-changed"]);
    } catch (error) {
      // A recap is an assist, never a reason to surface an error to the user or
      // to disturb turn completion. The previous recap stays in place.
      deps.logger.warn(
        { threadId, ...runtimeErrorLogFields(deps.config, error) },
        "[recap] Automatic recap generation failed",
      );
    } finally {
      inFlightThreadIds.delete(threadId);
    }
  })();
}
