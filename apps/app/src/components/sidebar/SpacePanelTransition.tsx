import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./SpacePanelTransition.css";

type PageId = "1" | "2";

export type SpacePanelDirection = -1 | 1;

interface OutgoingPage {
  children: ReactNode;
  pageId: PageId;
  spaceId: string;
}

interface TransitionState {
  activePageId: PageId;
  currentPageId: PageId;
  outgoing: OutgoingPage | null;
}

const DEFAULT_TRANSITION_DURATION_MS = 250;

function readDurationMs(element: HTMLElement): number {
  const value = getComputedStyle(element)
    .getPropertyValue("--page-slide-dur")
    .trim();
  if (value.endsWith("ms")) {
    return Number.parseFloat(value) || DEFAULT_TRANSITION_DURATION_MS;
  }
  if (value.endsWith("s")) {
    return Number.parseFloat(value) * 1000 || DEFAULT_TRANSITION_DURATION_MS;
  }
  return DEFAULT_TRANSITION_DURATION_MS;
}

export function SpacePanelTransition({
  activeSpaceId,
  children,
  direction,
}: {
  activeSpaceId: string;
  children: ReactNode;
  direction: SpacePanelDirection;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const currentChildrenRef = useRef(children);
  const currentSpaceIdRef = useRef(activeSpaceId);
  const frameRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const [transition, setTransition] = useState<TransitionState>({
    activePageId: "1",
    currentPageId: "1",
    outgoing: null,
  });

  const cancelPendingTransition = () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  useLayoutEffect(() => {
    if (activeSpaceId === currentSpaceIdRef.current) {
      currentChildrenRef.current = children;
      return;
    }

    cancelPendingTransition();
    const outgoingPageId: PageId = direction === 1 ? "1" : "2";
    const incomingPageId: PageId = direction === 1 ? "2" : "1";
    const outgoing: OutgoingPage = {
      children: currentChildrenRef.current,
      pageId: outgoingPageId,
      spaceId: currentSpaceIdRef.current,
    };

    currentChildrenRef.current = children;
    currentSpaceIdRef.current = activeSpaceId;
    setTransition({
      activePageId: outgoingPageId,
      currentPageId: incomingPageId,
      outgoing,
    });

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTransition({
        activePageId: incomingPageId,
        currentPageId: incomingPageId,
        outgoing: null,
      });
      return;
    }

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setTransition((current) => ({
        ...current,
        activePageId: incomingPageId,
      }));
      const duration = containerRef.current
        ? readDurationMs(containerRef.current)
        : DEFAULT_TRANSITION_DURATION_MS;
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        setTransition({
          activePageId: incomingPageId,
          currentPageId: incomingPageId,
          outgoing: null,
        });
      }, duration);
    });
  }, [activeSpaceId, children, direction]);

  useEffect(() => cancelPendingTransition, []);

  return (
    <div
      ref={containerRef}
      className="t-page-slide min-h-0 flex-1 overflow-hidden"
      data-page={transition.activePageId}
      data-testid="space-panel-transition"
    >
      {transition.outgoing ? (
        <section
          key={transition.outgoing.spaceId}
          className="t-page flex min-h-0 flex-col"
          data-page-id={transition.outgoing.pageId}
          aria-hidden="true"
          inert
        >
          {transition.outgoing.children}
        </section>
      ) : null}
      <section
        key={activeSpaceId}
        className="t-page flex min-h-0 flex-col"
        data-page-id={transition.currentPageId}
        aria-hidden={transition.activePageId !== transition.currentPageId}
        inert={
          transition.activePageId !== transition.currentPageId
            ? true
            : undefined
        }
      >
        {children}
      </section>
    </div>
  );
}
