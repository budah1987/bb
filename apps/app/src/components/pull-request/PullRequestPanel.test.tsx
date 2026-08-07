// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ThreadPullRequest } from "@bb/domain";
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
      creationUnavailableReason={null}
      defaultBaseBranch="main"
      isActionPending={false}
      isLoading={false}
      onArchive={onArchive}
      onAskAgentToFix={onAskAgentToFix}
      onConvertToDraft={noop}
      onCreate={onCreate}
      onMarkReady={noop}
      onMerge={noop}
      onRefresh={noop}
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
