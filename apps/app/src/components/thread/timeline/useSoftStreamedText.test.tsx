// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSoftStreamedText } from "./useSoftStreamedText.js";

let frameCallbacks: FrameRequestCallback[];
let now: number;

function runFrame(elapsedMs: number): void {
  now += elapsedMs;
  const callbacks = frameCallbacks;
  frameCallbacks = [];
  for (const callback of callbacks) {
    callback(now);
  }
}

beforeEach(() => {
  frameCallbacks = [];
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useSoftStreamedText", () => {
  it("keeps existing text fixed while it reveals appended text", () => {
    const { result, rerender } = renderHook(
      ({ text }) => useSoftStreamedText(text),
      { initialProps: { text: "Stable text" } },
    );

    rerender({ text: "Stable text with a softly revealed ending" });
    expect(result.current).toBe("Stable text");

    act(() => runFrame(32));
    expect(result.current).toMatch(/^Stable text/);
    expect(result.current.length).toBeGreaterThan("Stable text".length);
    expect(result.current).not.toBe(
      "Stable text with a softly revealed ending",
    );

    act(() => runFrame(64));
    expect(result.current).toBe("Stable text with a softly revealed ending");
  });

  it("keeps one reveal loop active across rapid provider updates", () => {
    const { result, rerender } = renderHook(
      ({ text }) => useSoftStreamedText(text),
      { initialProps: { text: "Stable" } },
    );

    rerender({ text: "Stable first chunk" });
    rerender({ text: "Stable first chunk and second chunk" });
    expect(frameCallbacks).toHaveLength(1);

    act(() => runFrame(96));
    expect(result.current).toBe("Stable first chunk and second chunk");
  });

  it("shows replacements immediately", () => {
    const { result, rerender } = renderHook(
      ({ text }) => useSoftStreamedText(text),
      { initialProps: { text: "First message" } },
    );

    rerender({ text: "A different message" });
    expect(result.current).toBe("A different message");
    expect(frameCallbacks).toHaveLength(0);
  });

  it("shows appended text immediately when reduced motion is enabled", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const { result, rerender } = renderHook(
      ({ text }) => useSoftStreamedText(text),
      { initialProps: { text: "First" } },
    );

    rerender({ text: "First second" });
    expect(result.current).toBe("First second");
    expect(frameCallbacks).toHaveLength(0);
  });
});
