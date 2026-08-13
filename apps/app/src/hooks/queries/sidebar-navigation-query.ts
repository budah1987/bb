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

interface DeferredPageLoad {
  reject(error: unknown): void;
  resolve(): void;
}

interface ForegroundPageLoad {
  deferreds: DeferredPageLoad[];
  projectId: string;
}

interface ActivePageLoad {
  background: boolean;
  controller: AbortController;
  foregroundDeferreds: DeferredPageLoad[];
  projectId: string;
}

interface HydrationCompletionWaiter {
  reject(error: unknown): void;
  resolve(): void;
}

class SidebarThreadHydrationCoordinator {
  private active: ActivePageLoad | null = null;
  private backgroundProjectIndex = 0;
  private backgroundPausedAfterError = false;
  private readonly completionWaiters = new Set<HydrationCompletionWaiter>();
  private readonly foregroundByProjectId = new Map<
    string,
    ForegroundPageLoad
  >();
  private readonly foregroundQueue: ForegroundPageLoad[] = [];
  private leaseCount = 0;
  private visibilityListenerInstalled = false;

  constructor(private readonly queryClient: QueryClient) {}

  retainBackgroundHydration(): () => void {
    this.leaseCount += 1;
    this.backgroundPausedAfterError = false;
    this.syncVisibilityListener();
    this.pump();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leaseCount = Math.max(0, this.leaseCount - 1);
      if (!this.hasBackgroundDemand()) {
        this.abortUnclaimedBackgroundLoad();
      }
      this.syncVisibilityListener();
    };
  }

  ensureHydrated(): Promise<void> {
    const navigation = this.getNavigation();
    if (navigation === undefined || navigation._threadPagination.complete) {
      return Promise.resolve();
    }
    this.backgroundPausedAfterError = false;
    const completion = new Promise<void>((resolve, reject) => {
      this.completionWaiters.add({ reject, resolve });
    });
    this.syncVisibilityListener();
    this.pump();
    return completion;
  }

  loadForegroundPage(projectId: string): Promise<void> {
    const navigation = this.getNavigation();
    if (!sidebarProjectHasMore(navigation, projectId)) {
      return Promise.resolve();
    }

    const completion = new Promise<void>((resolve, reject) => {
      const deferred = { reject, resolve };
      if (
        this.active?.projectId === projectId &&
        !this.active.controller.signal.aborted
      ) {
        this.active.foregroundDeferreds.push(deferred);
        return;
      }
      const queued = this.foregroundByProjectId.get(projectId);
      if (queued !== undefined) {
        queued.deferreds.push(deferred);
        return;
      }
      const request = { deferreds: [deferred], projectId };
      this.foregroundByProjectId.set(projectId, request);
      this.foregroundQueue.push(request);
    });
    this.pump();
    return completion;
  }

  private abortUnclaimedBackgroundLoad(): void {
    if (this.active !== null && this.active.foregroundDeferreds.length === 0) {
      this.active.controller.abort();
    }
  }

  private completeHydration(): void {
    for (const waiter of this.completionWaiters) waiter.resolve();
    this.completionWaiters.clear();
    this.syncVisibilityListener();
  }

  private failHydration(error: unknown): void {
    for (const waiter of this.completionWaiters) waiter.reject(error);
    this.completionWaiters.clear();
    this.syncVisibilityListener();
  }

  private getNavigation(): SidebarNavigationCacheResponse | undefined {
    return this.queryClient.getQueryData<SidebarNavigationCacheResponse>(
      sidebarNavigationQueryKey(),
    );
  }

  private hasBackgroundDemand(): boolean {
    return this.leaseCount > 0 || this.completionWaiters.size > 0;
  }

  private isDocumentHidden(): boolean {
    return (
      typeof document !== "undefined" && document.visibilityState === "hidden"
    );
  }

  private nextBackgroundProjectId(
    navigation: SidebarNavigationCacheResponse,
  ): string | null {
    const projectIds = [
      ...navigation.projects.map((project) => project.id),
      navigation.personalProject.id,
    ].filter((projectId) => sidebarProjectHasMore(navigation, projectId));
    if (projectIds.length === 0) return null;
    const index = this.backgroundProjectIndex % projectIds.length;
    this.backgroundProjectIndex = (index + 1) % projectIds.length;
    return projectIds[index] ?? null;
  }

  private pump(): void {
    if (this.active !== null) return;

    const foreground = this.foregroundQueue.shift();
    if (foreground !== undefined) {
      this.foregroundByProjectId.delete(foreground.projectId);
      this.startPageLoad(foreground.projectId, foreground.deferreds, false);
      return;
    }

    if (!this.hasBackgroundDemand()) {
      this.syncVisibilityListener();
      return;
    }
    const navigation = this.getNavigation();
    if (navigation === undefined || navigation._threadPagination.complete) {
      this.completeHydration();
      return;
    }
    if (this.backgroundPausedAfterError || this.isDocumentHidden()) {
      this.syncVisibilityListener();
      return;
    }
    const projectId = this.nextBackgroundProjectId(navigation);
    if (projectId === null) {
      this.completeHydration();
      return;
    }
    this.startPageLoad(projectId, [], true);
  }

  private startPageLoad(
    projectId: string,
    foregroundDeferreds: DeferredPageLoad[],
    background: boolean,
  ): void {
    const controller = new AbortController();
    const active = { background, controller, foregroundDeferreds, projectId };
    this.active = active;
    void loadSidebarProjectThreadPage(
      this.queryClient,
      projectId,
      controller.signal,
    )
      .then(() => {
        for (const deferred of active.foregroundDeferreds) deferred.resolve();
      })
      .catch((error: unknown) => {
        for (const deferred of active.foregroundDeferreds) {
          deferred.reject(error);
        }
        if (!controller.signal.aborted && active.background) {
          this.backgroundPausedAfterError = true;
          this.failHydration(error);
        }
      })
      .then(() => {
        if (this.active === active) this.active = null;
        this.pump();
      });
  }

  private syncVisibilityListener(): void {
    if (typeof document === "undefined") return;
    const needed = this.hasBackgroundDemand();
    if (needed && !this.visibilityListenerInstalled) {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      this.visibilityListenerInstalled = true;
      return;
    }
    if (!needed && this.visibilityListenerInstalled) {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.visibilityListenerInstalled = false;
    }
  }

  private readonly onVisibilityChange = (): void => {
    if (!this.isDocumentHidden()) this.pump();
  };
}

const sidebarHydrationCoordinators = new WeakMap<
  QueryClient,
  SidebarThreadHydrationCoordinator
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

function getSidebarHydrationCoordinator(
  queryClient: QueryClient,
): SidebarThreadHydrationCoordinator {
  let coordinator = sidebarHydrationCoordinators.get(queryClient);
  if (coordinator === undefined) {
    coordinator = new SidebarThreadHydrationCoordinator(queryClient);
    sidebarHydrationCoordinators.set(queryClient, coordinator);
  }
  return coordinator;
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

async function loadSidebarProjectThreadPage(
  queryClient: QueryClient,
  projectId: string,
  signal: AbortSignal,
): Promise<void> {
  const navigation = queryClient.getQueryData<SidebarNavigationCacheResponse>(
    sidebarNavigationQueryKey(),
  );
  if (!sidebarProjectHasMore(navigation, projectId)) {
    return Promise.resolve();
  }
  const generation = navigation!._threadPagination.generation;
  const cursor = navigation!._threadPagination.nextCursorByProjectId[projectId];
  if (cursor === null || cursor === undefined) {
    return Promise.resolve();
  }
  const response = await sdk.projects.sidebarThreads({
    cursor,
    limit: String(SIDEBAR_BACKGROUND_THREAD_PAGE_SIZE),
    projectId,
    signal,
  });
  signal.throwIfAborted();
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
}

export function loadMoreSidebarProjectThreads(
  queryClient: QueryClient,
  projectId: string,
): Promise<void> {
  return getSidebarHydrationCoordinator(queryClient).loadForegroundPage(
    projectId,
  );
}

/**
 * Keep full sidebar hydration active for one mounted consumer. All consumers
 * on a query client share one page request. The final release cancels
 * background work, while explicit pagination requests remain independent.
 */
export function retainSidebarNavigationHydration(
  queryClient: QueryClient,
): () => void {
  return getSidebarHydrationCoordinator(
    queryClient,
  ).retainBackgroundHydration();
}

export function ensureSidebarNavigationHydrated(
  queryClient: QueryClient,
  navigation: SidebarNavigationCacheResponse,
): Promise<void> {
  if (navigation._threadPagination.complete) return Promise.resolve();
  return getSidebarHydrationCoordinator(queryClient).ensureHydrated();
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
