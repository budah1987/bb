import { useCallback, useEffect, useMemo } from "react";
import { useStore } from "jotai";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import type {
  PluginSidebarProject,
  PluginSidebarThread,
  PluginSidebarThreadActions,
  PluginSidebarThreadPullRequestState,
  PluginSidebarThreadsState,
} from "@get-bb/plugin-sdk";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import {
  getEnvironmentPullRequestFromResponse,
  useEnvironmentPullRequest,
} from "@/hooks/queries/environment-queries";
import { useHosts } from "@/hooks/queries/host-queries";
import {
  retainSidebarNavigationHydration,
  useSidebarNavigation,
} from "@/hooks/queries/sidebar-navigation-query";
import { useUpdateThread } from "@/hooks/mutations/thread-state-mutations";
import { useThreadSplitsEnabled } from "@/hooks/useThreadSplitsEnabled";
import { toPluginSidebarThread } from "./plugin-sidebar-threads";
import { useSetRootComposeProjectId } from "./root-compose-selection";
import { openThreadInSplit } from "./split-layout/openThreadInSplit";
import {
  getRootComposeRoutePath,
  getProjectComposeRoutePath,
  getThreadRoutePath,
} from "./route-paths";
import { resolvePluginWorkspaceDraftNavigationState } from "./plugin-new-thread-draft";
import {
  FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY,
  isThreadForkable,
  type ForkThreadCreateSeed,
} from "./fork-thread-request";
import { getThreadDisplayTitle } from "./thread-title";
import { sdk } from "./sdk";
import { threadDefaultExecutionOptionsQueryKey } from "@/hooks/queries/query-keys";

const EMPTY_THREADS: readonly PluginSidebarThread[] = [];
const EMPTY_PROJECTS: readonly PluginSidebarProject[] = [];
const EMPTY_ENTRIES: ReadonlyMap<string, ThreadListEntry> = new Map();

/**
 * The sidebar's live thread view for plugin surfaces.
 *
 * Built on `useSidebarNavigation`, the same query the built-in sidebar uses.
 * Plugin access loads any remaining pages before reporting a ready list, then
 * receives the same realtime updates as the built-in sidebar.
 *
 * `status` reports "error" only while there is nothing to show. Once data has
 * loaded, a failed background refresh keeps the last good list as "ready" —
 * the sidebar must not blank out because one refetch lost the network.
 */
export function useSidebarThreads(): PluginSidebarThreadsState {
  const query = useSidebarNavigation();
  const data = query.data;
  const queryClient = useQueryClient();
  const needsHydration = data?._threadPagination.complete === false;
  useEffect(() => {
    if (!needsHydration) return;
    return retainSidebarNavigationHydration(queryClient);
  }, [needsHydration, queryClient]);
  // The sidebar already subscribes to host updates; this reads the same
  // cached list so a row can print a machine name instead of a host id.
  const { data: hosts } = useHosts();
  const hostNamesById = useMemo(
    () => new Map((hosts ?? []).map((host) => [host.id, host.name] as const)),
    [hosts],
  );

  return useMemo<PluginSidebarThreadsState>(() => {
    if (data === undefined) {
      return {
        status: query.isError ? "error" : "loading",
        threads: EMPTY_THREADS,
        projects: EMPTY_PROJECTS,
      };
    }
    if (!data._threadPagination.complete) {
      return {
        status: "loading",
        threads: EMPTY_THREADS,
        projects: EMPTY_PROJECTS,
      };
    }
    // The personal project is a real project to a plugin list; the host just
    // stores it beside the others.
    const allProjects = [...data.projects, data.personalProject];
    return {
      status: "ready",
      threads: allProjects.flatMap((project) =>
        project.threads.map((thread) =>
          toPluginSidebarThread(thread, hostNamesById),
        ),
      ),
      projects: allProjects.map((project) => ({
        id: project.id,
        name: project.name,
        isPersonal: project.id === PERSONAL_PROJECT_ID,
        experimental_gitRemoteUrl: project.gitRemoteUrl,
        experimental_githubAccountLogin: project.githubAccountLogin,
      })),
    };
  }, [data, hostNamesById, query.isError]);
}

/** Thread id -> host entry, for O(1) lookups by id. */
export function useThreadEntryMap(): ReadonlyMap<string, ThreadListEntry> {
  const { data } = useSidebarNavigation();
  const queryClient = useQueryClient();
  const needsHydration = data?._threadPagination.complete === false;
  useEffect(() => {
    if (!needsHydration) return;
    return retainSidebarNavigationHydration(queryClient);
  }, [needsHydration, queryClient]);
  return useMemo(() => {
    if (data === undefined) return EMPTY_ENTRIES;
    const entries = new Map<string, ThreadListEntry>();
    for (const project of [...data.projects, data.personalProject]) {
      for (const thread of project.threads) entries.set(thread.id, thread);
    }
    return entries;
  }, [data]);
}

/** One host thread entry by id, or null while it is unknown. */
export function useSidebarThreadEntry(
  threadId: string,
): ThreadListEntry | null {
  return useThreadEntryMap().get(threadId) ?? null;
}

/**
 * Thread actions for plugin surfaces.
 *
 * Destructive and dialog-bearing actions route through `useThreadActions()` —
 * the host's own flow, with its confirmation dialogs, pane closing, and route
 * repair. A plugin cannot render bb's dialogs, so calling the raw mutations
 * here would delete a subtree with no confirmation and leave panes pointing at
 * dead threads.
 */
export function useSidebarThreadActions(): PluginSidebarThreadActions {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const store = useStore();
  const isCompact = useIsCompactViewport();
  const threadSplitsEnabled = useThreadSplitsEnabled();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const hostActions = useThreadActions();
  const entriesById = useThreadEntryMap();
  // Destructure `.mutateAsync`: the mutation object's identity changes on every
  // pending flip, which would defeat the memo below.
  const { mutateAsync: updateThreadAsync } = useUpdateThread();

  const requireEntry = useCallback(
    (threadId: string): ThreadListEntry => {
      const entry = entriesById.get(threadId);
      if (entry === undefined) {
        throw new Error(`Unknown thread: ${threadId}`);
      }
      return entry;
    },
    [entriesById],
  );

  return useMemo<PluginSidebarThreadActions>(
    () => ({
      open(threadId, options) {
        const entry = entriesById.get(threadId);
        if (entry === undefined) return;
        const { projectId } = entry;
        if (options?.split) {
          openThreadInSplit({
            store,
            navigate,
            projectId,
            threadId,
            isCompact,
            threadSplitsEnabled,
          });
          return;
        }
        navigate(getThreadRoutePath({ projectId, threadId }));
      },
      openNewThread(options) {
        const projectId = options?.projectId;
        if (projectId !== undefined) {
          // The compose screen reads its project from this stored selection,
          // and the personal project has no route of its own — without this a
          // personal-project request would create the thread in whichever
          // project the user last composed in.
          setRootComposeProjectId(projectId);
        }
        const sameEnvironmentRequest = options?.experimental_sameEnvironment;
        const requestedEnvironmentId = sameEnvironmentRequest?.environmentId;
        const reusableEnvironmentEntry =
          sameEnvironmentRequest === undefined
            ? undefined
            : [...entriesById.values()].find(
                (entry) =>
                  entry.environmentId === requestedEnvironmentId &&
                  (projectId === undefined || entry.projectId === projectId),
              );
        const sameEnvironmentState =
          sameEnvironmentRequest === undefined
            ? null
            : resolvePluginWorkspaceDraftNavigationState({
                environmentId: requestedEnvironmentId,
                fallbackProjectId: reusableEnvironmentEntry?.projectId,
                locked: sameEnvironmentRequest.locked,
                projectId,
              });
        const state =
          options?.focusPrompt ||
          options?.experimental_startGithubWorkflow ||
          sameEnvironmentState !== null
            ? {
                ...(options?.focusPrompt ? { focusPrompt: true } : {}),
                ...(options?.experimental_startGithubWorkflow
                  ? { startGithubWorkflow: true }
                  : {}),
                ...(sameEnvironmentState ?? {}),
              }
            : undefined;
        navigate(
          projectId === undefined
            ? getRootComposeRoutePath()
            : getProjectComposeRoutePath(projectId),
          state ? { state } : undefined,
        );
      },
      experimental_canOpenForkDraft(threadId) {
        return isThreadForkable(entriesById.get(threadId) ?? null);
      },
      async experimental_openForkDraft(threadId) {
        const sourceThread = requireEntry(threadId);
        if (!isThreadForkable(sourceThread)) return;
        const executionOptions = await queryClient.fetchQuery({
          queryKey: threadDefaultExecutionOptionsQueryKey(sourceThread.id),
          queryFn: ({ signal }) =>
            sdk.threads.defaultExecutionOptions({
              signal,
              threadId: sourceThread.id,
            }),
        });
        if (executionOptions === null || sourceThread.environmentId === null) {
          return;
        }
        const seed: ForkThreadCreateSeed = {
          environmentId: sourceThread.environmentId,
          model: executionOptions.model,
          permissionMode: executionOptions.permissionMode,
          projectId: sourceThread.projectId,
          providerId: sourceThread.providerId,
          reasoningLevel: executionOptions.reasoningLevel,
          serviceTier: executionOptions.serviceTier,
          sourceSeqEnd: undefined,
          sourceThreadId: sourceThread.id,
          sourceThreadTitle: getThreadDisplayTitle(sourceThread),
        };
        setRootComposeProjectId(sourceThread.projectId);
        navigate(getRootComposeRoutePath(), {
          state: {
            focusPrompt: true,
            reuseEnvironmentId: sourceThread.environmentId,
            [FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY]: seed,
          },
        });
      },
      async setPinned(threadId, pinned) {
        const entry = requireEntry(threadId);
        if ((entry.pinnedAt !== null) === pinned) return;
        hostActions.togglePin(entry);
      },
      async setRead(threadId, read) {
        const entry = requireEntry(threadId);
        const isExplicitlyRead = entry.lastReadAt === entry.latestAttentionAt;
        if (isExplicitlyRead === read) return;
        hostActions.toggleRead(entry);
      },
      async rename(threadId, title) {
        await updateThreadAsync({ id: threadId, title });
      },
      archive(threadId) {
        hostActions.archiveThreadAndChildren(requireEntry(threadId));
      },
      requestDelete(threadId, options) {
        // Opens bb's delete dialog, which counts child threads and asks. The
        // plugin requests; the user confirms.
        const fallbackThreadId = options?.experimental_fallbackThreadId;
        hostActions.requestDelete(
          requireEntry(threadId),
          fallbackThreadId === undefined
            ? undefined
            : { fallbackThread: requireEntry(fallbackThreadId) },
        );
      },
    }),
    [
      entriesById,
      hostActions,
      isCompact,
      navigate,
      queryClient,
      requireEntry,
      setRootComposeProjectId,
      store,
      threadSplitsEnabled,
      updateThreadAsync,
    ],
  );
}

/**
 * The pull request for one thread's branch.
 *
 * Deliberately per row rather than a field on `useSidebarThreads`: a PR lookup
 * hits the git host, so it must be opt-in and paid only for rows that want it.
 * The underlying query is keyed by environment, so threads sharing a worktree
 * share one lookup, and the host's own staleness and refetch rules apply (an
 * open PR with pending checks polls; a merged one does not).
 */
export function useSidebarThreadPullRequest(
  threadId: string,
): PluginSidebarThreadPullRequestState {
  const entry = useSidebarThreadEntry(threadId);
  const environmentId = entry?.environmentId ?? null;
  const query = useEnvironmentPullRequest(environmentId, {
    accountLogin: null,
  });
  const pullRequest = getEnvironmentPullRequestFromResponse(query.data);

  return useMemo<PluginSidebarThreadPullRequestState>(
    () => ({
      isLoading: environmentId !== null && query.isPending,
      pullRequest:
        pullRequest === null
          ? null
          : {
              number: pullRequest.number,
              title: pullRequest.title,
              url: pullRequest.url,
              state: pullRequest.state,
              attention: pullRequest.attention,
            },
    }),
    [environmentId, pullRequest, query.isPending],
  );
}
