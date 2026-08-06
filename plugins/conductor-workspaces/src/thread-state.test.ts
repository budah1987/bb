import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@bb/plugin-sdk/app";
import { conversationSignal } from "./thread-state";

function signalThread(
  overrides: Partial<PluginSidebarThread>,
): PluginSidebarThread {
  return {
    id: "thread",
    projectId: "project",
    title: "Thread",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: 1,
    latestAttentionAt: 1,
    ...overrides,
  };
}

describe("conversationSignal", () => {
  it("keeps user-blocked work in needs-attention even if activity remains", () => {
    expect(
      conversationSignal(
        signalThread({
          hasPendingInteraction: true,
          activity: {
            workflows: 1,
            backgroundAgents: 0,
            backgroundCommands: 0,
            planMode: 0,
            goals: 0,
          },
        }),
      ),
    ).toBe("unread");
  });

  it("uses activity before unread and renders idle as no signal", () => {
    expect(
      conversationSignal(
        signalThread({
          isUnread: true,
          activity: {
            workflows: 1,
            backgroundAgents: 0,
            backgroundCommands: 0,
            planMode: 0,
            goals: 0,
          },
        }),
      ),
    ).toBe("activity");
    expect(conversationSignal(signalThread({ isUnread: true }))).toBe("unread");
    expect(conversationSignal(signalThread({}))).toBe("idle");
  });
});
