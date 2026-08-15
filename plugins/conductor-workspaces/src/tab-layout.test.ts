import { describe, expect, it } from "vitest";
import { calculateVisibleTabCount } from "./tab-layout";

describe("calculateVisibleTabCount", () => {
  it("reveals more conversation tabs as the rail widens", () => {
    expect(
      calculateVisibleTabCount({
        compact: false,
        railWidth: 500,
        threadCount: 10,
      }),
    ).toBe(3);
    expect(
      calculateVisibleTabCount({
        compact: false,
        railWidth: 1_200,
        threadCount: 10,
      }),
    ).toBe(8);
  });

  it("reserves compact space for the overflow and new-conversation controls", () => {
    expect(
      calculateVisibleTabCount({
        compact: true,
        railWidth: 390,
        threadCount: 6,
      }),
    ).toBe(2);
    expect(
      calculateVisibleTabCount({
        compact: true,
        railWidth: 320,
        threadCount: 24,
      }),
    ).toBe(2);
    expect(
      calculateVisibleTabCount({
        compact: true,
        railWidth: 280,
        threadCount: 24,
      }),
    ).toBe(1);
  });

  it("uses stable defaults before the rail has been measured", () => {
    expect(
      calculateVisibleTabCount({
        compact: false,
        railWidth: null,
        threadCount: 8,
      }),
    ).toBe(5);
    expect(
      calculateVisibleTabCount({
        compact: true,
        railWidth: null,
        threadCount: 8,
      }),
    ).toBe(2);
  });
});
