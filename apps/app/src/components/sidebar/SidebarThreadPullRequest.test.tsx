// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ThreadPullRequest } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SidebarPullRequestNumber,
  SidebarThreadPullRequest,
} from "./SidebarThreadPullRequest";

const mockPullRequest = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdk", () => ({
  sdk: { environments: { pullRequest: mockPullRequest } },
}));

function makePullRequest(state: ThreadPullRequest["state"]): ThreadPullRequest {
  return {
    number: 574,
    title: "Refine navigation",
    url: "https://github.com/amir/bb/pull/574",
    state,
    baseRefName: "main",
    headRefName: "codex/conductor-sidebar",
    updatedAt: "2026-08-11T12:00:00.000Z",
    checks: {
      state: "passing",
      totalCount: 1,
      passedCount: 1,
      failedCount: 0,
      pendingCount: 0,
      items: [],
    },
    review: { state: "approved", reviewRequestCount: 0 },
    mergeability: {
      state: "mergeable",
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
    },
    attention: "ready_to_merge",
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SidebarPullRequestNumber", () => {
  it.each([
    ["open", "text-success-foreground", "Open"],
    ["merged", "text-pr-merged", "Merged"],
    ["draft", "text-warning-text", "Draft"],
    ["closed", "text-destructive-text", "Closed"],
  ] as const)(
    "uses the %s state color and accessible label",
    (state, className, label) => {
      render(<SidebarPullRequestNumber pullRequest={makePullRequest(state)} />);

      const number = screen.getByLabelText(`${label} pull request 574`);
      expect(number.textContent).toBe("PR #574");
      expect(number.className).toContain(className);
    },
  );

  it("loads the pull request shared by a workspace environment", async () => {
    mockPullRequest.mockResolvedValue({
      outcome: "available",
      pullRequest: makePullRequest("open"),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SidebarThreadPullRequest environmentId="env-sidebar" />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByLabelText("Open pull request 574"),
    ).not.toBeNull();
    expect(mockPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ environmentId: "env-sidebar" }),
    );
  });
});
