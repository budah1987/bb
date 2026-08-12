import type { EnvironmentPullRequestResponse } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { resolveThreadHeaderGithubWorkflowStep } from "./thread-header-github-workflow";

const OPEN_PULL_REQUEST: EnvironmentPullRequestResponse = {
  outcome: "available",
  pullRequest: {
    number: 42,
    title: "Improve the GitHub workflow",
    state: "open",
    url: "https://github.com/get-bb/bb/pull/42",
    baseRefName: "main",
    headRefName: "feature/github-workflow",
    updatedAt: "2026-08-12T12:00:00.000Z",
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
  },
};

describe("resolveThreadHeaderGithubWorkflowStep", () => {
  it("moves from commit to pull request creation and merge", () => {
    expect(
      resolveThreadHeaderGithubWorkflowStep({
        hasCommitAction: true,
        hasCommittedUnmergedChanges: false,
        isArchivedThread: false,
        pullRequestResponse: { outcome: "absent" },
      }),
    ).toBe("commit");

    expect(
      resolveThreadHeaderGithubWorkflowStep({
        hasCommitAction: false,
        hasCommittedUnmergedChanges: true,
        isArchivedThread: false,
        pullRequestResponse: { outcome: "absent" },
      }),
    ).toBe("create_pull_request");

    expect(
      resolveThreadHeaderGithubWorkflowStep({
        hasCommitAction: false,
        hasCommittedUnmergedChanges: true,
        isArchivedThread: false,
        pullRequestResponse: OPEN_PULL_REQUEST,
      }),
    ).toBe("merge_pull_request");
  });

  it("does not offer pull request creation before lookup succeeds", () => {
    expect(
      resolveThreadHeaderGithubWorkflowStep({
        hasCommitAction: false,
        hasCommittedUnmergedChanges: true,
        isArchivedThread: false,
        pullRequestResponse: undefined,
      }),
    ).toBeNull();
    expect(
      resolveThreadHeaderGithubWorkflowStep({
        hasCommitAction: false,
        hasCommittedUnmergedChanges: true,
        isArchivedThread: false,
        pullRequestResponse: {
          outcome: "unavailable",
          message: "GitHub is unavailable",
        },
      }),
    ).toBeNull();
  });

  it("ends the workflow for merged and closed pull requests", () => {
    for (const state of ["merged", "closed"] as const) {
      expect(
        resolveThreadHeaderGithubWorkflowStep({
          hasCommitAction: false,
          hasCommittedUnmergedChanges: true,
          isArchivedThread: false,
          pullRequestResponse: {
            ...OPEN_PULL_REQUEST,
            pullRequest: { ...OPEN_PULL_REQUEST.pullRequest, state },
          },
        }),
      ).toBeNull();
    }
  });

  it("does not offer GitHub actions for an archived thread", () => {
    expect(
      resolveThreadHeaderGithubWorkflowStep({
        hasCommitAction: false,
        hasCommittedUnmergedChanges: true,
        isArchivedThread: true,
        pullRequestResponse: { outcome: "absent" },
      }),
    ).toBeNull();
  });
});
