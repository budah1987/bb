const DEFAULT_DESKTOP_TAB_COUNT = 5;
const DEFAULT_COMPACT_TAB_COUNT = 2;
const DESKTOP_TAB_TARGET_WIDTH_PX = 128;
const COMPACT_TAB_TARGET_WIDTH_PX = 112;
const RAIL_PADDING_PX = 12;
const MORE_TRIGGER_WIDTH_PX = 56;
const DESKTOP_NEW_CONVERSATION_WIDTH_PX = 100;
const COMPACT_NEW_CONVERSATION_WIDTH_PX = 40;

interface VisibleTabCountOptions {
  compact: boolean;
  railWidth: number | null;
  threadCount: number;
}

export function calculateVisibleTabCount({
  compact,
  railWidth,
  threadCount,
}: VisibleTabCountOptions): number {
  if (threadCount === 0) return 0;
  if (railWidth === null || railWidth <= 0) {
    return Math.min(
      threadCount,
      compact ? DEFAULT_COMPACT_TAB_COUNT : DEFAULT_DESKTOP_TAB_COUNT,
    );
  }

  const fixedWidth =
    RAIL_PADDING_PX +
    (compact
      ? COMPACT_NEW_CONVERSATION_WIDTH_PX
      : DESKTOP_NEW_CONVERSATION_WIDTH_PX);
  const tabTargetWidth = compact
    ? COMPACT_TAB_TARGET_WIDTH_PX
    : DESKTOP_TAB_TARGET_WIDTH_PX;
  const capacityWithoutOverflow = Math.max(
    1,
    Math.floor((railWidth - fixedWidth) / tabTargetWidth),
  );
  if (threadCount <= capacityWithoutOverflow) return threadCount;

  return Math.min(
    threadCount,
    Math.max(
      1,
      Math.floor(
        (railWidth - fixedWidth - MORE_TRIGGER_WIDTH_PX) / tabTargetWidth,
      ),
    ),
  );
}
