import type { PullRequestState, ThreadPullRequest } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  getEnvironmentPullRequestFromResponse,
  useEnvironmentPullRequest,
} from "@/hooks/queries/environment-queries";

const PULL_REQUEST_STATE_LABEL: Record<PullRequestState, string> = {
  open: "Open",
  merged: "Merged",
  draft: "Draft",
  closed: "Closed",
};

const PULL_REQUEST_STATE_CLASS: Record<PullRequestState, string> = {
  open: "text-success-foreground",
  merged: "text-pr-merged",
  draft: "text-warning-text",
  closed: "text-destructive-text",
};

export function SidebarPullRequestNumber({
  pullRequest,
}: {
  pullRequest: ThreadPullRequest;
}) {
  const stateLabel = PULL_REQUEST_STATE_LABEL[pullRequest.state];

  return (
    <span
      data-sidebar-pull-request-state={pullRequest.state}
      aria-label={`${stateLabel} pull request ${pullRequest.number}`}
      className={cn(
        "truncate text-2xs font-medium leading-3 tabular-nums",
        PULL_REQUEST_STATE_CLASS[pullRequest.state],
      )}
    >
      PR #{pullRequest.number}
    </span>
  );
}

export function SidebarThreadPullRequest({
  environmentId,
}: {
  environmentId: string;
}) {
  const query = useEnvironmentPullRequest(environmentId, {
    accountLogin: null,
  });
  const pullRequest = getEnvironmentPullRequestFromResponse(query.data);

  return pullRequest ? (
    <SidebarPullRequestNumber pullRequest={pullRequest} />
  ) : null;
}
