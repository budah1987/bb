import { describe, expect, it } from "vitest";
import { resolveRecapStaleness } from "./recap-staleness";

describe("resolveRecapStaleness", () => {
  it("reports stale once the thread moves past the recap's sequence", () => {
    expect(
      resolveRecapStaleness({ recapSourceSeq: 40, currentSeq: 41 }),
    ).toEqual({ kind: "stale" });
  });

  it("reports current at the exact sequence the recap was generated from", () => {
    expect(
      resolveRecapStaleness({ recapSourceSeq: 40, currentSeq: 40 }),
    ).toEqual({ kind: "current" });
  });

  it("does not call a recap stale when this client's view lags behind it", () => {
    // A window that has not caught up reports a lower maxSeq than the recap
    // was generated from. That is a lagging reader, not an out-of-date recap.
    expect(
      resolveRecapStaleness({ recapSourceSeq: 40, currentSeq: 39 }),
    ).toEqual({ kind: "current" });
  });

  it("never claims current while the thread's sequence is unknown", () => {
    expect(
      resolveRecapStaleness({ recapSourceSeq: 40, currentSeq: null }),
    ).toEqual({ kind: "unknown" });
  });

  it("is unknown before the first generation", () => {
    expect(
      resolveRecapStaleness({ recapSourceSeq: null, currentSeq: 12 }),
    ).toEqual({ kind: "unknown" });
  });

  it("treats sequence zero as a real sequence, not a missing one", () => {
    expect(resolveRecapStaleness({ recapSourceSeq: 0, currentSeq: 0 })).toEqual(
      {
        kind: "current",
      },
    );
    expect(resolveRecapStaleness({ recapSourceSeq: 0, currentSeq: 3 })).toEqual(
      {
        kind: "stale",
      },
    );
  });
});
