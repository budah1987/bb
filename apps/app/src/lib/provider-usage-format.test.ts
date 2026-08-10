import { describe, expect, it } from "vitest";
import { formatProviderUsageReset } from "./provider-usage-format";

describe("formatProviderUsageReset", () => {
  const now = Date.parse("2026-08-08T20:00:00.000Z");

  it("keeps near-term reset times compact", () => {
    expect(formatProviderUsageReset("2026-08-08T22:14:00.000Z", now)).toBe(
      "Resets in 2 hr 14 min",
    );
  });

  it("marks elapsed and malformed reset times without inventing a date", () => {
    expect(formatProviderUsageReset("2026-08-08T19:59:00.000Z", now)).toBe(
      "Resetting now",
    );
    expect(formatProviderUsageReset("not-a-date", now)).toBeNull();
    expect(formatProviderUsageReset(null, now)).toBeNull();
  });
});
