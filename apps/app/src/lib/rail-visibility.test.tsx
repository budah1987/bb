// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import {
  RAIL_MIN_CONTAINER_WIDTH_PX,
  useIsRailVisible,
  useRailAutoHide,
  useToggleRail,
} from "./rail-visibility";

const RAIL_VISIBLE_STORAGE_KEY = "bb.thread.railVisible";

let resizeCallbacks: ResizeObserverCallback[] = [];

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function setContainerWidth(width: number): void {
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: width,
  });
}

function emitResize(): void {
  act(() => {
    for (const callback of resizeCallbacks) {
      callback([], {} as ResizeObserver);
    }
  });
}

/**
 * Both hooks read one atom, so they must be mounted in one render. Each test
 * gets its own store: the preference atom is module-level, so a shared store
 * would leak one test's toggle into the next.
 */
/**
 * Seeds the stored preference so a test states the visibility it starts from
 * instead of inheriting the atom's default — these tests are about the
 * transitions, and must not start failing when the default changes.
 */
function seedRailVisible(visible: boolean): void {
  window.localStorage.setItem(RAIL_VISIBLE_STORAGE_KEY, String(visible));
}

function renderRail() {
  const store = createStore();
  return renderHook(
    () => {
      useRailAutoHide();
      return {
        isRailVisible: useIsRailVisible(),
        toggleRail: useToggleRail(),
      };
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    },
  );
}

describe("rail visibility", () => {
  beforeEach(() => {
    resizeCallbacks = [];
    window.localStorage.clear();
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    setContainerWidth(RAIL_MIN_CONTAINER_WIDTH_PX + 400);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides the rail and writes the preference through when the container narrows", () => {
    seedRailVisible(true);
    const { result } = renderRail();
    expect(result.current.isRailVisible).toBe(true);

    setContainerWidth(RAIL_MIN_CONTAINER_WIDTH_PX - 1);
    emitResize();

    expect(result.current.isRailVisible).toBe(false);
    expect(window.localStorage.getItem(RAIL_VISIBLE_STORAGE_KEY)).toBe("false");
  });

  it("never reveals the rail again when the container widens", () => {
    seedRailVisible(true);
    const { result } = renderRail();

    setContainerWidth(RAIL_MIN_CONTAINER_WIDTH_PX - 1);
    emitResize();
    expect(result.current.isRailVisible).toBe(false);

    setContainerWidth(RAIL_MIN_CONTAINER_WIDTH_PX + 800);
    emitResize();
    expect(result.current.isRailVisible).toBe(false);

    // Only an explicit toggle brings it back.
    act(() => {
      result.current.toggleRail();
    });
    expect(result.current.isRailVisible).toBe(true);
  });

  it("leaves a wide layout's stored preference untouched", () => {
    seedRailVisible(true);
    const { result } = renderRail();
    emitResize();
    expect(result.current.isRailVisible).toBe(true);
    expect(window.localStorage.getItem(RAIL_VISIBLE_STORAGE_KEY)).toBe("true");
  });
});
