import { useQuery, type QueryClient } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import { apiClient } from "@/lib/api-server";
import { request, requestOptions } from "@/lib/api";
import { sdk } from "@/lib/sdk";
import { updateCachedSidebarNavigation } from "@/hooks/cache-owners/query-cache";
import {
  useEnvironmentListRealtimeSubscription,
  useHostListRealtimeSubscription,
  useProjectListRealtimeSubscription,
  useThreadListRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";
import { REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY } from "./query-policies";

export const SIDEBAR_NAVIGATION_QUERY_KEY = "sidebarNavigation";
const SIDEBAR_INITIAL_THREAD_LIMIT = 50;
const SIDEBAR_BACKGROUND_THREAD_PAGE_SIZE = 200;

interface SidebarThreadPaginationState {
  complete: boolean;
  completeProjectIds: string[];
  generation: number;
  initialLimit: number;
  nextCursorByProjectId: Record<string, string | null>;
}

export type SidebarNavigationCacheResponse = SidebarBootstrapResponse & {
  _threadPagination: SidebarThreadPaginationState;
};

const sidebarProjectLoads = new WeakMap<
  QueryClient,
  Map<string, Promise<void>>
>();
let sidebarNavigationGeneration = 0;

export type SidebarNavigationQueryKey = readonly [
  typeof SIDEBAR_NAVIGATION_QUERY_KEY,
];

interface QueryOptions {
  enabled?: boolean;
}

export function sidebarNavigationQueryKey(): SidebarNavigationQueryKey {
  return [SIDEBAR_NAVIGATION_QUERY_KEY];
}

export function fetchSidebarNavigation(
  signal?: AbortSignal,
): Promise<SidebarNavigationCacheResponse> {
  return request<SidebarBootstrapResponse>(
    apiClient["sidebar-bootstrap"].$get(
      { query: { threadLimit: String(SIDEBAR_INITIAL_THREAD_LIMIT) } },
      requestOptions(signal),
    ),
  ).then((response) => {
    const projects = [...response.projects, response.personalProject];
    const completeProjectIds = projects
      .filter(
        (project) => response.nextThreadCursorByProjectId[project.id] === null,
      )
      .map((project) => project.id);
    return {
      ...response,
      _threadPagination: {
        complete: completeProjectIds.length === projects.length,
        completeProjectIds,
        generation: (sidebarNavigationGeneration += 1),
        initialLimit: SIDEBAR_INITIAL_THREAD_LIMIT,
        nextCursorByProjectId: response.nextThreadCursorByProjectId,
      },
    };
  });
}

function mergeSidebarThreadPage(
  existingThreads: ProjectWithThreadsResponse["threads"],
  page: ProjectWithThreadsResponse["threads"],
): ProjectWithThreadsResponse["threads"] {
  const pageThreadIds = new Set(page.map((thread) => thread.id));
  return [
    ...existingThreads.filter((thread) => !pageThreadIds.has(thread.id)),
    ...page,
  ];
}

export function sidebarProjectHasMore(
  navigation: SidebarNavigationCacheResponse | undefined,
  projectId: string,
): boolean {
  return (
    navigation !== undefined &&
    !navigation._threadPagination.completeProjectIds.includes(projectId)
  );
}

export function loadMoreSidebarProjectThreads(
  queryClient: QueryClient,
  projectId: string,
): Promise<void> {
  const navigation = queryClient.getQueryData<SidebarNavigationCacheResponse>(
    sidebarNavigationQueryKey(),
  );
  if (!sidebarProjectHasMore(navigation, projectId)) {
    return Promise.resolve();
  }
  let projectLoads = sidebarProjectLoads.get(queryClient);
  if (projectLoads === undefined) {
    projectLoads = new Map();
    sidebarProjectLoads.set(queryClient, projectLoads);
  }
  const currentLoad = projectLoads.get(projectId);
  if (currentLoad !== undefined) return currentLoad;

  const generation = navigation!._threadPagination.generation;
  const cursor = navigation!._threadPagination.nextCursorByProjectId[projectId];
  if (cursor === null || cursor === undefined) {
    return Promise.resolve();
  }
  const load = sdk.projects
    .sidebarThreads({
      cursor,
      limit: String(SIDEBAR_BACKGROUND_THREAD_PAGE_SIZE),
      projectId,
    })
    .then((response) => {
      const page = response.threads;
      updateCachedSidebarNavigation<SidebarNavigationCacheResponse>({
        queryClient,
        updater: (current) => {
          if (
            current === undefined ||
            current._threadPagination.generation !== generation
          ) {
            return current;
          }
          const completeProjectIds =
            response.nextCursor === null
              ? [
                  ...new Set([
                    ...current._threadPagination.completeProjectIds,
                    projectId,
                  ]),
                ]
              : current._threadPagination.completeProjectIds;
          const projects = [...current.projects, current.personalProject];
          const pagination = {
            ...current._threadPagination,
            complete: completeProjectIds.length === projects.length,
            completeProjectIds,
            nextCursorByProjectId: {
              ...current._threadPagination.nextCursorByProjectId,
              [projectId]: response.nextCursor,
            },
          };
          if (current.personalProject.id === projectId) {
            return {
              ...current,
              _threadPagination: pagination,
              personalProject: {
                ...current.personalProject,
                threads: mergeSidebarThreadPage(
                  current.personalProject.threads,
                  page,
                ),
              },
            };
          }
          return {
            ...current,
            _threadPagination: pagination,
            projects: current.projects.map((project) =>
              project.id === projectId
                ? {
                    ...project,
                    threads: mergeSidebarThreadPage(project.threads, page),
                  }
                : project,
            ),
          };
        },
      });
    })
    .finally(() => {
      projectLoads?.delete(projectId);
    });
  projectLoads.set(projectId, load);
  return load;
}

async function hydrateSidebarProjectThreads(
  queryClient: QueryClient,
  projectId: string,
): Promise<void> {
  while (true) {
    const navigation = queryClient.getQueryData<SidebarNavigationCacheResponse>(
      sidebarNavigationQueryKey(),
    );
    if (!sidebarProjectHasMore(navigation, projectId)) return;
    await loadMoreSidebarProjectThreads(queryClient, projectId);
  }
}

export async function ensureSidebarNavigationHydrated(
  queryClient: QueryClient,
  navigation: SidebarNavigationCacheResponse,
): Promise<void> {
  const projects = [...navigation.projects, navigation.personalProject].filter(
    (project) => sidebarProjectHasMore(navigation, project.id),
  );
  await Promise.all(
    projects.map((project) =>
      hydrateSidebarProjectThreads(queryClient, project.id),
    ),
  );
}

export async function loadMoreSidebarThreads(
  queryClient: QueryClient,
  projectIds: readonly string[],
): Promise<void> {
  await Promise.all(
    projectIds.map((projectId) =>
      loadMoreSidebarProjectThreads(queryClient, projectId),
    ),
  );
}

export function useSidebarNavigation(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useEnvironmentListRealtimeSubscription({ enabled });
  useHostListRealtimeSubscription({ enabled });
  useProjectListRealtimeSubscription({ enabled });
  useThreadListRealtimeSubscription({ enabled });

  return useQuery<SidebarNavigationCacheResponse>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: ({ signal }) => fetchSidebarNavigation(signal),
    enabled,
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
  });
}

/**
 * Read the active project's display name from the shared sidebar-navigation
 * cache. The sidebar owns the realtime subscriptions and initial load; this only
 * reads the cached projects (no extra subscriptions) so surfaces like the
 * follow-up composer footer can label the current project. Returns undefined
 * until the cache is populated or when the project is unknown.
 */
export function useProjectDisplayName(
  projectId: string | undefined,
): string | undefined {
  const { data } = useQuery<SidebarNavigationCacheResponse>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: ({ signal }) => fetchSidebarNavigation(signal),
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
    // Nothing to resolve without a project id (e.g. personal threads), so don't
    // trigger the bootstrap fetch from this read-only selector.
    enabled: Boolean(projectId),
  });
  if (!data || !projectId) {
    return undefined;
  }
  if (projectId === PERSONAL_PROJECT_ID) {
    return data.personalProject.name;
  }
  return data.projects.find((project) => project.id === projectId)?.name;
}
