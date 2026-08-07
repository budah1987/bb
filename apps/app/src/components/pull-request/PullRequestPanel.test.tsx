// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ThreadPullRequest, WorkspaceStatus } from "@bb/domain";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PullRequestPanel } from "./PullRequestPanel";

vi.mock("@/components/pickers/BranchPicker", () => ({
  BranchPicker: ({
    onChange,
    options,
    value,
  }: {
    onChange: (value: string) => void;
    options: readonly string[];
    value: string;
  }) => (
    <select
      aria-label="Base branch"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option}>{option}</option>
      ))}
    </select>
  ),
}));

afterEach(cleanup);

const noop = vi.fn();

const dirtyWorkspaceStatus: WorkspaceStatus = {
  workingTree: {
    state: "dirty_uncommitted",
    hasUncommittedChanges: true,
    files: [
      {
        path: "apps/app/src/components/pull-request/PullRequestPanel.tsx",
        status: "M",
        insertions: 12,
        deletions: 2,
      },
    ],
    insertions: 12,
    deletions: 2,
  },
  branch: {
    currentBranch: "feature/pr-workflow",
    defaultBranch: "main",
  },
  checkout: {
    kind: "branch",
    branchName: "feature/pr-workflow",
    headSha: null,
  },
  mergeBase: null,
};

function renderPanel(
  pullRequestResponse:
    | { outcome: "absent" }
    | { outcome: "available"; pullRequest: ThreadPullRequest },
  overrides: Partial<ComponentProps<typeof PullRequestPanel>> = {},
) {
  const onCreate = vi.fn();
  const onAskAgentToFix = vi.fn();
  const onArchive = vi.fn();
  render(
    <PullRequestPanel
      baseBranchOptions={["main", "release"]}
      defaultBaseBranch="main"
      isActionPending={false}
      isLoading={false}
      onArchive={onArchive}
      onAskAgentToFix={onAskAgentToFix}
      onCommitChanges={noop}
      onConvertToDraft={noop}
      onCreate={onCreate}
      onGenerateMetadata={async () => ({
        body: "",
        title: "Ship the PR workflow",
      })}
      onMarkReady={noop}
      onMerge={noop}
      onRefresh={noop}
      onReviewChanges={noop}
      pullRequestResponse={pullRequestResponse}
      threadTitle="Ship the PR workflow"
      workspaceStatus={undefined}
      {...overrides}
    />,
  );
  return { onArchive, onAskAgentToFix, onCreate };
}

function pullRequest(
  overrides: Partial<ThreadPullRequest> = {},
): ThreadPullRequest {
  return {
    number: 42,
    title: "Ship the PR workflow",
    state: "open",
    url: "https://github.com/acme/bb/pull/42",
    baseRefName: "main",
    headRefName: "feature/pr-workflow",
    updatedAt: "2026-08-06T00:00:00.000Z",
    checks: {
      state: "failing",
      totalCount: 1,
      passedCount: 0,
      failedCount: 1,
      pendingCount: 0,
      items: [
        {
          name: "typecheck",
          status: "completed",
          conclusion: "failure",
          url: "https://github.com/acme/bb/actions/runs/1",
        },
      ],
    },
    review: { state: "none", reviewRequestCount: 0 },
    mergeability: {
      state: "mergeable",
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
    },
    attention: "checks_failed",
    ...overrides,
  };
}

describe("PullRequestPanel", () => {
  it("creates a PR from the thread title and selected base branch", () => {
    const { onCreate } = renderPanel({ outcome: "absent" });

    fireEvent.change(screen.getByLabelText("Base branch"), {
      target: { value: "release" },
    });
    fireEvent.click(screen.getByText("Create as draft"));
    fireEvent.click(
      screen.getByRole("button", { name: "Create draft pull request" }),
    );

    expect(onCreate).toHaveBeenCalledWith({
      baseBranch: "release",
      body: "",
      draft: true,
      title: "Ship the PR workflow",
    });
  });

  it("applies generated metadata while keeping the form editable", async () => {
    renderPanel(
      { outcome: "absent" },
      {
        onGenerateMetadata: async () => ({
          body: "Explains the generated pull request.",
          title: "Generate pull request metadata",
        }),
      },
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toHaveProperty(
        "value",
        "Generate pull request metadata",
      );
    });
    expect(screen.getByLabelText(/Description/)).toHaveProperty(
      "value",
      "Explains the generated pull request.",
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Edited title" },
    });
    expect(screen.getByLabelText("Title")).toHaveProperty(
      "value",
      "Edited title",
    );
  });

  it("offers review and commit actions for uncommitted changes", () => {
    const onCommitChanges = vi.fn();
    const onReviewChanges = vi.fn();
    renderPanel(
      { outcome: "absent" },
      {
        onCommitChanges,
        onReviewChanges,
        workspaceStatus: dirtyWorkspaceStatus,
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Commit changes" }));
    expect(onReviewChanges).toHaveBeenCalledOnce();
    expect(onCommitChanges).toHaveBeenCalledOnce();
  });

  it("surfaces a failing check and sends it to the agent", () => {
    const failingPullRequest = pullRequest();
    const { onAskAgentToFix } = renderPanel({
      outcome: "available",
      pullRequest: failingPullRequest,
    });

    fireEvent.click(screen.getByRole("button", { name: "Ask agent" }));

    expect(onAskAgentToFix).toHaveBeenCalledWith(
      failingPullRequest.checks.items[0],
    );
    expect(
      screen.getByRole("button", { name: "Checks failing" }),
    ).toHaveProperty("disabled", true);
  });

  it("offers workspace archive after merge", () => {
    const { onArchive } = renderPanel({
      outcome: "available",
      pullRequest: pullRequest({ state: "merged", attention: "merged" }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Archive workspace" }));
    expect(onArchive).toHaveBeenCalledOnce();
  });
});
