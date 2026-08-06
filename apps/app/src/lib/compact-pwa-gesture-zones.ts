/**
 * The installed compact app reserves a narrow, native-style leading edge for
 * opening global navigation. Swipes that begin beyond it belong to the
 * workspace surface instead.
 */
export const COMPACT_PWA_SIDEBAR_EDGE_SWIPE_PX = 28;

export function isCompactPwaSidebarEdgeSwipe(startX: number): boolean {
  return startX >= 0 && startX <= COMPACT_PWA_SIDEBAR_EDGE_SWIPE_PX;
}
