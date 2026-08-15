// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { GitHostPullRequestCheck, ThreadPullRequest } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isFailedPullRequestCheck,
  isRerunnablePullRequestCheck,
  PullRequestChecksRail,
} from "./PullRequestChecksRail";

const requestAction = vi.hoisted(() => ({
  isPending: false,
  mutateAsync: vi.fn(),
}));
const sendMessage = vi.hoisted(() => ({
  isPending: false,
  mutateAsync: vi.fn(),
}));

vi.mock("@/hooks/mutations/environment-mutations", () => ({
  useRequestEnvironmentAction: () => requestAction,
}));
vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useSendThreadMessage: () => sendMessage,
}));
vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    error: vi.fn(),
    loading: vi.fn(() => "toast-1"),
    success: vi.fn(),
  },
}));

const failedCheck: GitHostPullRequestCheck = {
  name: "typecheck",
  status: "completed",
  conclusion: "failure",
  url: "https://github.com/acme/bb/actions/runs/123/job/456",
  startedAt: null,
};

const pullRequest: ThreadPullRequest = {
  number: 42,
  title: "Improve checks",
  state: "open",
  url: "https://github.com/acme/bb/pull/42",
  baseRefName: "main",
  headRefName: "feature/checks",
  updatedAt: "2026-08-11T12:00:00.000Z",
  attention: "checks_failed",
  checks: {
    state: "failing",
    totalCount: 2,
    passedCount: 1,
    failedCount: 1,
    pendingCount: 0,
    items: [
      failedCheck,
      {
        name: "lint",
        status: "completed",
        conclusion: "success",
        url: null,
        startedAt: null,
      },
    ],
  },
  review: { state: "approved", reviewRequestCount: 0 },
  mergeability: {
    state: "blocked",
    mergeStateStatus: "BLOCKED",
    mergeable: "MERGEABLE",
  },
};

beforeEach(() => {
  requestAction.isPending = false;
  requestAction.mutateAsync.mockReset();
  requestAction.mutateAsync.mockResolvedValue({
    ok: true,
    action: "pull_request_checks_rerun",
    message: "typecheck queued to re-run",
    rerunCount: 1,
  });
  sendMessage.isPending = false;
  sendMessage.mutateAsync.mockReset();
  sendMessage.mutateAsync.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("pull request check helpers", () => {
  it("only offers retries for failed GitHub Actions checks", () => {
    expect(isFailedPullRequestCheck(failedCheck)).toBe(true);
    expect(isRerunnablePullRequestCheck(failedCheck)).toBe(true);
    expect(
      isRerunnablePullRequestCheck({
        ...failedCheck,
        url: "https://ci.example.test/check/123",
      }),
    ).toBe(false);
  });
});

describe("PullRequestChecksRail", () => {
  it("shows progress and retries one failed check", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullRequestChecksRail
        environmentId="env_1"
        onRefresh={onRefresh}
        pullRequest={pullRequest}
        threadId="thr_1"
      />,
    );

    expect(screen.getByText("2 of 2 complete")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Re-run" }));

    await waitFor(() =>
      expect(requestAction.mutateAsync).toHaveBeenCalledWith({
        id: "env_1",
        action: "pull_request_checks_rerun",
        options: { scope: "check", checkName: "typecheck" },
      }),
    );
  });

  it("sends a triage prompt to the current agent", async () => {
    render(
      <PullRequestChecksRail
        environmentId="env_1"
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        pullRequest={pullRequest}
        threadId="thr_1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Triage" }));

    await waitFor(() => expect(sendMessage.mutateAsync).toHaveBeenCalledOnce());
    expect(sendMessage.mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      id: "thr_1",
      mode: "queue-if-active",
    });
    expect(sendMessage.mutateAsync.mock.calls[0]?.[0].input[0].text).toContain(
      'failing CI check "typecheck"',
    );
  });

  it("retries every failed workflow from one action", async () => {
    const secondFailedCheck: GitHostPullRequestCheck = {
      ...failedCheck,
      name: "test",
      url: "https://github.com/acme/bb/actions/runs/124/job/457",
    };
    render(
      <PullRequestChecksRail
        environmentId="env_1"
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        pullRequest={{
          ...pullRequest,
          checks: {
            state: "failing",
            totalCount: 2,
            passedCount: 0,
            failedCount: 2,
            pendingCount: 0,
            items: [failedCheck, secondFailedCheck],
          },
        }}
        threadId="thr_1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Re-run all failed" }));

    await waitFor(() =>
      expect(requestAction.mutateAsync).toHaveBeenCalledWith({
        id: "env_1",
        action: "pull_request_checks_rerun",
        options: { scope: "failed" },
      }),
    );
  });
});
