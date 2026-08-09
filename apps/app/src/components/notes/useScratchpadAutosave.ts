import { useCallback, useEffect, useRef, useState } from "react";

export const SCRATCHPAD_SAVE_DEBOUNCE_MS = 600;

export interface ScratchpadSaveRequest {
  threadId: string;
  scratchpad: string;
}

interface UseScratchpadAutosaveArgs {
  /** The persisted scratchpad for this thread. */
  persistedValue: string;
  onSave: (request: ScratchpadSaveRequest) => void;
  threadId: string;
}

interface UseScratchpadAutosaveResult {
  draft: string;
  setDraft: (value: string) => void;
}

/**
 * Debounced scratchpad autosave.
 *
 * Two things this must not do, and both are why the timer lives in a ref
 * rather than in an effect keyed on the draft:
 *
 * 1. **Drop the final keystroke.** Unmounting, or switching threads, flushes
 *    the pending value first — with the thread id it was typed against, not
 *    the one being switched to.
 * 2. **Fight the user.** A newer persisted value (a second window's edit
 *    arriving over realtime, or this save's own echo) is adopted only while
 *    nothing is pending locally, so an in-flight edit is never yanked out from
 *    under the caret.
 */
export function useScratchpadAutosave({
  persistedValue,
  onSave,
  threadId,
}: UseScratchpadAutosaveArgs): UseScratchpadAutosaveResult {
  const [draft, setDraftState] = useState(persistedValue);
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held in a ref so `flush` depends only on the thread id: a `flush` that
  // changed identity every render would make the flush-on-cleanup effect below
  // fire on every render and defeat the debounce entirely.
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending === null) {
      return;
    }
    pendingRef.current = null;
    onSaveRef.current({ threadId, scratchpad: pending });
  }, [threadId]);

  useEffect(() => flush, [flush]);

  useEffect(() => {
    if (pendingRef.current !== null) {
      return;
    }
    setDraftState(persistedValue);
  }, [persistedValue]);

  const setDraft = useCallback(
    (value: string) => {
      setDraftState(value);
      pendingRef.current = value;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(flush, SCRATCHPAD_SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  return { draft, setDraft };
}
