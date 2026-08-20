import { lazy, useCallback, useEffect, useMemo, useState } from "react";
import type {
  PluginNavPanelProps,
  PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import type { RepositoryDetailsNativeGithubContext } from "bb-plugin-conductor-workspaces/core";
import { Button } from "@bb/shared-ui/button";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  useGithubPullRequests,
  useGithubRepositoryActivity,
  useGithubRepositoryHealth,
} from "@/hooks/queries/system-queries";
import { parseGithubRepositoryName } from "@/lib/github-repository";
import { useSetFixedSecondaryPanelTabForThread } from "@/lib/fixed-panel-tabs";
import type {
  PluginNavPanelSlot,
  PluginThreadListSlot,
} from "@/lib/plugin-slots";
import "bb-plugin-conductor-workspaces/conductor.css";

const loadConductor = () => import("bb-plugin-conductor-workspaces/core");

const ConductorSidebar = lazy(() =>
  loadConductor().then(({ ConductorSidebar: component }) => ({
    default: component,
  })),
);

type GithubAttention =
  | "checks_failed"
  | "conflicts"
  | "changes_requested"
  | "checks_pending"
  | "review_requested";

interface AttentionBatch {
  githubAccountLogin: string;
  hostId: string;
  id: string;
  projectsByRepository: Readonly<Record<string, readonly string[]>>;
  repositories: readonly string[];
}

function ConductorAttentionBatch({
  batch,
  onResult,
}: {
  batch: AttentionBatch;
  onResult: (
    id: string,
    value: Readonly<Record<string, GithubAttention>>,
  ) => void;
}) {
  const query = useGithubRepositoryHealth({
    githubAccountLogin: batch.githubAccountLogin,
    hostId: batch.hostId,
    refresh: "cached",
    repositories: batch.repositories,
  });
  useEffect(() => {
    const result: Record<string, GithubAttention> = {};
    if (query.data?.outcome === "available") {
      for (const repository of query.data.repositories) {
        const attention =
          repository.attention !== "none"
            ? repository.attention
            : repository.defaultBranchCheckState === "failing"
              ? "checks_failed"
              : repository.defaultBranchCheckState === "pending"
                ? "checks_pending"
                : null;
        if (attention === null) continue;
        for (const projectId of batch.projectsByRepository[
          repository.nameWithOwner
        ] ?? []) {
          result[projectId] = attention;
        }
      }
    }
    onResult(batch.id, result);
  }, [batch.id, batch.projectsByRepository, onResult, query.data]);
  return null;
}

function NativeGithubConductorSidebar(props: PluginThreadListProps) {
  const navigationQuery = useSidebarNavigation();
  const setSecondaryPanelForThread = useSetFixedSecondaryPanelTabForThread();
  const batches = useMemo(() => {
    const grouped = new Map<
      string,
      {
        githubAccountLogin: string;
        hostId: string;
        projectsByRepository: Record<string, string[]>;
      }
    >();
    for (const project of navigationQuery.data?.projects ?? []) {
      const repository = parseGithubRepositoryName(project.gitRemoteUrl);
      const hostId =
        project.sources.find((source) => source.isDefault)?.hostId ??
        project.sources[0]?.hostId;
      if (repository === null || hostId === undefined) continue;
      const githubAccountLogin = project.githubAccountLogin;
      if (githubAccountLogin === null) continue;
      const key = `${hostId}\n${githubAccountLogin.toLocaleLowerCase()}`;
      const group = grouped.get(key) ?? {
        githubAccountLogin,
        hostId,
        projectsByRepository: {},
      };
      group.projectsByRepository[repository] = [
        ...(group.projectsByRepository[repository] ?? []),
        project.id,
      ];
      grouped.set(key, group);
    }
    return [...grouped.entries()].flatMap(([groupId, group]) => {
      const repositories = Object.keys(group.projectsByRepository).sort();
      const result: AttentionBatch[] = [];
      for (let index = 0; index < repositories.length; index += 50) {
        const chunk = repositories.slice(index, index + 50);
        result.push({
          githubAccountLogin: group.githubAccountLogin,
          hostId: group.hostId,
          id: `${groupId}\n${index / 50}`,
          projectsByRepository: Object.fromEntries(
            chunk.map((repository) => [
              repository,
              group.projectsByRepository[repository] ?? [],
            ]),
          ),
          repositories: chunk,
        });
      }
      return result;
    });
  }, [navigationQuery.data]);
  const [results, setResults] = useState<
    ReadonlyMap<string, Readonly<Record<string, GithubAttention>>>
  >(new Map());
  const handleResult = useCallback(
    (id: string, value: Readonly<Record<string, GithubAttention>>) => {
      setResults((current) => {
        const next = new Map(current);
        next.set(id, value);
        return next;
      });
    },
    [],
  );
  const activeBatchIds = new Set(batches.map((batch) => batch.id));
  const githubAttentionByProjectId = Object.assign(
    {},
    ...[...results.entries()]
      .filter(([id]) => activeBatchIds.has(id))
      .map(([, result]) => result),
  ) as Readonly<Record<string, GithubAttention>>;
  return (
    <>
      {batches.map((batch) => (
        <ConductorAttentionBatch
          key={batch.id}
          batch={batch}
          onResult={handleResult}
        />
      ))}
      <ConductorSidebar
        {...props}
        githubAttentionByProjectId={githubAttentionByProjectId}
        onOpenGithubAttention={(threadId) =>
          setSecondaryPanelForThread(threadId, "pull-request")
        }
      />
    </>
  );
}
const ConductorContextBar = lazy(() =>
  loadConductor().then(({ ConductorContextBar: component }) => ({
    default: component,
  })),
);
const ConductorNewThreadContextBar = lazy(() =>
  loadConductor().then(({ ConductorNewThreadContextBar: component }) => ({
    default: component,
  })),
);
const ConductorNewThreadEmptyState = lazy(() =>
  loadConductor().then(({ ConductorNewThreadEmptyState: component }) => ({
    default: component,
  })),
);
const RepositoryDetailsPane = lazy(() =>
  loadConductor().then(({ RepositoryDetailsPane: component }) => ({
    default: component,
  })),
);

function NativeRepositoryGithubContent({
  githubAccountLogin,
  projectId,
  repositoryName,
}: RepositoryDetailsNativeGithubContext) {
  const navigationQuery = useSidebarNavigation();
  const project = navigationQuery.data?.projects.find(
    (candidate) => candidate.id === projectId,
  );
  const hostId =
    project?.sources.find((source) => source.isDefault)?.hostId ??
    project?.sources[0]?.hostId;
  const healthQuery = useGithubRepositoryHealth({
    githubAccountLogin,
    repositories: repositoryName === null ? [] : [repositoryName],
    refresh: "allow-fetch",
    ...(hostId === undefined ? {} : { hostId }),
    enabled:
      githubAccountLogin !== null &&
      repositoryName !== null &&
      hostId !== undefined,
  });
  const pullRequestsQuery = useGithubPullRequests({
    githubAccountLogin,
    repository: repositoryName ?? "",
    ...(hostId === undefined ? {} : { hostId }),
    enabled:
      githubAccountLogin !== null &&
      repositoryName !== null &&
      hostId !== undefined,
  });
  const activityQuery = useGithubRepositoryActivity({
    githubAccountLogin,
    repository: repositoryName ?? "",
    ...(hostId === undefined ? {} : { hostId }),
    enabled:
      githubAccountLogin !== null &&
      repositoryName !== null &&
      hostId !== undefined,
  });
  if (githubAccountLogin === null || repositoryName === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Choose GitHub Account from the repository menu to load native details.
      </p>
    );
  }
  if (
    healthQuery.isLoading ||
    pullRequestsQuery.isLoading ||
    activityQuery.isLoading
  ) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading GitHub details…
      </p>
    );
  }
  if (
    healthQuery.isError ||
    pullRequestsQuery.isError ||
    activityQuery.isError
  ) {
    return (
      <div className="flex items-center gap-3" role="alert">
        <p className="text-sm text-destructive">
          Could not load GitHub details.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void healthQuery.refetch();
            void pullRequestsQuery.refetch();
            void activityQuery.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
  const health = healthQuery.data;
  const pullRequests = pullRequestsQuery.data?.pullRequests ?? [];
  const activity =
    activityQuery.data?.outcome === "available" ? activityQuery.data : null;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section aria-labelledby="native-github-health-heading">
        <h2 id="native-github-health-heading" className="text-sm font-medium">
          Repository health
        </h2>
        {health?.outcome === "available" ? (
          health.repositories.map((repository) => (
            <div
              key={repository.nameWithOwner}
              className="mt-2 grid gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-3"
            >
              <span>Default checks: {repository.defaultBranchCheckState}</span>
              <span>Open PRs: {repository.openPullRequestCount}</span>
              <span>
                Attention: {repository.attention.replaceAll("_", " ")}
              </span>
            </div>
          ))
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {health?.message ?? "Repository health has not loaded."}
          </p>
        )}
      </section>
      <section aria-labelledby="native-github-prs-heading">
        <h2 id="native-github-prs-heading" className="text-sm font-medium">
          Open pull requests
        </h2>
        {pullRequests.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No open pull requests.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {pullRequests.map((pullRequest) => (
              <li key={pullRequest.number}>
                <a
                  className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm hover:bg-state-hover"
                  href={pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="shrink-0 tabular-nums">
                    #{pullRequest.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {pullRequest.title}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {pullRequest.isDraft ? "Draft" : "Open"}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="native-github-actions-heading">
        <h2 id="native-github-actions-heading" className="text-sm font-medium">
          Recent Actions
        </h2>
        {activity?.workflowRuns.length ? (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {activity.workflowRuns.map((run) => (
              <li key={run.id}>
                <a
                  className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm hover:bg-state-hover"
                  href={run.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="min-w-0 flex-1 truncate">{run.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {run.conclusion ?? run.status}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No recent workflow runs.
          </p>
        )}
      </section>
      <section aria-labelledby="native-github-issues-heading">
        <h2 id="native-github-issues-heading" className="text-sm font-medium">
          Open issues
        </h2>
        {activity?.issues.length ? (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {activity.issues.map((issue) => (
              <li key={issue.number}>
                <a
                  className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm hover:bg-state-hover"
                  href={issue.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="shrink-0 tabular-nums">#{issue.number}</span>
                  <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No open issues.</p>
        )}
      </section>
      <section aria-labelledby="native-github-inbox-heading">
        <h2 id="native-github-inbox-heading" className="text-sm font-medium">
          Repository inbox
        </h2>
        {activity?.inbox.length ? (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {activity.inbox.map((item) => (
              <li key={item.id}>
                {item.url ? (
                  <a
                    className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm hover:bg-state-hover"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {item.title}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {item.reason.replaceAll("_", " ")}
                    </span>
                  </a>
                ) : (
                  <div className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {item.title}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {item.reason.replaceAll("_", " ")}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No unread repository notifications.
          </p>
        )}
      </section>
    </div>
  );
}

function NativeGithubRepositoryDetailsPane(props: PluginNavPanelProps) {
  return (
    <RepositoryDetailsPane
      {...props}
      renderNativeGithub={(context) => (
        <NativeRepositoryGithubContent {...context} />
      )}
    />
  );
}

export const CONDUCTOR_THREAD_LIST_PROVIDER_KEY =
  "conductor-workspaces/conductor";
export const CONDUCTOR_REPOSITORY_DETAILS_PANEL_KEY =
  "conductor-workspaces/repository-details";

/**
 * Host-bundled Conductor presentation. The plugin id keeps existing RPC and
 * navigation context working while its server responsibilities move into BB.
 */
export const conductorThreadListProvider: PluginThreadListSlot = {
  pluginId: "conductor-workspaces",
  generation: 0,
  id: "conductor",
  title: "BBamir",
  description: "Repositories, isolated workspaces, and conversation tabs.",
  component: NativeGithubConductorSidebar,
  experimental_contextBar: ConductorContextBar,
  experimental_newThreadContextBar: ConductorNewThreadContextBar,
  experimental_newThreadEmptyState: ConductorNewThreadEmptyState,
};

export const conductorRepositoryDetailsPanel: PluginNavPanelSlot = {
  pluginId: "conductor-workspaces",
  generation: 0,
  id: "repository-details",
  title: "Repository Details",
  icon: "GitBranch",
  path: "repository-details",
  component: NativeGithubRepositoryDetailsPane,
};
