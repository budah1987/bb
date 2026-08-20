import type {
  EnvironmentPreviewsResponse,
  EnvironmentPullRequestResponse,
  EnvironmentStatusResponse,
} from "@bb/server-contract";
import type { GithubRepositoryHealthResult } from "@bb/host-daemon-contract";
import { getEnvironmentPullRequestFromResponse } from "@/hooks/queries/environment-queries";
import type { StatusTier } from "@/lib/status-tier";

export interface RepositoryHealthSummary {
  label: string;
  tier: StatusTier;
}

export function formatGithubRetryAt(retryAt: string): string {
  const value = new Date(retryAt);
  if (Number.isNaN(value.getTime())) return "later";
  return value.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function summarizeRepositoryHealth(args: {
  isLoading: boolean;
  previews: EnvironmentPreviewsResponse | undefined;
  pullRequest: EnvironmentPullRequestResponse | undefined;
  status: EnvironmentStatusResponse | undefined;
  repositoryHealth?: GithubRepositoryHealthResult;
}): RepositoryHealthSummary {
  if (args.isLoading) return { label: "Loading", tier: "muted" };
  if (args.status?.outcome !== "available") {
    return { label: "Unavailable", tier: "destructive" };
  }
  if (args.repositoryHealth?.outcome === "authentication_required") {
    return { label: "Sign in", tier: "destructive" };
  }
  if (args.repositoryHealth?.outcome === "rate_limited") {
    return { label: "Limited", tier: "warning" };
  }
  if (args.repositoryHealth?.outcome === "unavailable") {
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
    pullRequest?.attention === "blocked" ||
    (args.repositoryHealth?.outcome === "available" &&
      args.repositoryHealth.repositories.some(
        (repository) =>
          repository.defaultBranchCheckState === "failing" ||
          ["checks_failed", "conflicts", "changes_requested"].includes(
            repository.attention,
          ),
      ))
  ) {
    return { label: "Needs attention", tier: "destructive" };
  }
  if (
    args.status.workspace.workingTree.hasUncommittedChanges ||
    (args.status.workspace.mergeBase?.behindCount ?? 0) > 0 ||
    deploymentStates.includes("building") ||
    pullRequest?.attention === "checks_pending" ||
    pullRequest?.attention === "review_requested" ||
    (args.repositoryHealth?.outcome === "available" &&
      args.repositoryHealth.repositories.some(
        (repository) =>
          repository.defaultBranchCheckState === "pending" ||
          ["checks_pending", "review_requested"].includes(repository.attention),
      ))
  ) {
    return { label: "In progress", tier: "warning" };
  }
  return { label: "Healthy", tier: "success" };
}
