import type { Thread } from "@bb/domain";

type ThreadReadToggleAction = "mark_read" | "mark_unread";

export function getThreadReadToggleAction(
  thread: Pick<Thread, "lastReadAt" | "latestAttentionAt">,
): ThreadReadToggleAction {
  // A timestamp later than attention means the response was viewed but still
  // awaits a reply. Equality is the explicit "handled" marker written by
  // Mark read, so only that state toggles back to unread.
  return thread.lastReadAt === thread.latestAttentionAt
    ? "mark_unread"
    : "mark_read";
}
