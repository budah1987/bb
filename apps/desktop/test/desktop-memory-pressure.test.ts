import { describe, expect, it } from "vitest";
import {
  DESKTOP_MEMORY_PRESSURE_APP_WORKING_SET_KB,
  DESKTOP_MEMORY_PRESSURE_FREE_KB,
  shouldTrimDesktopBrowserViews,
} from "../src/desktop-memory-pressure.js";

describe("desktop memory pressure", () => {
  it("trims when app memory is high", () => {
    expect(
      shouldTrimDesktopBrowserViews({
        appWorkingSetKb: DESKTOP_MEMORY_PRESSURE_APP_WORKING_SET_KB,
        freeSystemMemoryKb: 4 * 1024 * 1024,
        totalSystemMemoryKb: 16 * 1024 * 1024,
      }),
    ).toBe(true);
  });

  it("trims when system memory is low", () => {
    expect(
      shouldTrimDesktopBrowserViews({
        appWorkingSetKb: 512 * 1024,
        freeSystemMemoryKb: DESKTOP_MEMORY_PRESSURE_FREE_KB,
        totalSystemMemoryKb: 16 * 1024 * 1024,
      }),
    ).toBe(true);
  });

  it("keeps retained pages under normal memory conditions", () => {
    expect(
      shouldTrimDesktopBrowserViews({
        appWorkingSetKb: 512 * 1024,
        freeSystemMemoryKb: 4 * 1024 * 1024,
        totalSystemMemoryKb: 16 * 1024 * 1024,
      }),
    ).toBe(false);
  });
});
