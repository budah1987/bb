import { describe, expect, it } from "vitest";
import {
  RECAP_AUTO_MIN_INTERVAL_MS,
  RECAP_TURN_CADENCE,
  isWithinRecapCooldown,
  shouldAutoGenerateRecap,
  type ShouldAutoGenerateRecapArgs,
} from "../../src/services/threads/recap-auto-trigger.js";

const NOW = 1_800_000_000_000;

/** An enabled thread with a current recap and nothing new since. */
function baseArgs(
  overrides: Partial<ShouldAutoGenerateRecapArgs> = {},
): ShouldAutoGenerateRecapArgs {
  return {
    completedTurns: 0,
    generatedAt: NOW - RECAP_AUTO_MIN_INTERVAL_MS - 1,
    hasRecap: true,
    maxSeq: 100,
    now: NOW,
    recapEnabled: true,
    recapSourceSeq: 100,
    salientEvents: 0,
    ...overrides,
  };
}

describe("shouldAutoGenerateRecap", () => {
  it("never generates for a thread whose recap has not been opened", () => {
    // The cost gate. Without it every active thread in bb pays for inference
    // producing prose nobody reads, so it must win over every other signal.
    expect(
      shouldAutoGenerateRecap(
        baseArgs({
          completedTurns: 99,
          hasRecap: false,
          recapEnabled: false,
          recapSourceSeq: null,
          salientEvents: 5,
        }),
      ),
    ).toEqual({ generate: false, reason: "not-enabled" });
  });

  it("skips when the recap already reflects the newest event", () => {
    expect(
      shouldAutoGenerateRecap(baseArgs({ completedTurns: RECAP_TURN_CADENCE })),
    ).toEqual({ generate: false, reason: "no-new-events" });
  });

  it("waits out the cadence when only a few turns have passed", () => {
    expect(
      shouldAutoGenerateRecap(
        baseArgs({
          completedTurns: RECAP_TURN_CADENCE - 1,
          recapSourceSeq: 40,
        }),
      ),
    ).toEqual({ generate: false, reason: "waiting-for-cadence" });
  });

  it("generates once the turn cadence is reached", () => {
    expect(
      shouldAutoGenerateRecap(
        baseArgs({ completedTurns: RECAP_TURN_CADENCE, recapSourceSeq: 40 }),
      ),
    ).toEqual({ generate: true });
  });

  it("generates early on a salient event without waiting for the cadence", () => {
    expect(
      shouldAutoGenerateRecap(
        baseArgs({ completedTurns: 1, recapSourceSeq: 40, salientEvents: 1 }),
      ),
    ).toEqual({ generate: true });
  });

  it("holds off inside the cooldown even when the cadence is met", () => {
    // A burst of fast turns must not bill for a recap per turn.
    expect(
      shouldAutoGenerateRecap(
        baseArgs({
          completedTurns: RECAP_TURN_CADENCE * 3,
          generatedAt: NOW - 1_000,
          recapSourceSeq: 40,
          salientEvents: 2,
        }),
      ),
    ).toEqual({ generate: false, reason: "cooldown" });
  });

  it("generates immediately for an enabled thread that has no recap yet", () => {
    // Opening the recap on a thread enables it; the user should not have to
    // wait four more turns to see anything.
    expect(
      shouldAutoGenerateRecap(
        baseArgs({
          generatedAt: null,
          hasRecap: false,
          recapSourceSeq: null,
        }),
      ),
    ).toEqual({ generate: true });
  });
});

describe("isWithinRecapCooldown", () => {
  it("treats a never-generated recap as outside any cooldown", () => {
    expect(
      isWithinRecapCooldown({
        generatedAt: null,
        intervalMs: 10_000,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("closes the window exactly at the interval boundary", () => {
    expect(
      isWithinRecapCooldown({
        generatedAt: NOW - 10_000,
        intervalMs: 10_000,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isWithinRecapCooldown({
        generatedAt: NOW - 9_999,
        intervalMs: 10_000,
        now: NOW,
      }),
    ).toBe(true);
  });
});
