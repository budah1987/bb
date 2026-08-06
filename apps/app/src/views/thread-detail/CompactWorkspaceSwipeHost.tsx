import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { flushSync } from "react-dom";
import { useMediaQuery } from "@bb/shared-ui/hooks/use-media-query";
import { isBlockingOverlayOpen } from "@/lib/swipe-gesture-targets";
import { isCompactPwaSidebarEdgeSwipe } from "@/lib/compact-pwa-gesture-zones";
import type { PaneContent, PaneNode } from "@/lib/split-layout";
import { CompactWorkspacePreviewSurface } from "./CompactWorkspacePreviewSurface";
import {
  abandonsWorkspaceSwipe,
  decideWorkspaceSwipe,
  describeWorkspacePosition,
  hasWorkspaceSwipeIntent,
  isWorkspaceSwipeTextEditingTarget,
  readReleaseVelocity,
  readWorkspaceSwipeDirection,
  resolveWorkspaceSwipePaneId,
  resolveWorkspaceSwipeTarget,
  shouldIgnoreWorkspaceSwipeTarget,
  WORKSPACE_SWIPE_SETTLE_EASING,
  WORKSPACE_SWIPE_SETTLE_MS,
  type WorkspaceSwipeDirection,
} from "./workspaceSwipeGesture";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** The whole standalone surface travels as one layer; both share this box. */
const SWIPE_LAYER_CLASS = "flex min-h-0 min-w-0 flex-1 flex-col p-4 md:p-5";

type SwipeDestination =
  | { kind: "pane"; paneId: string; content: PaneContent }
  | { kind: "command-center" }
  | { kind: "return"; paneId: string; content: PaneContent | null };

interface SwipePreview {
  destination: SwipeDestination;
  direction: WorkspaceSwipeDirection;
}

interface SwipeCommit {
  announcement: string | null;
  run: () => void;
}

interface SwipeSession {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  deltaX: number;
  lastX: number;
  lastTimeMs: number;
  velocityX: number;
  isDragging: boolean;
}

export interface CompactWorkspaceSwipeHostProps {
  /** The complete standalone page surface: header, body, composer, accessories. */
  children: ReactNode;
  /**
   * Identifies what the source layer is showing. Any external change — a
   * sidebar pick, a deep link, an agent-driven open — invalidates an in-flight
   * gesture, so it cancels rather than committing against stale content.
   */
  contentKey: string;
  /** Gesture-eligible panes in the workspace's persisted reading order. */
  panes: readonly PaneNode[];
  focusedPaneId: string;
  /** Whether a long rightward drag may open the Command Center from here. */
  allowsCommandCenter: boolean;
  /** Set only while this surface is a Command Center this gesture opened. */
  returnPaneId: string | null;
  onFocusPane: (paneId: string) => void;
  onOpenCommandCenter: () => void;
  onReturnFromCommandCenter: () => void;
}

function findPaneContent(
  panes: readonly PaneNode[],
  paneId: string,
): PaneContent | null {
  return panes.find((pane) => pane.paneId === paneId)?.content ?? null;
}

function isSamePreview(
  first: SwipePreview | null,
  second: SwipePreview | null,
): boolean {
  if (first === null || second === null) {
    return first === second;
  }
  if (
    first.direction !== second.direction ||
    first.destination.kind !== second.destination.kind
  ) {
    return false;
  }
  if (first.destination.kind === "pane" && second.destination.kind === "pane") {
    return first.destination.paneId === second.destination.paneId;
  }
  return true;
}

// Pointer capture is an enhancement: it keeps the gesture attached when the
// finger crosses a plugin iframe or the source unmounts. Environments without
// it (jsdom, very old WebViews) still get the window-level listeners.
function capturePointer(element: HTMLElement, pointerId: number) {
  if (typeof element.setPointerCapture === "function") {
    element.setPointerCapture(pointerId);
  }
}

function releasePointer(element: HTMLElement, pointerId: number) {
  if (
    typeof element.releasePointerCapture !== "function" ||
    (typeof element.hasPointerCapture === "function" &&
      !element.hasPointerCapture(pointerId))
  ) {
    return;
  }
  element.releasePointerCapture(pointerId);
}

function moveLayer(
  element: HTMLElement | null,
  offsetPx: number,
  settling: boolean,
) {
  if (element === null) {
    return;
  }
  element.style.transform = `translate3d(${offsetPx}px, 0, 0)`;
  element.style.transition = settling
    ? `transform ${WORKSPACE_SWIPE_SETTLE_MS}ms ${WORKSPACE_SWIPE_SETTLE_EASING}`
    : "none";
}

function clearLayer(element: HTMLElement | null) {
  if (element === null) {
    return;
  }
  element.style.transform = "";
  element.style.transition = "";
  element.style.opacity = "";
}

/**
 * The standalone-compact workspace gesture: a horizontal drag moves the whole
 * page surface — header, body, composer, and accessories together — to the
 * adjacent pane, or opens the Command Center on a long rightward drag.
 *
 * Only the source is interactive. The incoming surface is an inert shell drawn
 * from pane metadata (see CompactWorkspacePreviewSurface), and the real
 * destination mounts only once the route commits, so a drag never starts a
 * thread subscription, a plugin runtime, or a composer focus.
 */
export function CompactWorkspaceSwipeHost({
  children,
  contentKey,
  panes,
  focusedPaneId,
  allowsCommandCenter,
  returnPaneId,
  onFocusPane,
  onOpenCommandCenter,
  onReturnFromCommandCenter,
}: CompactWorkspaceSwipeHostProps) {
  const prefersReducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const hostRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const previewLayerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<SwipeSession | null>(null);
  const previewRef = useRef<SwipePreview | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  // Stamped with the content it was resolved against, so a surface that changes
  // mid-gesture drops the travelling shell on the very same render instead of
  // one effect later.
  const [previewState, setPreviewState] = useState<{
    contentKey: string;
    preview: SwipePreview;
  } | null>(null);
  const preview =
    previewState !== null && previewState.contentKey === contentKey
      ? previewState.preview
      : null;
  const [announcement, setAnnouncement] = useState("");
  const [isTextEditing, setIsTextEditing] = useState(false);
  const contentKeyRef = useRef(contentKey);
  useEffect(() => {
    contentKeyRef.current = contentKey;
  });

  const abandonGesture = () => {
    teardownRef.current?.();
    teardownRef.current = null;
    const session = sessionRef.current;
    const host = hostRef.current;
    // Hand the pointer back before dropping the session, or a captured finger
    // keeps delivering its events to a surface that no longer tracks it.
    if (session !== null && host !== null) {
      releasePointer(host, session.pointerId);
    }
    sessionRef.current = null;
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  };
  const abandonGestureRef = useRef(abandonGesture);
  useEffect(() => {
    abandonGestureRef.current = abandonGesture;
  });

  useEffect(() => () => abandonGestureRef.current(), []);

  // Content changed under the gesture (sidebar pick, deep link, agent open, a
  // pruned pane): drop the gesture and put the new surface at rest. What the
  // user now sees is committed, so nothing may still travel towards a
  // destination chosen for the previous surface.
  useEffect(() => {
    abandonGestureRef.current();
    clearLayer(sourceRef.current);
    clearLayer(previewLayerRef.current);
    previewRef.current = null;
  }, [contentKey]);

  const restLayers = () => {
    clearLayer(sourceRef.current);
    clearLayer(previewLayerRef.current);
    previewRef.current = null;
    setPreviewState(null);
  };

  const applyMotion = (deltaX: number, width: number, settling: boolean) => {
    if (prefersReducedMotion) {
      // Reduced motion keeps the behavior and drops the travelling surface:
      // the incoming shell simply states itself, quietly.
      const layer = previewLayerRef.current;
      if (layer !== null) {
        layer.style.opacity = String(Math.min(1, Math.abs(deltaX) / width));
      }
      return;
    }
    moveLayer(sourceRef.current, deltaX, settling);
    const current = previewRef.current;
    if (current !== null) {
      const entering = current.direction === "right" ? -width : width;
      moveLayer(previewLayerRef.current, deltaX + entering, settling);
    }
  };

  const afterSettle = (run: () => void) => {
    if (prefersReducedMotion) {
      run();
      return;
    }
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      run();
    }, WORKSPACE_SWIPE_SETTLE_MS);
  };

  const resolvePreview = (
    deltaX: number,
    width: number,
  ): SwipePreview | null => {
    const direction = readWorkspaceSwipeDirection(deltaX);
    if (direction === null) {
      return null;
    }
    // A gesture-opened Command Center offers exactly one move: back to the pane
    // the gesture started from. Traversal resumes from there.
    if (returnPaneId !== null) {
      return direction === "left"
        ? {
            direction,
            destination: {
              kind: "return",
              paneId: returnPaneId,
              content: findPaneContent(panes, returnPaneId),
            },
          }
        : null;
    }
    const target = resolveWorkspaceSwipeTarget({
      deltaX,
      width,
      allowsCommandCenter,
    });
    if (target === null) {
      return null;
    }
    if (target.kind === "command-center") {
      return { direction: "right", destination: target };
    }
    const paneId = resolveWorkspaceSwipePaneId(
      panes,
      focusedPaneId,
      target.direction,
    );
    if (paneId === null) {
      // Nothing to traverse to. A long rightward drag can still reach the
      // Command Center, so show its shell for the whole travel instead of
      // popping it in at the threshold.
      return allowsCommandCenter && target.direction === "right"
        ? { direction: "right", destination: { kind: "command-center" } }
        : null;
    }
    const content = findPaneContent(panes, paneId);
    return content === null
      ? null
      : {
          direction: target.direction,
          destination: { kind: "pane", paneId, content },
        };
  };

  const resolveCommit = (
    session: SwipeSession,
    current: SwipePreview,
  ): SwipeCommit | null => {
    const outcome = decideWorkspaceSwipe({
      deltaX: session.deltaX,
      // Only a finger still moving at release may fling: pausing before lifting
      // is a deliberate "not far enough", and must cancel.
      velocityX: readReleaseVelocity(
        session.velocityX,
        Date.now() - session.lastTimeMs,
      ),
      width: session.width,
      allowsCommandCenter,
    });
    const { destination } = current;
    if (
      outcome.kind === "command-center" &&
      destination.kind === "command-center"
    ) {
      return { announcement: "Command Center", run: onOpenCommandCenter };
    }
    if (outcome.kind !== "pane") {
      return null;
    }
    if (destination.kind === "pane") {
      return {
        announcement: describeWorkspacePosition(panes, destination.paneId),
        run: () => onFocusPane(destination.paneId),
      };
    }
    if (destination.kind === "return") {
      return {
        announcement: describeWorkspacePosition(panes, destination.paneId),
        run: onReturnFromCommandCenter,
      };
    }
    return null;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = hostRef.current;
    if (
      host === null ||
      event.defaultPrevented ||
      event.pointerType !== "touch" ||
      event.button !== 0 ||
      isCompactPwaSidebarEdgeSwipe(event.clientX) ||
      sessionRef.current !== null ||
      settleTimerRef.current !== null ||
      isBlockingOverlayOpen(host.ownerDocument) ||
      shouldIgnoreWorkspaceSwipeTarget(event.target)
    ) {
      return;
    }
    const startedContentKey = contentKey;

    const nowMs = Date.now();
    const session: SwipeSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      // The laid-out surface owns the physical width; the viewport is the
      // fallback for environments that report no box (jsdom, pre-layout).
      width: host.getBoundingClientRect().width || window.innerWidth,
      deltaX: 0,
      lastX: event.clientX,
      lastTimeMs: nowMs,
      velocityX: 0,
      isDragging: false,
    };
    sessionRef.current = session;

    const teardown = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerAbort);
      window.removeEventListener("lostpointercapture", onPointerAbort);
      window.removeEventListener("resize", onEnvironmentChange);
      window.removeEventListener("orientationchange", onEnvironmentChange);
      teardownRef.current = null;
    };

    const finish = (commit: boolean) => {
      if (sessionRef.current !== session) {
        return;
      }
      teardown();
      releasePointer(host, session.pointerId);
      sessionRef.current = null;

      const current = previewRef.current;
      if (!session.isDragging || current === null) {
        restLayers();
        return;
      }
      const committed = commit ? resolveCommit(session, current) : null;
      if (committed === null) {
        applyMotion(0, session.width, true);
        afterSettle(restLayers);
        return;
      }
      applyMotion(
        current.direction === "right" ? session.width : -session.width,
        session.width,
        true,
      );
      afterSettle(() => {
        restLayers();
        // The surface changed while the settle ran: the destination this gesture
        // chose no longer describes what the user is looking at.
        if (contentKeyRef.current !== startedContentKey) {
          return;
        }
        if (committed.announcement !== null) {
          setAnnouncement(committed.announcement);
        }
        committed.run();
      });
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (
        sessionRef.current !== session ||
        moveEvent.pointerId !== session.pointerId
      ) {
        return;
      }
      const deltaX = moveEvent.clientX - session.startX;
      const deltaY = moveEvent.clientY - session.startY;

      if (!session.isDragging) {
        if (abandonsWorkspaceSwipe(deltaX, deltaY)) {
          finish(false);
          return;
        }
        if (!hasWorkspaceSwipeIntent(deltaX, deltaY)) {
          return;
        }
        session.isDragging = true;
        capturePointer(host, session.pointerId);
      }

      // touch-action already reserves the horizontal axis; this also stops a
      // browser-level swipe from starting once the gesture owns the pointer.
      if (moveEvent.cancelable) {
        moveEvent.preventDefault();
      }

      const nowMs = Date.now();
      const elapsedMs = nowMs - session.lastTimeMs;
      if (elapsedMs > 0) {
        session.velocityX =
          ((moveEvent.clientX - session.lastX) / elapsedMs) * 1000;
        session.lastX = moveEvent.clientX;
        session.lastTimeMs = nowMs;
      }
      session.deltaX = deltaX;

      const nextPreview = resolvePreview(deltaX, session.width);
      if (!isSamePreview(nextPreview, previewRef.current)) {
        previewRef.current = nextPreview;
        // Mount the shell synchronously so the first frame of travel already
        // carries it, instead of flashing the empty page behind the surface.
        flushSync(() =>
          setPreviewState(
            nextPreview === null
              ? null
              : { contentKey: startedContentKey, preview: nextPreview },
          ),
        );
      }
      applyMotion(deltaX, session.width, false);
    };
    // A second finger produces its own pointer events on the same window. Only
    // the pointer that started this gesture may end it, or an unrelated tap
    // would commit or cancel the drag under the first finger.
    const isTrackedPointer = (endEvent: PointerEvent) =>
      endEvent.pointerId === session.pointerId;
    const onPointerUp = (endEvent: PointerEvent) => {
      if (isTrackedPointer(endEvent)) {
        finish(true);
      }
    };
    const onPointerAbort = (endEvent: PointerEvent) => {
      if (isTrackedPointer(endEvent)) {
        finish(false);
      }
    };
    const onEnvironmentChange = () => finish(false);

    teardownRef.current = teardown;
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerAbort);
    window.addEventListener("lostpointercapture", onPointerAbort);
    window.addEventListener("resize", onEnvironmentChange);
    window.addEventListener("orientationchange", onEnvironmentChange);
  };

  return (
    <div
      ref={hostRef}
      data-workspace-swipe-host=""
      data-workspace-swipe-text-editing={isTextEditing ? "" : undefined}
      onPointerDown={handlePointerDown}
      onFocusCapture={(event) => {
        if (isWorkspaceSwipeTextEditingTarget(event.target)) {
          setIsTextEditing(true);
        }
      }}
      onBlurCapture={(event) => {
        if (!isWorkspaceSwipeTextEditingTarget(event.target)) return;
        setIsTextEditing(
          isWorkspaceSwipeTextEditingTarget(event.relatedTarget),
        );
      }}
      // iOS's held-Space keyboard trackpad needs native horizontal selection
      // handling. Yield that axis while an editor is focused; editable pointer
      // starts are already excluded from workspace swipes above.
      style={{ touchAction: isTextEditing ? "auto" : "pan-y" }}
      // Cancels the app layout's page padding so the surface travels to the
      // real screen edges; each layer re-applies it (see SWIPE_LAYER_CLASS).
      className="relative -m-4 flex min-h-0 min-w-0 flex-1 overflow-hidden md:-m-5"
    >
      <div
        ref={sourceRef}
        data-workspace-swipe-surface="source"
        className={SWIPE_LAYER_CLASS}
      >
        {children}
      </div>
      {preview !== null ? (
        <div
          ref={previewLayerRef}
          aria-hidden
          data-workspace-swipe-surface="preview"
          className={`pointer-events-none absolute inset-0 select-none ${SWIPE_LAYER_CLASS}`}
        >
          <CompactWorkspacePreviewSurface
            content={
              preview.destination.kind === "command-center"
                ? null
                : preview.destination.content
            }
          />
        </div>
      ) : null}
      <span
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="workspace-swipe-position"
      >
        {announcement}
      </span>
    </div>
  );
}
