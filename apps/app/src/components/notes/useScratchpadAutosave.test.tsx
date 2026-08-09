// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  SCRATCHPAD_SAVE_DEBOUNCE_MS,
  useScratchpadAutosave,
  type ScratchpadSaveRequest,
} from "./useScratchpadAutosave";

describe("useScratchpadAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces a burst of keystrokes into one save of the final text", () => {
    const onSave = vi.fn<(request: ScratchpadSaveRequest) => void>();
    const { result } = renderHook(() =>
      useScratchpadAutosave({
        onSave,
        persistedValue: "",
        threadId: "thr_1",
      }),
    );

    act(() => {
      result.current.setDraft("a");
      result.current.setDraft("ab");
      result.current.setDraft("abc");
    });
    expect(onSave).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(SCRATCHPAD_SAVE_DEBOUNCE_MS);
    });
    expect(onSave.mock.calls).toEqual([
      [{ threadId: "thr_1", scratchpad: "abc" }],
    ]);
  });

  it("does not drop the final keystroke when the editor unmounts mid-debounce", () => {
    const onSave = vi.fn<(request: ScratchpadSaveRequest) => void>();
    const { result, unmount } = renderHook(() =>
      useScratchpadAutosave({
        onSave,
        persistedValue: "",
        threadId: "thr_1",
      }),
    );

    act(() => {
      result.current.setDraft("half a thought");
    });
    unmount();

    expect(onSave.mock.calls).toEqual([
      [{ threadId: "thr_1", scratchpad: "half a thought" }],
    ]);

    // The flushed timer must not fire a second write afterwards.
    act(() => {
      vi.advanceTimersByTime(SCRATCHPAD_SAVE_DEBOUNCE_MS);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("flushes a thread switch against the thread the text was typed into", () => {
    const onSave = vi.fn<(request: ScratchpadSaveRequest) => void>();
    const { result, rerender } = renderHook(
      ({ threadId }: { threadId: string }) =>
        useScratchpadAutosave({ onSave, persistedValue: "", threadId }),
      { initialProps: { threadId: "thr_1" } },
    );

    act(() => {
      result.current.setDraft("belongs to one");
    });
    rerender({ threadId: "thr_2" });

    expect(onSave.mock.calls).toEqual([
      [{ threadId: "thr_1", scratchpad: "belongs to one" }],
    ]);
  });

  it("adopts a newer persisted value only while nothing is pending locally", () => {
    const onSave = vi.fn<(request: ScratchpadSaveRequest) => void>();
    const { result, rerender } = renderHook(
      ({ persistedValue }: { persistedValue: string }) =>
        useScratchpadAutosave({
          onSave,
          persistedValue,
          threadId: "thr_1",
        }),
      { initialProps: { persistedValue: "" } },
    );

    rerender({ persistedValue: "from another window" });
    expect(result.current.draft).toBe("from another window");

    act(() => {
      result.current.setDraft("typing here");
    });
    // A realtime update landing mid-edit must not yank the caret's text away.
    rerender({ persistedValue: "from another window again" });
    expect(result.current.draft).toBe("typing here");
  });
});
