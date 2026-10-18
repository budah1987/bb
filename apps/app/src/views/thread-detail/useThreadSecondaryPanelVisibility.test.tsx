// @vitest-environment jsdom

import { StrictMode, useEffect } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useThreadSecondaryPanelDrawerVisibility,
  useThreadSecondaryPanelVisibility,
  type UseThreadSecondaryPanelVisibilityArgs,
} from "./useThreadSecondaryPanelVisibility";

type VisibilityArgs = Omit<
  UseThreadSecondaryPanelVisibilityArgs,
  "drawerVisibility"
>;

function createArgs(overrides: Partial<VisibilityArgs> = {}): VisibilityArgs {
  return {
    closePersistedPanel: vi.fn(),
    isCompactViewport: true,
    isPersistedOpen: true,
    openPersistedCommitDiff: vi.fn(),
    openPersistedDiffFile: vi.fn(),
    openPersistedDiffPanel: vi.fn(),
    openPersistedHostFile: vi.fn(),
    openPersistedPanel: vi.fn(),
    openPersistedStorageFile: vi.fn(),
    openPersistedWorkspaceFile: vi.fn(),
    togglePersistedPanel: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useThreadSecondaryPanelVisibility", () => {
  it("keeps an explicitly opened compact drawer visible during Strict Mode effect replay", () => {
    let accepted = false;
    const { result, rerender } = renderHook(
      ({ threadId }) => {
        const visibility = useThreadSecondaryPanelDrawerVisibility({
          isCompactViewport: true,
          threadId,
        });
        useEffect(() => {
          if (accepted) return;
          accepted = true;
          visibility.openDrawer();
        }, [visibility]);
        return visibility;
      },
      {
        initialProps: { threadId: "thr_1" },
        wrapper: StrictMode,
      },
    );

    expect(result.current.isDrawerVisible).toBe(true);
    rerender({ threadId: "thr_2" });
    expect(result.current.isDrawerVisible).toBe(false);
  });

  it("keeps persisted compact panels closed until an interaction reveals the drawer", () => {
    const args = createArgs({
      isCompactViewport: true,
      isPersistedOpen: true,
    });
    const { result } = renderHook(() => {
      const drawerVisibility = useThreadSecondaryPanelDrawerVisibility({
        isCompactViewport: args.isCompactViewport,
        threadId: "thr_1",
      });
      return useThreadSecondaryPanelVisibility({
        ...args,
        drawerVisibility,
      });
    });

    expect(result.current.isOpen).toBe(false);

    act(() => {
      result.current.openCompactDrawer();
    });

    expect(result.current.isOpen).toBe(true);
  });

  it("opens the compact drawer after persisted panel actions", () => {
    const args = createArgs({
      isCompactViewport: true,
      isPersistedOpen: false,
    });
    const { result } = renderHook(() => {
      const drawerVisibility = useThreadSecondaryPanelDrawerVisibility({
        isCompactViewport: args.isCompactViewport,
        threadId: "thr_1",
      });
      return useThreadSecondaryPanelVisibility({
        ...args,
        drawerVisibility,
      });
    });

    act(() => {
      result.current.openHostFile({
        lineRange: null,
        path: "/tmp/log.txt",
      });
    });

    expect(args.openPersistedHostFile).toHaveBeenCalledWith({
      lineRange: null,
      path: "/tmp/log.txt",
    });
    expect(result.current.isOpen).toBe(true);
  });
});
