import { gzipSync } from "node:zlib";
import { turnScope, type ThreadEvent } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
  ungroupHostDaemonEvents,
} from "../src/session.js";

interface PayloadSize {
  gzipBytes: number;
  jsonBytes: number;
}

function payloadSize(value: unknown): PayloadSize {
  const json = JSON.stringify(value);
  return {
    gzipBytes: gzipSync(json).byteLength,
    jsonBytes: Buffer.byteLength(json),
  };
}

function event(index: number): ThreadEvent {
  return {
    type: "item/agentMessage/delta",
    threadId: "thr_payload_measurement_123456789",
    providerThreadId: "provider_payload_measurement_123456789",
    scope: turnScope("turn_payload_measurement_123456789"),
    itemId: "item_payload_measurement_123456789",
    delta: `streamed token chunk ${index} `,
  };
}

describe("daemon-to-server event payload sizes", () => {
  it("preserves event order when a thread recurs after another thread", () => {
    const envelopes: HostDaemonEventEnvelope[] = [
      {
        eventId: "00000000-0000-4000-8000-000000000001",
        threadId: "thr_a",
        event: event(1),
      },
      {
        eventId: "00000000-0000-4000-8000-000000000002",
        threadId: "thr_b",
        event: event(2),
      },
      {
        eventId: "00000000-0000-4000-8000-000000000003",
        threadId: "thr_a",
        event: event(3),
      },
    ];

    const groups = groupHostDaemonEvents(envelopes);

    expect(groups.map((group) => group.threadId)).toEqual([
      "thr_a",
      "thr_b",
      "thr_a",
    ]);
    expect(ungroupHostDaemonEvents(groups)).toEqual(envelopes);
  });

  it("records legacy-envelope and grouped sizes across representative batches", () => {
    const measurements = [1, 10, 50].map((eventCount) => {
      const events: HostDaemonEventEnvelope[] = Array.from(
        { length: eventCount },
        (_, index) => ({
          eventId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          threadId: "thr_payload_measurement_123456789",
          event: event(index),
        }),
      );
      const legacyPayload = {
        sessionId: "session_payload_measurement_123456789",
        events,
      };
      const groupedPayload = {
        sessionId: "session_payload_measurement_123456789",
        eventGroups: groupHostDaemonEvents(events),
      };
      return {
        eventCount,
        legacyEnvelope: payloadSize(legacyPayload),
        grouped: payloadSize(groupedPayload),
      };
    });

    expect(measurements).toEqual([
      {
        eventCount: 1,
        legacyEnvelope: { gzipBytes: 208, jsonBytes: 462 },
        grouped: { gzipBytes: 221, jsonBytes: 473 },
      },
      {
        eventCount: 10,
        legacyEnvelope: { gzipBytes: 289, jsonBytes: 4_044 },
        grouped: { gzipBytes: 295, jsonBytes: 3_452 },
      },
      {
        eventCount: 50,
        legacyEnvelope: { gzipBytes: 572, jsonBytes: 20_004 },
        grouped: { gzipBytes: 565, jsonBytes: 16_732 },
      },
    ]);

    for (const measurement of measurements.slice(1)) {
      expect(measurement.grouped.jsonBytes).toBeLessThan(
        measurement.legacyEnvelope.jsonBytes,
      );
    }
  });
});
