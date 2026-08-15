import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export type ConversationSignal =
  | "working"
  | "ready"
  | "waiting"
  | "failed"
  | "awaiting-reply"
  | "passive";

export function conversationSignal(
  thread: PluginSidebarThread,
): ConversationSignal {
  if (
    thread.hasPendingInteraction ||
    thread.indicator === "waiting-for-input"
  ) {
    return "waiting";
  }
  if (thread.indicator === "unread-error") return "failed";
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
    return "working";
  }
  if (thread.isUnread || thread.indicator === "unread-success") return "ready";
  if (
    thread.indicator === "none" &&
    thread.lastReadAt !== null &&
    thread.lastReadAt > thread.latestAttentionAt
  ) {
    return "awaiting-reply";
  }
  return "passive";
}

export function workspaceSignal(
  threads: readonly PluginSidebarThread[],
): ConversationSignal {
  const signals = new Set(threads.map(conversationSignal));
  for (const signal of [
    "failed",
    "waiting",
    "working",
    "ready",
    "awaiting-reply",
  ] as const) {
    if (signals.has(signal)) return signal;
  }
  return "passive";
}

export function signalLabel(signal: ConversationSignal): string | null {
  switch (signal) {
    case "working":
      return "Working";
    case "ready":
      return "Ready";
    case "waiting":
      return "Waiting";
    case "failed":
      return "Failed";
    case "awaiting-reply":
      return "Awaiting Reply";
    case "passive":
      return null;
  }
}
