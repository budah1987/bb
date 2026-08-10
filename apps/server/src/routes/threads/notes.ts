import {
  enableThreadRecap,
  getLatestThreadSequence,
  getThreadNotes,
  setThreadRecap,
  setThreadScratchpad,
  type StoredThreadNotes,
} from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
  type ThreadNotesResponse,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import { isRecapGenerationInFlight } from "../../services/threads/recap-auto-trigger.js";
import { generateThreadRecap } from "../../services/threads/recap-generation.js";
import type { AppDeps } from "../../types.js";

function toResponse(stored: StoredThreadNotes): ThreadNotesResponse {
  return {
    recapBody: stored.recapBody,
    recapEnabled: stored.recapEnabled,
    recapGeneratedAt: stored.recapGeneratedAt,
    recapSourceSeq: stored.recapSourceSeq,
    scratchpad: stored.scratchpad,
  };
}

export function registerThreadNotesRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, put } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.threads;

  get(routes.notes, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(toResponse(getThreadNotes(deps.db, thread.id)));
  });

  put(routes.updateScratchpad, (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const stored = setThreadScratchpad(deps.db, {
      scratchpad: payload.scratchpad,
      threadId: thread.id,
    });
    deps.hub.notifyThread(thread.id, ["notes-changed"]);
    return context.json(toResponse(stored));
  });

  post(routes.generateRecap, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    // Asking for a recap IS the signal that this thread's recap is worth
    // maintaining, so this call is what opens the gate on automatic
    // regeneration. Idempotent, and never turned off as a side effect.
    const stored = enableThreadRecap(deps.db, thread.id);
    const maxSeq = getLatestThreadSequence(deps.db, { threadId: thread.id });

    // A generation already running for this thread would race this one to the
    // same row for the same sequence. Hand back what we have instead.
    if (isRecapGenerationInFlight(thread.id)) {
      return context.json(toResponse(stored));
    }
    // Deliberately no time-based cooldown on the explicit refresh. `force`
    // means "I disagree with this recap, try again", and the likeliest moment
    // to press it is immediately after reading a bad one — a post-generation
    // cooldown would block exactly that. The in-flight guard above is the real
    // anti-hammer: holding the button down cannot start a second generation,
    // so throughput is bounded by generation time, not by a timer.
    // A recap that already reflects every event in the thread is current by
    // definition, so the default path costs a read rather than an inference
    // call. `force` exists for the case the user disagrees with the result.
    if (
      !payload.force &&
      stored.recapBody !== null &&
      stored.recapSourceSeq === maxSeq
    ) {
      return context.json(toResponse(stored));
    }

    const outcome = await generateThreadRecap(deps, { maxSeq, thread });
    if (outcome.reason === "empty-conversation") {
      throw new ApiError(
        409,
        "thread_has_no_conversation",
        "Thread has no conversation to recap yet",
      );
    }
    if (!outcome.recap) {
      // Deliberately leaves any existing recap in place: a failed regeneration
      // should cost the user a stale recap, not their only one.
      throw new ApiError(
        503,
        "recap_unavailable",
        "Could not generate a recap for this thread",
      );
    }

    const written = setThreadRecap(deps.db, {
      recapBody: outcome.recap,
      recapSourceSeq: maxSeq,
      threadId: thread.id,
    });
    deps.hub.notifyThread(thread.id, ["notes-changed"]);
    return context.json(toResponse(written));
  });
}
