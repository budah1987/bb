import type { EnvironmentPullRequestResponse } from "@bb/server-contract";

export type ThreadHeaderGithubWorkflowStep =
  | "commit"
  | "create_pull_request"
  | "merge_pull_request";

export function resolveThreadHeaderGithubWorkflowStep({
  hasCommitAction,
  hasCommittedUnmergedChanges,
  isArchivedThread,
  pullRequestResponse,
}: {
  hasCommitAction: boolean;
  hasCommittedUnmergedChanges: boolean;
  isArchivedThread: boolean;
  pullRequestResponse: EnvironmentPullRequestResponse | undefined;
}): ThreadHeaderGithubWorkflowStep | null {
  if (isArchivedThread) {
    return null;
  }

  if (hasCommitAction) {
    return "commit";
  }

  if (pullRequestResponse?.outcome === "available") {
    return pullRequestResponse.pullRequest.state === "open" ||
      pullRequestResponse.pullRequest.state === "draft"
      ? "merge_pull_request"
      : null;
  }

  return pullRequestResponse?.outcome === "absent" &&
    hasCommittedUnmergedChanges
    ? "create_pull_request"
    : null;
}
