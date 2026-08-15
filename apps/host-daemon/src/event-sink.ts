import type { ThreadEvent } from "@bb/domain";
import { randomUUID } from "node:crypto";
import type {
  HostDaemonEventBatchResponse,
  HostDaemonEventEnvelope,
  HostDaemonRejectedEvent,
} from "@bb/host-daemon-contract";
import { normalizeCaughtError, runtimeErrorLogFields } from "./error-utils.js";
import {
  MemoryEventSinkStorage,
  type EventSinkStorage,
  type EventSinkStorageStats,
  type StoredEventSinkEntry,
} from "./event-sink-storage.js";
import type { HostDaemonLogger } from "./logger.js";
import { ServerResponseError } from "./server-client.js";

const DEFAULT_DEBOUNCE_MS = 100;

// Tripwires for noticing that delivery has stalled and the durable queue is
// growing. Delivery batches stay bounded, while queued events remain intact.
const QUEUE_DEPTH_DEBUG_THRESHOLD = 512;
const QUEUE_BYTES_DEBUG_THRESHOLD = 16 * 1024 * 1024;
const QUEUE_AGE_DEBUG_THRESHOLD_MS = 30_000;
const MAX_BATCH_EVENTS = 256;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;

export interface EventSinkInput {
  event: ThreadEvent;
  threadId: string;
}

export interface EventPostResult {
  acceptedEvents: HostDaemonEventBatchResponse["acceptedEvents"];
  rejectedEvents: HostDaemonEventBatchResponse["rejectedEvents"];
  kind: "accepted";
}

export interface CreateEventSinkOptions {
  isSessionOpen: () => boolean;
  logger: Pick<HostDaemonLogger, "debug" | "error" | "warn">;
  postEvents: (events: HostDaemonEventEnvelope[]) => Promise<EventPostResult>;
  storage?: EventSinkStorage;
}

export interface EventSink {
  emit(event: EventSinkInput): void;
  flush(): Promise<void>;
  flushRequired(): Promise<void>;
  stats(): EventSinkStorageStats;
  dispose(): Promise<void>;
}

interface RejectedEventSummary {
  eventIndex: number;
  reason: HostDaemonRejectedEvent["reason"];
  threadId: string;
}

export class EventSinkDisposedError extends Error {
  constructor() {
    super("Cannot emit to disposed event sink");
    this.name = "EventSinkDisposedError";
  }
}

function isWaitingForApprovalItemEvent(event: ThreadEvent): boolean {
  if (event.type !== "item/started" && event.type !== "item/completed") {
    return false;
  }

  if (
    event.item.type !== "commandExecution" &&
    event.item.type !== "fileChange"
  ) {
    return false;
  }

  return event.item.approvalStatus === "waiting_for_approval";
}

export function shouldFlushThreadEventImmediately(event: ThreadEvent): boolean {
  if (event.type === "turn/started" || event.type === "item/completed") {
    return true;
  }

  if (
    event.type === "turn/completed" ||
    event.type === "system/error" ||
    event.type === "system/thread/interrupted"
  ) {
    return true;
  }

  if (event.type === "provider/error") {
    return event.willRetry !== true;
  }

  return isWaitingForApprovalItemEvent(event);
}

// True when the server refused these events for what they *are*, so reposting
// them unchanged can only produce the same refusal: a malformed batch (400) or
// one carrying an event the store will never accept (409). Both answer with
// `invalid_request`.
//
// The code check is what keeps this narrow. `/session/events` also fails
// non-retryably with `unauthorized` and `inactive_session` (401), and those say
// nothing about the events themselves — the daemon must keep them queued for
// the session it is about to reopen, not discard them.
function isPermanentPostRejection(error: Error): boolean {
  return (
    error instanceof ServerResponseError &&
    !error.retryable &&
    error.code === "invalid_request"
  );
}

function summarizeRejectedEvents(
  events: readonly HostDaemonRejectedEvent[],
): RejectedEventSummary[] {
  return events.map((event) => ({
    eventIndex: event.eventIndex,
    reason: event.reason,
    threadId: event.threadId,
  }));
}

export function createEventSink(options: CreateEventSinkOptions): EventSink {
  const storage = options.storage ?? new MemoryEventSinkStorage();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;
  let disposed = false;
  let backpressureLogged = false;

  function maybeLogQueuePressure(): void {
    if (backpressureLogged) {
      return;
    }
    const stats = storage.stats();
    const queueAgeMs =
      stats.oldestCreatedAtMs === null
        ? 0
        : Date.now() - stats.oldestCreatedAtMs;
    if (
      stats.count < QUEUE_DEPTH_DEBUG_THRESHOLD &&
      stats.sizeBytes < QUEUE_BYTES_DEBUG_THRESHOLD &&
      queueAgeMs < QUEUE_AGE_DEBUG_THRESHOLD_MS
    ) {
      return;
    }
    backpressureLogged = true;
    // A stalled queue means every thread on this host is silently falling
    // behind in the UI, so this needs to be visible at the default log level.
    options.logger.warn(
      { queueAgeMs, queueBytes: stats.sizeBytes, queueDepth: stats.count },
      "Daemon event queue is backing up; delivery may be stalled",
    );
  }

  function clearScheduledFlush(): void {
    if (flushTimer === null) {
      return;
    }
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  function scheduleFlush(delayMs: number): void {
    if (disposed || flushPromise !== null) {
      return;
    }
    if (flushTimer !== null) {
      if (delayMs > 0) {
        return;
      }
      clearScheduledFlush();
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush().catch((error) => {
        options.logger.error(
          runtimeErrorLogFields(normalizeCaughtError(error)),
          "Daemon event delivery failed",
        );
      });
    }, delayMs);
  }

  // Delivers `batch` and reports how many of its leading entries no longer
  // need sending — either the server took them or they were undeliverable by
  // construction and were dropped. A count below `batch.length` means delivery
  // stopped early and the remainder is retried by a later flush.
  //
  // The server marks a rejection non-retryable when reposting the identical
  // payload can only produce the identical rejection (a turn-scoped event whose
  // turn/started it never saw, for instance, which it answers with 409). Such a
  // batch must never be retried as-is: the queue is host-wide and durable, so
  // one undeliverable event at its head would stall every thread on the machine
  // and survive a daemon restart. Bisect instead — the server appends a batch
  // in a single transaction and rolls the whole thing back when it refuses one
  // event, so nothing was committed and re-posting the halves cannot duplicate.
  // That isolates the offending events in O(log n) posts and lets the healthy
  // ones through.
  async function deliverBatch(
    batch: readonly StoredEventSinkEntry[],
  ): Promise<number> {
    let response: EventPostResult;
    try {
      response = await options.postEvents(batch.map((entry) => entry.envelope));
    } catch (error) {
      const normalized = normalizeCaughtError(error);
      if (!isPermanentPostRejection(normalized)) {
        options.logger.error(
          runtimeErrorLogFields(normalized),
          "Failed to post daemon events; will retry on the next flush",
        );
        return 0;
      }

      const [offending] = batch;
      if (batch.length === 1 && offending !== undefined) {
        options.logger.error(
          {
            ...runtimeErrorLogFields(normalized),
            eventType: offending.envelope.event.type,
            threadId: offending.envelope.threadId,
          },
          "Dropped a daemon event the server will never accept",
        );
        return 1;
      }

      const midpoint = Math.floor(batch.length / 2);
      const deliveredFromFirstHalf = await deliverBatch(
        batch.slice(0, midpoint),
      );
      if (deliveredFromFirstHalf < midpoint) {
        return deliveredFromFirstHalf;
      }
      return midpoint + (await deliverBatch(batch.slice(midpoint)));
    }

    if (response.rejectedEvents.length > 0) {
      options.logger.warn(
        {
          rejectedEvents: summarizeRejectedEvents(response.rejectedEvents),
        },
        "Server rejected daemon events",
      );
    }
    return batch.length;
  }

  async function drainQueue(): Promise<void> {
    while (storage.stats().count > 0 && !disposed && options.isSessionOpen()) {
      const batch = storage.peekBatch(MAX_BATCH_EVENTS, MAX_BATCH_BYTES);
      if (batch.length === 0) return;
      const delivered = await deliverBatch(batch);
      if (delivered > 0) {
        storage.remove(batch.slice(0, delivered));
      }
      if (storage.stats().count === 0) {
        backpressureLogged = false;
      }
      if (delivered < batch.length) {
        return;
      }
    }
  }

  async function flush(): Promise<void> {
    clearScheduledFlush();
    if (flushPromise !== null) {
      await flushPromise;
      return;
    }

    flushPromise = drainQueue();
    try {
      await flushPromise;
    } finally {
      flushPromise = null;
    }
  }

  return {
    emit(input): void {
      if (disposed) {
        throw new EventSinkDisposedError();
      }
      storage.append({
        eventId: randomUUID(),
        threadId: input.threadId,
        event: input.event,
      });
      maybeLogQueuePressure();
      scheduleFlush(
        shouldFlushThreadEventImmediately(input.event)
          ? 0
          : DEFAULT_DEBOUNCE_MS,
      );
    },
    flush,
    flushRequired: flush,
    stats: () => storage.stats(),
    async dispose(): Promise<void> {
      disposed = true;
      clearScheduledFlush();
      if (flushPromise !== null) {
        await flushPromise.catch(() => undefined);
      }
      storage.close();
    },
  };
}
