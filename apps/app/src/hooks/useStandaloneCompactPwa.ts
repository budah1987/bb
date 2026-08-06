import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useMediaQuery } from "@bb/shared-ui/hooks/use-media-query";

export const STANDALONE_DISPLAY_MODE_QUERY = "(display-mode: standalone)";

/**
 * Home-screen iOS web apps predate `(display-mode: standalone)` and report
 * their installed state through this non-standard `navigator` flag instead.
 * It is a real browser boundary, so read it defensively and narrow to a
 * boolean here rather than trusting a typed shape that no lib describes.
 */
function isLegacyIosStandalone(): boolean {
  if (typeof navigator === "undefined" || !("standalone" in navigator)) {
    return false;
  }
  return navigator.standalone === true;
}

/**
 * True only when BB runs as an installed standalone app on a compact viewport —
 * the single context whose navigation model replaces browser-tab gestures with
 * app-native ones. Safari/Chrome tabs on the same phone, and every desktop
 * surface, read false and keep their existing behavior untouched.
 *
 * Both browser signals are consulted: the standard display-mode query, and the
 * legacy iOS flag for home-screen apps that never report a display mode.
 */
export function useStandaloneCompactPwa(): boolean {
  const isCompactViewport = useIsCompactViewport();
  const isStandaloneDisplayMode = useMediaQuery(STANDALONE_DISPLAY_MODE_QUERY);
  return (
    isCompactViewport && (isStandaloneDisplayMode || isLegacyIosStandalone())
  );
}
