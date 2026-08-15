import { useCallback, useMemo, useState } from "react";
import type {
  EnvironmentPreviewsResponse,
  EnvironmentPullRequestResponse,
  EnvironmentStatusResponse,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import { appToast } from "@/components/ui/app-toast";
import { useUpdateEnvironment } from "@/hooks/mutations/environment-mutations";
import {
  getEnvironmentPullRequestFromResponse,
  useEnvironment,
  useEnvironmentPreviews,
  useEnvironmentPullRequest,
  useEnvironmentWorkStatus,
} from "@/hooks/queries/environment-queries";
import { useGithubAccounts } from "@/hooks/queries/system-queries";
import { useThread } from "@/hooks/queries/thread-queries";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { getPullRequestAttentionDisplay } from "@/lib/pull-request-display";
import { statusTierClassName, type StatusTier } from "@/lib/status-tier";
import { RailRow } from "./RailRow";
import { RailSection } from "./RailSection";
import { GithubAccountRailRow } from "./GithubAccountRailRow";
import { PullRequestChecksRail } from "./PullRequestChecksRail";
import { RAIL_BODY_TEXT_CLASS, RAIL_PROSE_CLASS } from "./railStyleTokens";

interface BranchHealthSummary {
  label: string;
  tier: StatusTier;
}

export function summarizeBranchHealth(args: {
  isLoading: boolean;
  previews: EnvironmentPreviewsResponse | undefined;
  pullRequest: EnvironmentPullRequestResponse | undefined;
  status: EnvironmentStatusResponse | undefined;
}): BranchHealthSummary {
  if (args.isLoading) return { label: "Loading", tier: "muted" };
  if (args.status?.outcome !== "available") {
    return { label: "Unavailable", tier: "destructive" };
  }

  const pullRequest = getEnvironmentPullRequestFromResponse(args.pullRequest);
  const deploymentStates = (args.previews?.providers ?? [])
    .filter((provider) => provider.kind === "deployment")
    .map((provider) => provider.state);
  if (
    deploymentStates.includes("failed") ||
    pullRequest?.attention === "checks_failed" ||
    pullRequest?.attention === "changes_requested" ||
    pullRequest?.attention === "conflicts" ||
    pullRequest?.attention === "blocked"
  ) {
    return { label: "Needs attention", tier: "destructive" };
  }
  if (
    args.status.workspace.workingTree.hasUncommittedChanges ||
    (args.status.workspace.mergeBase?.behindCount ?? 0) > 0 ||
    deploymentStates.includes("building") ||
    pullRequest?.attention === "checks_pending" ||
    pullRequest?.attention === "review_requested"
  ) {
    return { label: "In progress", tier: "warning" };
  }
  return { label: "Healthy", tier: "success" };
}

export interface BranchHealthSectionProps {
  enabled?: boolean;
  threadId: string;
}

export function BranchHealthSection({
  enabled = true,
  threadId,
}: BranchHealthSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const threadQuery = useThread(threadId, { enabled });
  const environmentId = threadQuery.data?.environmentId;
  const environmentQuery = useEnvironment(environmentId, { enabled });
  const environment = environmentQuery.data;
  const githubAccountsQuery = useGithubAccounts({
    ...(environment?.hostId === undefined
      ? {}
      : { hostId: environment.hostId }),
    enabled: enabled && environment !== undefined,
  });
  const updateEnvironment = useUpdateEnvironment();
  const statusQuery = useEnvironmentWorkStatus(environmentId, undefined, {
    enabled,
  });
  const githubAccounts = githubAccountsQuery.data?.accounts ?? [];
  const selectedGithubAccountLogin =
    environment?.githubAccountLogin ??
    githubAccounts.find((account) => account.active)?.login ??
    githubAccounts[0]?.login ??
    null;
  const pullRequestQuery = useEnvironmentPullRequest(environmentId, {
    accountLogin: selectedGithubAccountLogin,
    enabled: enabled && selectedGithubAccountLogin !== null,
  });
  const previewsQuery = useEnvironmentPreviews(environmentId, { enabled });
  const isLoading =
    threadQuery.isLoading ||
    statusQuery.isLoading ||
    pullRequestQuery.isLoading ||
    previewsQuery.isLoading;
  const hasError =
    threadQuery.isError ||
    statusQuery.isError ||
    pullRequestQuery.isError ||
    previewsQuery.isError;
  const summary = useMemo(
    () =>
      summarizeBranchHealth({
        isLoading,
        previews: previewsQuery.data,
        pullRequest: pullRequestQuery.data,
        status: statusQuery.data,
      }),
    [isLoading, previewsQuery.data, pullRequestQuery.data, statusQuery.data],
  );
  const workspace =
    statusQuery.data?.outcome === "available"
      ? statusQuery.data.workspace
      : null;
  const pullRequest = getEnvironmentPullRequestFromResponse(
    pullRequestQuery.data,
  );
  const deployments = previewsQuery.data?.providers.filter(
    (provider) => provider.kind === "deployment",
  );
  const deploymentLabel = deployments?.some(
    (provider) => provider.state === "failed",
  )
    ? "Failed"
    : deployments?.some((provider) => provider.state === "building")
      ? "Building"
      : deployments?.length
        ? "Ready"
        : "None";
  const retry = () => {
    void statusQuery.refetch();
    void pullRequestQuery.refetch();
    void previewsQuery.refetch();
  };
  const handleGithubAccountChange = useCallback(
    async (login: string) => {
      if (!environmentId || environment?.githubAccountLogin === login) return;
      const toastId = appToast.loading(`Switching to @${login}`);
      try {
        await updateEnvironment.mutateAsync({
          id: environmentId,
          githubAccountLogin: login,
        });
        appToast.success(`Using @${login} for this worktree`, { id: toastId });
      } catch (error) {
        appToast.error("GitHub account was not changed", {
          id: toastId,
          description: getMutationErrorMessage({
            error,
            fallbackMessage: `Could not use @${login}`,
          }),
        });
      }
    },
    [environment?.githubAccountLogin, environmentId, updateEnvironment],
  );

  return (
    <RailSection
      isExpanded={isExpanded}
      label="Branch Health"
      onToggle={() => setIsExpanded((current) => !current)}
      trailing={
        <span
          className={cn("shrink-0 text-xs", statusTierClassName(summary.tier))}
        >
          {summary.label}
        </span>
      }
    >
      {hasError ? (
        <div
          role="alert"
          className={cn(
            RAIL_BODY_TEXT_CLASS,
            "flex items-center gap-2 py-1 text-destructive",
          )}
        >
          <span className="min-w-0 flex-1">Could not load branch health.</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={retry}
          >
            Retry
          </Button>
        </div>
      ) : isLoading ? (
        <p className={cn(RAIL_PROSE_CLASS, "py-1")}>Loading branch health…</p>
      ) : workspace === null ? (
        <p className={cn(RAIL_PROSE_CLASS, "py-1")}>
          Branch status is unavailable.
        </p>
      ) : (
        <div className="flex min-w-0 flex-col">
          <RailRow
            icon="GitBranch"
            label={workspace.branch.currentBranch ?? "Detached checkout"}
            trailing={
              workspace.workingTree.hasUncommittedChanges ? "Changes" : "Clean"
            }
          />
          <GithubAccountRailRow
            accounts={githubAccounts}
            disabled={updateEnvironment.isPending}
            isLoading={
              environmentQuery.isLoading || githubAccountsQuery.isLoading
            }
            onChange={(login) => void handleGithubAccountChange(login)}
            value={selectedGithubAccountLogin}
          />
          {workspace.mergeBase === null ? null : (
            <RailRow
              icon="GitMerge"
              label={`Compared with ${workspace.mergeBase.mergeBaseBranch}`}
              trailing={`${workspace.mergeBase.aheadCount}↑ ${workspace.mergeBase.behindCount}↓`}
            />
          )}
          {pullRequest === null ? (
            <RailRow
              icon="GitPullRequestArrow"
              label="Pull request"
              trailing="None"
            />
          ) : (
            <>
              <RailRow
                icon="GitPullRequestArrow"
                label={`#${pullRequest.number} ${pullRequest.title}`}
                trailing={getPullRequestAttentionDisplay(pullRequest).label}
                showsChevron
                onSelect={() =>
                  window.open(pullRequest.url, "_blank", "noopener,noreferrer")
                }
              />
              {environmentId ? (
                <PullRequestChecksRail
                  environmentId={environmentId}
                  onRefresh={pullRequestQuery.refetch}
                  pullRequest={pullRequest}
                  threadId={threadId}
                />
              ) : null}
            </>
          )}
          <RailRow
            icon="Globe"
            label="Deployments"
            trailing={deploymentLabel}
          />
        </div>
      )}
    </RailSection>
  );
}
