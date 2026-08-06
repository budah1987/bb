const CONVERSATION_VIEW_TRANSITION_PREFIX = "bb-conversation-surface";

export function getConversationViewTransitionName(
  paneId: string | null,
): string {
  const normalizedPaneId = paneId
    ?.trim()
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalizedPaneId
    ? `${CONVERSATION_VIEW_TRANSITION_PREFIX}-${normalizedPaneId}`
    : `${CONVERSATION_VIEW_TRANSITION_PREFIX}-root`;
}
