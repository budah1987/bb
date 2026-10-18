import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body";

const OPEN_OVERLAY = '[aria-haspopup][aria-expanded="true"]';
const GESTURE_THRESHOLD_PX = 24;
const GESTURE_RESET_MS = 120;

function hasWrappedText(root: HTMLElement): boolean {
  const editor = root.querySelector(".ProseMirror");
  if (!editor) return false;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let firstTop: number | undefined;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width === 0) continue;
      firstTop ??= rect.top;
      if (Math.abs(rect.top - firstTop) > 2) return true;
    }
  }
  return false;
}

/** Rest only on intentional timeline navigation, never on streamed layout changes. */
export function useScrollRestingComposer({
  composerRef,
  enabled,
  blocked,
  resetKey,
}: {
  composerRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  blocked: boolean;
  resetKey: string | number;
}) {
  const bottomAnchor = useBottomAnchoredScroll();
  const getScrollElement = bottomAnchor?.getScrollElement;
  const isAtBottom = bottomAnchor?.isAtBottom ?? true;
  const [restingFor, setRestingFor] = useState<string | number | null>(null);
  const restingRef = useRef<string | number | null>(null);
  const blockedRef = useRef(blocked);
  useLayoutEffect(() => {
    blockedRef.current = blocked;
  }, [blocked]);
  const changeResting = useCallback((next: string | number | null) => {
    if (restingRef.current === next) return;
    restingRef.current = next;
    setRestingFor(next);
  }, []);
  const expand = useCallback(() => changeResting(null), [changeResting]);

  useEffect(() => {
    const scrollArea = getScrollElement?.();
    const composer = composerRef.current;
    if (!enabled || !scrollArea?.closest("[data-floating-chat]") || !composer) {
      return;
    }
    let distance = 0;
    let lastGestureAt = 0;
    let touchY = 0;
    const canRest = () =>
      !blockedRef.current &&
      !composer.querySelector(OPEN_OVERLAY) &&
      !composer.querySelector('[role="listbox"]') &&
      !composer.querySelector(
        "[data-promptbox-zen], [data-promptbox-voice-active]",
      ) &&
      !hasWrappedText(composer);
    const rest = () => {
      if (restingRef.current !== resetKey && canRest()) changeResting(resetKey);
    };
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !(event.target instanceof Element)) return;
      // A scrolling code block or tool result owns its gesture until it hits
      // its boundary. Do not collapse while the user reads that inner surface.
      for (let node = event.target; node !== scrollArea; ) {
        const style = getComputedStyle(node);
        if (
          /auto|scroll/.test(style.overflowY) &&
          (event.deltaY < 0
            ? node.scrollTop > 0
            : node.scrollTop + node.clientHeight < node.scrollHeight - 1)
        )
          return;
        const parent = node.parentElement;
        if (!parent) return;
        node = parent;
      }
      const max = scrollArea.scrollHeight - scrollArea.clientHeight;
      if (
        max <= 0 ||
        (event.deltaY < 0
          ? scrollArea.scrollTop <= 0
          : scrollArea.scrollTop >= max - 4)
      )
        return;
      const now = performance.now();
      if (now - lastGestureAt > GESTURE_RESET_MS) distance = 0;
      lastGestureAt = now;
      distance +=
        Math.abs(event.deltaY) *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? scrollArea.clientHeight
            : 1);
      if (distance >= GESTURE_THRESHOLD_PX) rest();
    };
    const handleScroll = () => {
      if (
        scrollArea.scrollHeight -
          scrollArea.clientHeight -
          scrollArea.scrollTop <=
        4
      )
        expand();
    };
    const handleTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? 0;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? touchY;
      if (
        Math.abs(y - touchY) >= GESTURE_THRESHOLD_PX &&
        scrollArea.scrollHeight > scrollArea.clientHeight
      )
        rest();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target !== scrollArea ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing
      )
        return;
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) rest();
    };
    // Plugin pickers may open via a command while their trigger is unfocused.
    // Keep their action mounted, and expand when their owned overlay opens.
    const observer = new MutationObserver(() => {
      if (blockedRef.current || composer.querySelector(OPEN_OVERLAY)) expand();
    });
    observer.observe(composer, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "data-promptbox-resting"],
    });
    scrollArea.addEventListener("scroll", handleScroll, { passive: true });
    scrollArea.addEventListener("wheel", handleWheel, { passive: true });
    scrollArea.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    scrollArea.addEventListener("touchmove", handleTouchMove, {
      passive: true,
    });
    scrollArea.addEventListener("keydown", handleKeyDown);
    return () => {
      observer.disconnect();
      scrollArea.removeEventListener("scroll", handleScroll);
      scrollArea.removeEventListener("wheel", handleWheel);
      scrollArea.removeEventListener("touchstart", handleTouchStart);
      scrollArea.removeEventListener("touchmove", handleTouchMove);
      scrollArea.removeEventListener("keydown", handleKeyDown);
    };
  }, [composerRef, enabled, expand, changeResting, getScrollElement, resetKey]);

  return {
    isResting: restingFor === resetKey && enabled && !blocked && !isAtBottom,
    expand,
  };
}
