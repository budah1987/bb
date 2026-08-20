import { useCallback, useMemo, useState } from "react";
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
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  useGithubAccounts,
  useGithubRepositoryHealth,
} from "@/hooks/queries/system-queries";
import { useThread } from "@/hooks/queries/thread-queries";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { getPullRequestAttentionDisplay } from "@/lib/pull-request-display";
import { statusTierClassName } from "@/lib/status-tier";
import { parseGithubRepositoryName } from "@/lib/github-repository";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  formatGithubRetryAt,
  summarizeRepositoryHealth,
} from "@/lib/repository-health-summary";
import { useSetThreadSecondaryPanelSelection } from "@/views/thread-detail/threadSecondaryPanelSelection";
import { RailRow } from "./RailRow";
import { RailSection } from "./RailSection";
import { GithubAccountRailRow } from "./GithubAccountRailRow";
import { PullRequestChecksRail } from "./PullRequestChecksRail";
import { RAIL_BODY_TEXT_CLASS, RAIL_PROSE_CLASS } from "./railStyleTokens";

export { summarizeRepositoryHealth } from "@/lib/repository-health-summary";

export interface RepositoryHealthSectionProps {
  enabled?: boolean;
  threadId: string;
}

export function RepositoryHealthSection({
  enabled = true,
  threadId,
}: RepositoryHealthSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const threadQuery = useThread(threadId, { enabled });
  const environmentId = threadQuery.data?.environmentId;
  const environmentQuery = useEnvironment(environmentId, { enabled });
  const environment = environmentQuery.data;
  const sidebarNavigationQuery = useSidebarNavigation({ enabled });
  const project = sidebarNavigationQuery.data?.projects.find(
    (candidate) => candidate.id === environment?.projectId,
  );
  const repositoryName = parseGithubRepositoryName(
    project?.gitRemoteUrl ?? null,
  );
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
  const repositoryHealthQuery = useGithubRepositoryHealth({
    repositories: repositoryName === null ? [] : [repositoryName],
    githubAccountLogin: selectedGithubAccountLogin,
    ...(environment?.hostId === undefined
      ? {}
      : { hostId: environment.hostId }),
    refresh: "allow-fetch",
    enabled:
      enabled &&
      isExpanded &&
      repositoryName !== null &&
      selectedGithubAccountLogin !== null,
  });
  const previewsQuery = useEnvironmentPreviews(environmentId, { enabled });
  const isLoading =
    threadQuery.isLoading ||
    statusQuery.isLoading ||
    pullRequestQuery.isLoading ||
    previewsQuery.isLoading ||
    repositoryHealthQuery.isLoading;
  const repositoryHealth = repositoryHealthQuery.data;
  const hasError =
    threadQuery.isError ||
    statusQuery.isError ||
    pullRequestQuery.isError ||
    previewsQuery.isError;
  const hasRepositoryHealthError = repositoryHealthQuery.isError;
  const summary = useMemo(
    () =>
      summarizeRepositoryHealth({
        isLoading,
        previews: previewsQuery.data,
        pullRequest: pullRequestQuery.data,
        status: statusQuery.data,
        repositoryHealth,
      }),
    [
      isLoading,
      previewsQuery.data,
      pullRequestQuery.data,
      repositoryHealth,
      statusQuery.data,
    ],
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
    if (repositoryName !== null) void repositoryHealthQuery.refetch();
  };
  const setSecondaryPanel = useSetThreadSecondaryPanelSelection(
    threadId,
    threadId,
  );
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
      label="Repository Health"
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
          <span className="min-w-0 flex-1">
            Could not load repository health.
          </span>
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
        <p className={cn(RAIL_PROSE_CLASS, "py-1")}>
          Loading repository health…
        </p>
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
            onOpenChange={setAccountPickerOpen}
            open={accountPickerOpen}
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
                onSelect={() => setSecondaryPanel("pull-request")}
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
          {hasRepositoryHealthError ? (
            <RailRow
              icon="AlertTriangle"
              label="GitHub health unavailable"
              onSelect={() => void repositoryHealthQuery.refetch()}
              showsChevron
              trailing={<span className="text-xs text-destructive">Retry</span>}
            />
          ) : repositoryHealth?.outcome === "available" ? (
            repositoryHealth.repositories.map((repository) => (
              <RailRow
                key={repository.nameWithOwner}
                icon={
                  repository.defaultBranchCheckState === "failing"
                    ? "CircleX"
                    : repository.defaultBranchCheckState === "pending"
                      ? "Clock"
                      : "CircleCheck"
                }
                label={`${repository.defaultBranch ?? "Default branch"} checks`}
                trailing={
                  <span
                    className={cn(
                      "text-xs capitalize",
                      repository.defaultBranchCheckState === "failing"
                        ? "text-destructive"
                        : repository.defaultBranchCheckState === "pending"
                          ? "text-warning-text"
                          : repository.defaultBranchCheckState === "passing"
                            ? "text-success"
                            : "text-muted-foreground",
                    )}
                  >
                    {repository.defaultBranchCheckState === "none"
                      ? "No checks"
                      : repository.defaultBranchCheckState}
                  </span>
                }
              />
            ))
          ) : repositoryHealth?.outcome === "authentication_required" ? (
            <RailRow
              icon="Github"
              label="GitHub sign-in needed"
              onSelect={() => setAccountPickerOpen(true)}
              showsChevron
              trailing={
                <span className="text-xs text-destructive">Sign in</span>
              }
            />
          ) : repositoryHealth?.outcome === "rate_limited" ? (
            <RailRow
              icon="Clock"
              label="GitHub limit reached"
              trailing={
                <span className="text-xs text-warning-text">
                  {`Retries at ${formatGithubRetryAt(repositoryHealth.retryAt)}`}
                </span>
              }
            />
          ) : null}
          {repositoryHealth?.outcome === "available" ? (
            <RailRow
              icon="RotateCcw"
              label="GitHub updated"
              trailing={formatRelativeTime({
                timestamp: new Date(repositoryHealth.fetchedAt).getTime(),
                now: Date.now(),
              })}
            />
          ) : null}
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
