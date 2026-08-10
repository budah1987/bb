import type { PaneContent } from "@/lib/split-layout";

/**
 * Tags the one history entry a standalone-compact Command Center gesture
 * pushes. The literal is deliberately specific: `location.state` is attacker-
 * and accident-reachable (deep links, restored sessions, other navigations),
 * so only a fully-shaped entry counts as the intent.
 */
export const COMMAND_CENTER_NAVIGATION_KIND =
  "standalone-compact-command-center";

export interface CommandCenterNavigation {
  kind: typeof COMMAND_CENTER_NAVIGATION_KIND;
  /** Where the return gesture goes when there is no history entry to pop. */
  returnPath: string;
  /** The pane that owned the address bar when the gesture committed. */
  returnPaneId: string;
}

export function createCommandCenterNavigation({
  returnPath,
  returnPaneId,
}: {
  returnPath: string;
  returnPaneId: string;
}): CommandCenterNavigation {
  return { kind: COMMAND_CENTER_NAVIGATION_KIND, returnPath, returnPaneId };
}

/**
 * Parses router history state at the boundary. Anything that isn't a complete,
 * correctly-tagged Command Center entry reads as "no intent", so an arbitrary
 * `navigate("/", { state })` cannot borrow Command Center behavior.
 */
export function parseCommandCenterNavigation(
  state: unknown,
): CommandCenterNavigation | null {
  if (
    typeof state !== "object" ||
    state === null ||
    !("kind" in state) ||
    !("returnPath" in state) ||
    !("returnPaneId" in state)
  ) {
    return null;
  }
  const { kind, returnPath, returnPaneId } = state;
  if (
    kind !== COMMAND_CENTER_NAVIGATION_KIND ||
    typeof returnPath !== "string" ||
    !returnPath.startsWith("/") ||
    // "//host" is protocol-relative: same-origin-looking, off-origin in effect.
    returnPath.startsWith("//") ||
    typeof returnPaneId !== "string" ||
    returnPaneId.length === 0
  ) {
    return null;
  }
  return { kind: COMMAND_CENTER_NAVIGATION_KIND, returnPath, returnPaneId };
}

function readRouterHistoryIndex(state: unknown): number | null {
  if (typeof state !== "object" || state === null || !("idx" in state)) {
    return null;
  }
  const { idx } = state;
  return typeof idx === "number" && Number.isInteger(idx) && idx >= 0
    ? idx
    : null;
}

/**
 * Whether the browser stack still has an app entry beneath the current one.
 * The router stamps its own index into `history.state`, so index 0 means this
 * entry is the app's first and `navigate(-1)` would leave the app (or, in a
 * standalone window with no back affordance, do nothing at all). An
 * unrecognizable state reads as "unknown", where popping stays the right
 * default — it is what every in-session gesture produces.
 */
export function canPopToInAppHistoryEntry(history: {
  state: unknown;
}): boolean {
  const index = readRouterHistoryIndex(history.state);
  return index === null || index > 0;
}

/**
 * Whether a root route must leave the split layout exactly as it was instead
 * of reconciling the route's content into the focused pane.
 *
 * The standalone-compact root page is the persistent Command Center. Folding
 * `/` into the focused pane would overwrite the workspace that its session
 * list and return controls describe. Other display modes keep the existing
 * reconciliation policy.
 */
export function shouldPreserveLayoutForCommandCenter({
  content,
  isStandaloneCompactPwa,
  navigation,
}: {
  content: PaneContent;
  isStandaloneCompactPwa: boolean;
  navigation: CommandCenterNavigation | null;
}): boolean {
  return isStandaloneCompactPwa && content.kind === "new-thread";
}
