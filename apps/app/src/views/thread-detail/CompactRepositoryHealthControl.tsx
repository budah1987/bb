import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import {
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
import { parseGithubRepositoryName } from "@/lib/github-repository";
import {
  formatGithubRetryAt,
  summarizeRepositoryHealth,
} from "@/lib/repository-health-summary";
import { statusTierClassName } from "@/lib/status-tier";

export function CompactRepositoryHealthControl({
  enabled,
  onOpen,
  threadId,
}: {
  enabled: boolean;
  onOpen: () => void;
  threadId: string;
}) {
  const threadQuery = useThread(threadId, { enabled });
  const environmentQuery = useEnvironment(threadQuery.data?.environmentId, {
    enabled,
  });
  const environment = environmentQuery.data;
  const navigationQuery = useSidebarNavigation({ enabled });
  const project = navigationQuery.data?.projects.find(
    (candidate) => candidate.id === environment?.projectId,
  );
  const repository = parseGithubRepositoryName(project?.gitRemoteUrl ?? null);
  const accountsQuery = useGithubAccounts({
    ...(environment?.hostId === undefined
      ? {}
      : { hostId: environment.hostId }),
    enabled: enabled && environment !== undefined,
  });
  const accounts = accountsQuery.data?.accounts ?? [];
  const login =
    environment?.githubAccountLogin ??
    accounts.find((account) => account.active)?.login ??
    accounts[0]?.login ??
    null;
  const healthQuery = useGithubRepositoryHealth({
    githubAccountLogin: login,
    repositories: repository === null ? [] : [repository],
    refresh: "allow-fetch",
    ...(environment?.hostId === undefined
      ? {}
      : { hostId: environment.hostId }),
    enabled: enabled && login !== null && repository !== null,
  });
  const statusQuery = useEnvironmentWorkStatus(
    threadQuery.data?.environmentId,
    undefined,
    { enabled },
  );
  const pullRequestQuery = useEnvironmentPullRequest(
    threadQuery.data?.environmentId,
    {
      accountLogin: login,
      enabled: enabled && login !== null,
    },
  );
  const previewsQuery = useEnvironmentPreviews(
    threadQuery.data?.environmentId,
    {
      enabled,
    },
  );
  if (!enabled || repository === null) return null;
  const summary = summarizeRepositoryHealth({
    isLoading:
      threadQuery.isLoading ||
      environmentQuery.isLoading ||
      navigationQuery.isLoading ||
      accountsQuery.isLoading ||
      healthQuery.isLoading ||
      statusQuery.isLoading ||
      pullRequestQuery.isLoading ||
      previewsQuery.isLoading,
    previews: previewsQuery.data,
    pullRequest: pullRequestQuery.data,
    repositoryHealth: healthQuery.data,
    status: statusQuery.data,
  });
  const rateLimitLabel =
    healthQuery.data?.outcome === "rate_limited"
      ? `GitHub limit reached — retries at ${formatGithubRetryAt(healthQuery.data.retryAt)}`
      : null;
  const accessibleLabel = rateLimitLabel ?? summary.label;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        HEADER_ICON_BUTTON_CLASS,
        "w-auto gap-1.5 px-2 text-xs",
        statusTierClassName(summary.tier),
      )}
      aria-label={`Repository health: ${accessibleLabel}`}
      onClick={onOpen}
    >
      <Icon name="GitPullRequest" aria-hidden />
      <span>{rateLimitLabel === null ? summary.label : "Limited"}</span>
    </Button>
  );
}
