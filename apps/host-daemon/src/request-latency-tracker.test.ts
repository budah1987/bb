import { describe, expect, it } from "vitest";
import { RequestLatencyTracker } from "./request-latency-tracker.js";

describe("RequestLatencyTracker", () => {
  it("reports rolling p95 and p99 after twenty samples", () => {
    const tracker = new RequestLatencyTracker();
    let result = null;
    for (let durationMs = 1; durationMs <= 20; durationMs += 1) {
      result = tracker.record({
        durationMs,
        providerId: "codex",
        runtimeWasReady: true,
        stage: "request-to-accept",
      });
    }
    expect(result).toEqual({ count: 20, p95Ms: 19, p99Ms: 20 });
  });

  it("keeps provider, runtime, and stage series separate", () => {
    const tracker = new RequestLatencyTracker();
    for (let index = 0; index < 19; index += 1) {
      tracker.record({
        durationMs: 1,
        providerId: "codex",
        runtimeWasReady: true,
        stage: "request-to-accept",
      });
    }
    expect(
      tracker.record({
        durationMs: 1,
        providerId: "claude-code",
        runtimeWasReady: true,
        stage: "request-to-accept",
      }),
    ).toBeNull();
  });
});
