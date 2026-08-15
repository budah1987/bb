const DEFAULT_DESKTOP_TAB_COUNT = 5;
const DEFAULT_COMPACT_TAB_COUNT = 2;
const DESKTOP_TAB_TARGET_WIDTH_PX = 128;
const COMPACT_TAB_TARGET_WIDTH_PX = 96;
const RAIL_PADDING_PX = 12;
const MORE_TRIGGER_WIDTH_PX = 56;
const DESKTOP_NEW_CONVERSATION_WIDTH_PX = 40;
const COMPACT_NEW_CONVERSATION_WIDTH_PX = 44;
const COMPACT_RAIL_GAP_PX = 3;

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

  if (compact) {
    const fits = (visibleTabs: number, includesOverflow: boolean) => {
      const itemCount = visibleTabs + 1 + (includesOverflow ? 1 : 0);
      return (
        RAIL_PADDING_PX +
          COMPACT_NEW_CONVERSATION_WIDTH_PX +
          visibleTabs * COMPACT_TAB_TARGET_WIDTH_PX +
          (includesOverflow ? MORE_TRIGGER_WIDTH_PX : 0) +
          Math.max(0, itemCount - 1) * COMPACT_RAIL_GAP_PX <=
        railWidth
      );
    };
    if (fits(threadCount, false)) return threadCount;

    for (
      let visibleTabs = threadCount - 1;
      visibleTabs >= 1;
      visibleTabs -= 1
    ) {
      if (fits(visibleTabs, true)) return visibleTabs;
    }
    return 1;
  }

  const fixedWidth = RAIL_PADDING_PX + DESKTOP_NEW_CONVERSATION_WIDTH_PX;
  const tabTargetWidth = DESKTOP_TAB_TARGET_WIDTH_PX;
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
