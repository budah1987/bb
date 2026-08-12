import { describe, expect, it } from "vitest";
import { jitterRetryDelay } from "../src/retry-delay.js";

describe("jitterRetryDelay", () => {
  it("spreads retries below the exponential delay", () => {
    expect(jitterRetryDelay(1_000, () => 0)).toBe(800);
    expect(jitterRetryDelay(1_000, () => 0.5)).toBe(900);
    expect(jitterRetryDelay(1_000, () => 1)).toBe(1_000);
  });
});
