import { and, count, eq, gt, inArray } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { events, threadNotes } from "../schema.js";

/**
 * Event types that mean "something was decided or finished", as opposed to
 * "work happened". Goal transitions are the closest thing the event stream has
 * to a task boundary, so they let a recap regenerate on the turn a task lands
 * instead of waiting out the turn-count floor.
 *
 * This list is an accelerator, not the mechanism — the turn count is what
 * guarantees a recap eventually refreshes. Adding a type here makes recaps more
 * timely and more expensive; removing one only makes them later.
 */
const RECAP_SALIENT_EVENT_TYPES = [
  "thread/goal/updated",
  "thread/goal/cleared",
] as const;

export interface ThreadRecapTriggerCounts {
  completedTurns: number;
  salientEvents: number;
}

/**
 * Counts what has happened since the recap was generated. Both queries ride the
 * `events_thread_type_sequence_idx` covering index, so this stays cheap enough
 * to run on every root turn completion.
 */
export function countThreadRecapTriggers(
  db: DbConnection,
  args: { sinceSeq: number; threadId: string },
): ThreadRecapTriggerCounts {
  const completedTurns = db
    .select({ value: count() })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "turn/completed"),
        gt(events.sequence, args.sinceSeq),
      ),
    )
    .get();
  const salientEvents = db
    .select({ value: count() })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        inArray(events.type, [...RECAP_SALIENT_EVENT_TYPES]),
        gt(events.sequence, args.sinceSeq),
      ),
    )
    .get();
  return {
    completedTurns: completedTurns?.value ?? 0,
    salientEvents: salientEvents?.value ?? 0,
  };
}

export interface StoredThreadNotes {
  recapBody: string | null;
  recapEnabled: boolean;
  recapGeneratedAt: number | null;
  recapSourceSeq: number | null;
  scratchpad: string;
  updatedAt: number;
}

/**
 * The row a thread has before anything has ever been written to it. Returned
 * instead of null so callers never branch on existence: an untouched thread and
 * a thread with a cleared scratchpad are the same thing to every reader.
 */
export function emptyThreadNotes(): StoredThreadNotes {
  return {
    recapBody: null,
    recapEnabled: false,
    recapGeneratedAt: null,
    recapSourceSeq: null,
    scratchpad: "",
    updatedAt: 0,
  };
}

export function getThreadNotes(
  db: DbConnection,
  threadId: string,
): StoredThreadNotes {
  const row = db
    .select({
      recapBody: threadNotes.recapBody,
      recapEnabled: threadNotes.recapEnabled,
      recapGeneratedAt: threadNotes.recapGeneratedAt,
      recapSourceSeq: threadNotes.recapSourceSeq,
      scratchpad: threadNotes.scratchpad,
      updatedAt: threadNotes.updatedAt,
    })
    .from(threadNotes)
    .where(eq(threadNotes.threadId, threadId))
    .get();
  return row ?? emptyThreadNotes();
}

export function setThreadScratchpad(
  db: DbConnection,
  args: { scratchpad: string; threadId: string },
): StoredThreadNotes {
  const updatedAt = Date.now();
  db.insert(threadNotes)
    .values({
      scratchpad: args.scratchpad,
      threadId: args.threadId,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: threadNotes.threadId,
      set: { scratchpad: args.scratchpad, updatedAt },
    })
    .run();
  return getThreadNotes(db, args.threadId);
}

export function setThreadRecap(
  db: DbConnection,
  args: {
    recapBody: string;
    recapSourceSeq: number;
    threadId: string;
  },
): StoredThreadNotes {
  const now = Date.now();
  db.insert(threadNotes)
    .values({
      recapBody: args.recapBody,
      recapGeneratedAt: now,
      recapSourceSeq: args.recapSourceSeq,
      threadId: args.threadId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: threadNotes.threadId,
      set: {
        recapBody: args.recapBody,
        recapGeneratedAt: now,
        recapSourceSeq: args.recapSourceSeq,
        updatedAt: now,
      },
    })
    .run();
  return getThreadNotes(db, args.threadId);
}

/**
 * Marks the thread as one the user has actually opened the recap on, which is
 * what unlocks automatic regeneration. Idempotent, and never clears the flag —
 * turning recap generation back off is a separate deliberate action, not a
 * side effect of rendering.
 */
export function enableThreadRecap(
  db: DbConnection,
  threadId: string,
): StoredThreadNotes {
  const updatedAt = Date.now();
  db.insert(threadNotes)
    .values({ recapEnabled: true, threadId, updatedAt })
    .onConflictDoUpdate({
      target: threadNotes.threadId,
      set: { recapEnabled: true, updatedAt },
    })
    .run();
  return getThreadNotes(db, threadId);
}
