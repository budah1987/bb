import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
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
  it("keeps user-blocked work waiting even if activity remains", () => {
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
    ).toBe("waiting");
  });

  it("uses working before ready and renders quiet work as passive", () => {
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
    ).toBe("working");
    expect(conversationSignal(signalThread({ isUnread: true }))).toBe("ready");
    expect(conversationSignal(signalThread({}))).toBe("passive");
  });

  it("distinguishes failed unread work from ready unread work", () => {
    expect(
      conversationSignal(signalThread({ indicator: "unread-error" })),
    ).toBe("failed");
    expect(
      conversationSignal(signalThread({ indicator: "unread-success" })),
    ).toBe("ready");
  });

  it("marks viewed output without a newer reply as awaiting reply", () => {
    expect(
      conversationSignal(signalThread({ lastReadAt: 2, latestAttentionAt: 1 })),
    ).toBe("awaiting-reply");
    expect(
      conversationSignal(signalThread({ lastReadAt: 1, latestAttentionAt: 1 })),
    ).toBe("passive");
  });
});
