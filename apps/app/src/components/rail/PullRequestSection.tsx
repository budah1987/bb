import { useState } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  getEnvironmentPullRequestFromResponse,
  useEnvironment,
  useEnvironmentPullRequest,
} from "@/hooks/queries/environment-queries";
import { useGithubAccounts } from "@/hooks/queries/system-queries";
import { useThread } from "@/hooks/queries/thread-queries";
import { getPullRequestAttentionDisplay } from "@/lib/pull-request-display";
import { RailRow } from "./RailRow";
import { RailSection } from "./RailSection";
import { PullRequestChecksRail } from "./PullRequestChecksRail";
import { RAIL_PROSE_CLASS } from "./railStyleTokens";

export function PullRequestSection({
  enabled = true,
  threadId,
}: {
  enabled?: boolean;
  threadId: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const threadQuery = useThread(threadId, { enabled });
  const environmentId = threadQuery.data?.environmentId;
  const environmentQuery = useEnvironment(environmentId, { enabled });
  const environment = environmentQuery.data;
  const accountsQuery = useGithubAccounts({
    ...(environment?.hostId === undefined
      ? {}
      : { hostId: environment.hostId }),
    enabled: enabled && environment !== undefined,
  });
  const accounts = accountsQuery.data?.accounts ?? [];
  const accountLogin =
    environment?.githubAccountLogin ??
    accounts.find((account) => account.active)?.login ??
    accounts[0]?.login ??
    null;
  const pullRequestQuery = useEnvironmentPullRequest(environmentId, {
    accountLogin,
    enabled: enabled && accountLogin !== null,
  });
  const pullRequest = getEnvironmentPullRequestFromResponse(
    pullRequestQuery.data,
  );

  if (
    !enabled ||
    (!pullRequestQuery.isLoading && !pullRequestQuery.isError && !pullRequest)
  ) {
    return null;
  }

  const attention = pullRequest
    ? getPullRequestAttentionDisplay(pullRequest)
    : null;

  return (
    <RailSection
      isExpanded={isExpanded}
      label="Pull request"
      onToggle={() => setIsExpanded((current) => !current)}
      trailing={
        attention ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {attention.label}
          </span>
        ) : null
      }
    >
      {pullRequestQuery.isError ? (
        <p
          role="alert"
          className={cn(RAIL_PROSE_CLASS, "py-1 text-destructive")}
        >
          Could not load pull request.
        </p>
      ) : pullRequestQuery.isLoading ? (
        <p role="status" className={cn(RAIL_PROSE_CLASS, "py-1")}>
          Loading pull request…
        </p>
      ) : pullRequest ? (
        <div className="flex min-w-0 flex-col">
          <RailRow
            icon="GitPullRequestArrow"
            label={`#${pullRequest.number} ${pullRequest.title}`}
            onSelect={() =>
              window.open(pullRequest.url, "_blank", "noopener,noreferrer")
            }
            showsChevron
          />
          {environmentId ? (
            <PullRequestChecksRail
              environmentId={environmentId}
              onRefresh={pullRequestQuery.refetch}
              pullRequest={pullRequest}
              threadId={threadId}
            />
          ) : null}
        </div>
      ) : null}
    </RailSection>
  );
}
