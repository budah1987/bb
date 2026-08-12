export type CompactConversationCycleDirection = "left" | "right";

type CompactConversationCycleHandler = (
  direction: CompactConversationCycleDirection,
) => boolean;

let activeHandler: CompactConversationCycleHandler | null = null;

/** Registers the one compact Conductor context bar mounted for the page. */
export function registerCompactConversationCycleHandler(
  handler: CompactConversationCycleHandler,
): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

export function hasCompactConversationCycleHandler(): boolean {
  return activeHandler !== null;
}

/** Runs the mounted Conductor context bar's adjacent-conversation action. */
export function cycleCompactConversation(
  direction: CompactConversationCycleDirection,
): boolean {
  return activeHandler?.(direction) ?? false;
}
