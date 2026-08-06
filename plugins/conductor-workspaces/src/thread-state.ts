import type { PluginSidebarThread } from "@bb/plugin-sdk/app";

export type ConversationSignal = "activity" | "unread" | "idle";

export function conversationSignal(
  thread: PluginSidebarThread,
): ConversationSignal {
  if (thread.hasPendingInteraction) return "unread";
  const { activity } = thread;
  if (
    activity.workflows > 0 ||
    activity.backgroundAgents > 0 ||
    activity.backgroundCommands > 0 ||
    activity.planMode > 0 ||
    activity.goals > 0 ||
    [
      "workflow",
      "background-agent",
      "background-command",
      "plan-mode",
      "goal",
      "runtime",
      "working-draft",
    ].includes(thread.indicator)
  ) {
    return "activity";
  }
  if (thread.isUnread) return "unread";
  return "idle";
}

export function workspaceSignal(
  threads: readonly PluginSidebarThread[],
): ConversationSignal {
  if (threads.some((thread) => conversationSignal(thread) === "activity")) {
    return "activity";
  }
  if (threads.some((thread) => conversationSignal(thread) === "unread")) {
    return "unread";
  }
  return "idle";
}

export function signalLabel(signal: ConversationSignal): string | null {
  switch (signal) {
    case "activity":
      return "Working";
    case "unread":
      return "Needs attention";
    case "idle":
      return null;
  }
}
