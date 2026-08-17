// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import {
  getRailVisibleStorageKey,
  RAIL_MIN_CONTAINER_WIDTH_PX,
  useIsRailVisible,
  useRailAutoHide,
  useToggleRail,
} from "./rail-visibility";

const ACTIVE_THREAD_ID = "thr_active";
const OTHER_THREAD_ID = "thr_other";

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
function seedRailVisible(threadId: string, visible: boolean): void {
  window.localStorage.setItem(
    getRailVisibleStorageKey(threadId),
    String(visible),
  );
}

function renderRail(threadId = ACTIVE_THREAD_ID) {
  const store = createStore();
  return renderHook(
    () => {
      useRailAutoHide(threadId);
      return {
        isRailVisible: useIsRailVisible(threadId),
        toggleRail: useToggleRail(threadId),
      };
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    },
  );
}

function renderTwoThreads() {
  const store = createStore();
  return renderHook(
    () => {
      // The active conversation owns the layout observer. The other
      // conversation still reads and writes its independent preference.
      useRailAutoHide(ACTIVE_THREAD_ID, true);
      useRailAutoHide(OTHER_THREAD_ID, false);
      return {
        active: {
          isRailVisible: useIsRailVisible(ACTIVE_THREAD_ID),
          toggleRail: useToggleRail(ACTIVE_THREAD_ID),
        },
        other: {
          isRailVisible: useIsRailVisible(OTHER_THREAD_ID),
          toggleRail: useToggleRail(OTHER_THREAD_ID),
        },
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
    seedRailVisible(ACTIVE_THREAD_ID, true);
    const { result } = renderRail();
    expect(result.current.isRailVisible).toBe(true);

    setContainerWidth(RAIL_MIN_CONTAINER_WIDTH_PX - 1);
    emitResize();

    expect(result.current.isRailVisible).toBe(false);
    expect(
      window.localStorage.getItem(getRailVisibleStorageKey(ACTIVE_THREAD_ID)),
    ).toBe("false");
  });

  it("never reveals the rail again when the container widens", () => {
    seedRailVisible(ACTIVE_THREAD_ID, true);
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
    seedRailVisible(ACTIVE_THREAD_ID, true);
    const { result } = renderRail();
    emitResize();
    expect(result.current.isRailVisible).toBe(true);
    expect(
      window.localStorage.getItem(getRailVisibleStorageKey(ACTIVE_THREAD_ID)),
    ).toBe("true");
  });

  it("remembers open and closed state independently for each conversation", () => {
    seedRailVisible(ACTIVE_THREAD_ID, true);
    seedRailVisible(OTHER_THREAD_ID, false);
    const { result } = renderTwoThreads();

    expect(result.current.active.isRailVisible).toBe(true);
    expect(result.current.other.isRailVisible).toBe(false);

    act(() => {
      result.current.active.toggleRail();
      result.current.other.toggleRail();
    });

    expect(result.current.active.isRailVisible).toBe(false);
    expect(result.current.other.isRailVisible).toBe(true);
    expect(
      window.localStorage.getItem(getRailVisibleStorageKey(ACTIVE_THREAD_ID)),
    ).toBe("false");
    expect(
      window.localStorage.getItem(getRailVisibleStorageKey(OTHER_THREAD_ID)),
    ).toBe("true");
  });

  it("auto-hides only the active conversation", () => {
    seedRailVisible(ACTIVE_THREAD_ID, true);
    seedRailVisible(OTHER_THREAD_ID, true);
    const { result } = renderTwoThreads();

    setContainerWidth(RAIL_MIN_CONTAINER_WIDTH_PX - 1);
    emitResize();

    expect(result.current.active.isRailVisible).toBe(false);
    expect(result.current.other.isRailVisible).toBe(true);
    expect(
      window.localStorage.getItem(getRailVisibleStorageKey(ACTIVE_THREAD_ID)),
    ).toBe("false");
    expect(
      window.localStorage.getItem(getRailVisibleStorageKey(OTHER_THREAD_ID)),
    ).toBe("true");
  });

  it("uses the old global preference for a conversation not seen before", () => {
    window.localStorage.setItem("bb.thread.railVisible", "false");

    const { result } = renderRail("thr_legacy_migration");

    expect(result.current.isRailVisible).toBe(false);
  });
});
