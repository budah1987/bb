/**
 * Visibility state for the right rail — the narrow column pinned to the right
 * edge of the thread pane (see `components/rail/ThreadRail.tsx`).
 */
import { useAtomValue, useSetAtom } from "jotai";
import { atomFamily } from "jotai-family";
import { useCallback, useEffect } from "react";
import { createBooleanPreferenceAtom } from "./browser-storage";

const RAIL_VISIBLE_STORAGE_KEY_PREFIX = "bb.thread.railVisible";
const LEGACY_RAIL_VISIBLE_STORAGE_KEY = "bb.thread.railVisible";

export function getRailVisibleStorageKey(threadId: string): string {
  return `${RAIL_VISIBLE_STORAGE_KEY_PREFIX}.${encodeURIComponent(threadId)}`;
}

/**
 * Below this container width the rail stops paying for its own space and the
 * timeline is the thing worth keeping. This is NOT the mobile breakpoint
 * (`useIsCompactViewport`), which fires far too late for a ~280px rail sitting
 * beside a conversation and a secondary panel.
 *
 * TODO: tune against a real laptop layout with the rail rendered — the value is
 * an estimate (sidebar + a readable conversation column + the rail), not a
 * measurement.
 */
export const RAIL_MIN_CONTAINER_WIDTH_PX = 1180;

/**
 * Whether the right rail is showing. Client-local like the sidebar's other
 * layout preferences (see `sidebar/threadListProvider.ts`): this is about this
 * screen, not this account, and it must not travel to a phone.
 *
 * The state machine is deliberately one boolean:
 *   • narrowing past {@link RAIL_MIN_CONTAINER_WIDTH_PX} writes `false` through
 *     to storage — the auto-hide *is* a preference change, not a suppression.
 *   • widening does nothing. The rail never reveals itself.
 *   • the toggle button / `rail.toggle` command flips it.
 * Collapsing auto-hide into the stored value is what makes "never reveals
 * itself" fall out of a single piece of state instead of a second flag that has
 * to be kept in sync.
 */
/**
 * Shown by default. A rail nobody has heard of, defaulted off, is a rail nobody
 * finds — and "never reveals itself" is a rule about *re*-appearing after the
 * user or a narrow viewport put it away, not about the state it starts in. On a
 * viewport too narrow to afford it, `useRailAutoHide` puts it away on first
 * measure and it stays away.
 */
function legacyRailVisibleDefault(): boolean {
  if (typeof window === "undefined") return true;
  return (
    window.localStorage.getItem(LEGACY_RAIL_VISIBLE_STORAGE_KEY) !== "false"
  );
}

const railVisibleAtomFamily = atomFamily((threadId: string) =>
  createBooleanPreferenceAtom(
    getRailVisibleStorageKey(threadId),
    legacyRailVisibleDefault(),
  ),
);

export function useIsRailVisible(threadId: string): boolean {
  return useAtomValue(railVisibleAtomFamily(threadId));
}

export function useToggleRail(threadId: string): () => void {
  const setRailVisible = useSetAtom(railVisibleAtomFamily(threadId));
  return useCallback(() => {
    setRailVisible((current) => !current);
  }, [setRailVisible]);
}

/**
 * Writes the rail hidden once the app container narrows past the threshold.
 * Widening is intentionally not observed. Mounting this more than once is
 * harmless: every observer computes the same value and the write is a no-op
 * while the rail is already hidden.
 */
export function useRailAutoHide(threadId: string, enabled = true): void {
  const setRailVisible = useSetAtom(railVisibleAtomFamily(threadId));
  useEffect(() => {
    if (!enabled || typeof ResizeObserver === "undefined") {
      return;
    }
    const container = document.documentElement;
    const observer = new ResizeObserver(() => {
      if (container.clientWidth >= RAIL_MIN_CONTAINER_WIDTH_PX) {
        return;
      }
      setRailVisible((current) => (current ? false : current));
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [enabled, setRailVisible]);
}
