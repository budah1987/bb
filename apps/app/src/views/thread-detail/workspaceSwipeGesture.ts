import type { PaneNode } from "@/lib/split-layout";
import {
  getSwipeSelectionRoot,
  hasExpandedTextSelectionWithin,
  isInsideHorizontalScrollRegion,
} from "@/lib/swipe-gesture-targets";
import { getAdjacentPaneId } from "./splitPaneCommands";

/** Horizontal travel that declares the gesture and takes pointer capture. */
export const WORKSPACE_SWIPE_INTENT_PX = 12;
/** Distance alone commits a pane change past this share of the width. */
export const WORKSPACE_SWIPE_PANE_COMMIT_RATIO = 0.18;
/** A fling commits from this much shorter distance… */
export const WORKSPACE_SWIPE_FLING_MIN_RATIO = 0.08;
/** …when it is still travelling at least this fast, in the same direction. */
export const WORKSPACE_SWIPE_FLING_VELOCITY_PX_PER_SEC = 360;
/**
 * Both long-swipe destinations commit past this share of the width. Measured
 * on a real iPhone: a deliberate, unhurried single-stroke drag tops out
 * around 60-65% of the screen width before a thumb runs out of comfortable
 * reach. The previous value, 0.68, sat just past that ceiling, so no drag
 * ever reached it — every long swipe fell through to an ordinary pane change
 * instead. Keep this below ~0.6 with real headroom, and above
 * WORKSPACE_SWIPE_PANE_COMMIT_RATIO by enough margin that an ordinary pane
 * swipe can't cross it by accident.
 */
const WORKSPACE_SWIPE_LONG_TRAVEL_RATIO = 0.5;
/**
 * The Command Center opens on physical rightward distance only. Velocity can
 * complete a short pane swipe but must never promote one to this destination,
 * or a quick flick would replace the whole surface.
 */
export const WORKSPACE_SWIPE_COMMAND_CENTER_RATIO =
  WORKSPACE_SWIPE_LONG_TRAVEL_RATIO;
/** A deliberate leftward drag opens the current task's right panel. */
export const WORKSPACE_SWIPE_RIGHT_PANEL_RATIO =
  WORKSPACE_SWIPE_LONG_TRAVEL_RATIO;
/**
 * How recent the last movement sample must be to describe the release. A finger
 * that travelled fast and then rested is no longer flinging, so a stale sample
 * decays to zero and the release is judged on distance alone.
 */
export const WORKSPACE_SWIPE_VELOCITY_STALE_MS = 100;
export const WORKSPACE_SWIPE_SETTLE_MS = 250;
export const WORKSPACE_SWIPE_SETTLE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Marks the host so the horizontal-scroller walk stops at the surface. */
export const WORKSPACE_SWIPE_HOST_SELECTOR = "[data-workspace-swipe-host]";

const WORKSPACE_SWIPE_TEXT_EDITING_SELECTOR = [
  "input",
  "textarea",
  '[contenteditable="true"]',
].join(", ");

const WORKSPACE_SWIPE_IGNORED_SELECTOR = [
  WORKSPACE_SWIPE_TEXT_EDITING_SELECTOR,
  "select",
  '[role="slider"]',
  '[data-sidebar="panel"]',
  '[data-sidebar="trigger"]',
  // Vaul drawers and Radix overlay content own their own gestures.
  "[data-vaul-drawer]",
  "[data-vaul-no-drag]",
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  "[data-radix-popper-content-wrapper]",
  // Explicit opt-out for surfaces that need the whole horizontal axis.
  "[data-no-workspace-swipe]",
].join(", ");

/** Whether a focused target needs the browser's native text-selection axis. */
export function isWorkspaceSwipeTextEditingTarget(
  target: EventTarget | null,
): boolean {
  return (
    target instanceof Element &&
    target.closest(WORKSPACE_SWIPE_TEXT_EDITING_SELECTOR) !== null
  );
}

export type WorkspaceSwipeDirection = "left" | "right";

export function readWorkspaceSwipeDirection(
  deltaX: number,
): WorkspaceSwipeDirection | null {
  if (deltaX === 0) {
    return null;
  }
  return deltaX > 0 ? "right" : "left";
}

/** True once a move is unambiguously horizontal: the capture point. */
export function hasWorkspaceSwipeIntent(
  deltaX: number,
  deltaY: number,
): boolean {
  const absDeltaX = Math.abs(deltaX);
  return (
    absDeltaX >= WORKSPACE_SWIPE_INTENT_PX &&
    absDeltaX > Math.abs(deltaY) * 1.25
  );
}

/** True once a move is unambiguously vertical: scrolling keeps the pointer. */
export function abandonsWorkspaceSwipe(
  deltaX: number,
  deltaY: number,
): boolean {
  const absDeltaY = Math.abs(deltaY);
  return (
    absDeltaY > WORKSPACE_SWIPE_INTENT_PX && absDeltaY > Math.abs(deltaX) * 1.15
  );
}

export type WorkspaceSwipeTarget =
  | { kind: "pane"; direction: WorkspaceSwipeDirection }
  | { kind: "command-center" }
  | { kind: "right-panel" };

export type WorkspaceSwipeOutcome = WorkspaceSwipeTarget | { kind: "cancel" };

export interface WorkspaceSwipeInput {
  /** Signed horizontal travel in px; positive is rightward. */
  deltaX: number;
  /** Signed horizontal velocity in px/s; positive is rightward. */
  velocityX: number;
  /** Physical width the gesture travels across. */
  width: number;
  /** Whether a long rightward drag may open the Command Center here. */
  allowsCommandCenter: boolean;
  /** Whether a long leftward drag may open the current task's right panel. */
  allowsRightPanel: boolean;
}

/** Where a release right now would land, ignoring commit thresholds. */
export function resolveWorkspaceSwipeTarget({
  deltaX,
  width,
  allowsCommandCenter,
  allowsRightPanel,
}: Omit<WorkspaceSwipeInput, "velocityX">): WorkspaceSwipeTarget | null {
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }
  const direction = readWorkspaceSwipeDirection(deltaX);
  if (direction === null) {
    return null;
  }
  if (
    allowsCommandCenter &&
    deltaX / width >= WORKSPACE_SWIPE_COMMAND_CENTER_RATIO
  ) {
    return { kind: "command-center" };
  }
  if (
    allowsRightPanel &&
    deltaX / width <= -WORKSPACE_SWIPE_RIGHT_PANEL_RATIO
  ) {
    return { kind: "right-panel" };
  }
  return { kind: "pane", direction };
}

/** The velocity a release is judged on: the last sample, unless it is stale. */
export function readReleaseVelocity(
  velocityX: number,
  idleMsBeforeRelease: number,
): number {
  return idleMsBeforeRelease > WORKSPACE_SWIPE_VELOCITY_STALE_MS
    ? 0
    : velocityX;
}

/** The destination a release commits to, or `cancel` to restore the source. */
export function decideWorkspaceSwipe(
  input: WorkspaceSwipeInput,
): WorkspaceSwipeOutcome {
  const target = resolveWorkspaceSwipeTarget(input);
  if (target === null) {
    return { kind: "cancel" };
  }
  if (target.kind === "command-center" || target.kind === "right-panel") {
    return target;
  }
  const ratio = Math.abs(input.deltaX) / input.width;
  const isFling =
    ratio >= WORKSPACE_SWIPE_FLING_MIN_RATIO &&
    Math.abs(input.velocityX) >= WORKSPACE_SWIPE_FLING_VELOCITY_PX_PER_SEC &&
    Math.sign(input.velocityX) === Math.sign(input.deltaX);
  return ratio >= WORKSPACE_SWIPE_PANE_COMMIT_RATIO || isFling
    ? target
    : { kind: "cancel" };
}

/**
 * The pane a swipe moves to, in the workspace's persisted reading order.
 * Dragging rightward selects the pane to the right, while dragging leftward
 * selects the pane to the left. Both wrap, matching the compact tab gesture.
 */
export function resolveWorkspaceSwipePaneId(
  panes: readonly PaneNode[],
  focusedPaneId: string,
  direction: WorkspaceSwipeDirection,
): string | null {
  return getAdjacentPaneId(
    panes,
    focusedPaneId,
    direction === "right" ? 1 : -1,
  );
}

/** Position announcement for the polite live region after a commit. */
export function describeWorkspacePosition(
  panes: readonly PaneNode[],
  paneId: string,
): string | null {
  const index = panes.findIndex((pane) => pane.paneId === paneId);
  return index === -1 ? null : `Workspace ${index + 1} of ${panes.length}`;
}

/**
 * Whether the gesture must leave this pointer alone: editable and value-drag
 * controls, an expanded text selection, horizontal scrollers, sidebar and
 * overlay surfaces that own their own gestures, and explicit opt-outs.
 */
export function shouldIgnoreWorkspaceSwipeTarget(
  target: EventTarget | null,
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target.closest(WORKSPACE_SWIPE_IGNORED_SELECTOR) !== null) {
    return true;
  }
  const selectionRoot = getSwipeSelectionRoot(target);
  if (selectionRoot !== null && hasExpandedTextSelectionWithin(selectionRoot)) {
    return true;
  }
  return isInsideHorizontalScrollRegion(target, WORKSPACE_SWIPE_HOST_SELECTOR);
}
