// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import {
  ReviewQueueSection,
  selectReviewQueueItems,
} from "./ReviewQueueSection";

const queryMocks = vi.hoisted(() => ({
  retry: vi.fn(),
  useProjectThreadSubset: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({ data: { projectId: "project-1" } }),
  useProjectThreadSubset: queryMocks.useProjectThreadSubset,
}));

afterEach(() => {
  cleanup();
  queryMocks.retry.mockClear();
  queryMocks.useProjectThreadSubset.mockReset();
});

function thread(
  id: string,
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id,
    projectId: "project-1",
    environmentId: "environment-1",
    providerId: "codex",
    title: `Task ${id}`,
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: "parent-1",
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: 50,
    latestAttentionAt: 100,
    createdAt: 10,
    updatedAt: 100,
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    pinSortKey: null,
    hasPendingInteraction: false,
    environmentHostId: "host-1",
    environmentName: "main",
    environmentBranchName: "feature/review",
    environmentWorkspaceDisplayKind: "managed-worktree",
    ...overrides,
  };
}

describe("selectReviewQueueItems", () => {
  it("orders replies and failures before completed work", () => {
    const items = selectReviewQueueItems([
      thread("ready"),
      thread("failed", {
        runtime: {
          displayStatus: "error",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      thread("reply", { hasPendingInteraction: true }),
    ]);

    expect(items.map((item) => [item.id, item.state])).toEqual([
      ["reply", "needs-reply"],
      ["failed", "failed"],
      ["ready", "ready"],
    ]);
  });

  it("excludes read work and user-created side conversations", () => {
    const items = selectReviewQueueItems([
      thread("read", { lastReadAt: 100 }),
      thread("fork", { originKind: "fork" }),
      thread("active", {
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    ]);

    expect(items).toEqual([]);
  });
});

describe("ReviewQueueSection errors", () => {
  it("keeps a failed review query visible and retries it", () => {
    queryMocks.useProjectThreadSubset.mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: false,
      isLoading: false,
      retry: queryMocks.retry,
    });
    render(createElement(ReviewQueueSection, { threadId: "thread-1" }));

    expect(screen.getByRole("alert").textContent).toContain(
      "Could not load review list.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(queryMocks.retry).toHaveBeenCalledOnce();
  });
});
