// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  STANDALONE_DISPLAY_MODE_QUERY,
  useStandaloneCompactPwa,
} from "./useStandaloneCompactPwa";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "standalone");
});

/** jsdom's polyfilled matchMedia always reports false, so drive it per test. */
function stubMatchMedia(isMatch: (query: string) => boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: isMatch(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function setLegacyIosStandaloneFlag(value: unknown) {
  Object.defineProperty(navigator, "standalone", {
    configurable: true,
    value,
  });
}

function renderCapability(isCompactViewport: boolean) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      {children}
    </CompactViewportOverrideProvider>
  );
  return renderHook(() => useStandaloneCompactPwa(), { wrapper }).result;
}

describe("useStandaloneCompactPwa", () => {
  it("is true only for an installed app on a compact viewport", () => {
    stubMatchMedia((query) => query === STANDALONE_DISPLAY_MODE_QUERY);

    expect(renderCapability(true).current).toBe(true);
    cleanup();
    // A desktop-sized standalone window keeps the pointer-driven navigation.
    expect(renderCapability(false).current).toBe(false);
  });

  it("stays false in a compact browser tab", () => {
    stubMatchMedia(() => false);

    expect(renderCapability(true).current).toBe(false);
  });

  it("falls back to the legacy iOS home-screen flag", () => {
    // Older iOS home-screen apps report no display mode at all.
    stubMatchMedia(() => false);
    setLegacyIosStandaloneFlag(true);

    expect(renderCapability(true).current).toBe(true);
  });

  it("ignores a non-boolean legacy flag instead of trusting truthiness", () => {
    stubMatchMedia(() => false);
    setLegacyIosStandaloneFlag("yes");

    expect(renderCapability(true).current).toBe(false);
  });
});
