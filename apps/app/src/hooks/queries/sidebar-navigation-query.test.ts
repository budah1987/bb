import { QueryClient } from "@tanstack/react-query";
import type { ProjectWithThreadsResponse } from "@bb/server-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import { sdk } from "@/lib/sdk";
import {
  ensureSidebarNavigationHydrated,
  loadMoreSidebarProjectThreads,
  sidebarNavigationQueryKey,
  type SidebarNavigationCacheResponse,
} from "./sidebar-navigation-query";

const listThreadsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { list: listThreadsMock } },
}));

function makeProject(
  id: string,
  threads: ProjectWithThreadsResponse["threads"],
): ProjectWithThreadsResponse {
  return {
    id,
    kind: id === "personal" ? "personal" : "standard",
    name: id,
    gitRemoteUrl: null,
    githubAccountLogin: null,
    sources: [],
    createdAt: 0,
    updatedAt: 0,
    threads,
    defaultExecutionOptions: null,
  };
}

describe("sidebar navigation on-demand pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges remaining pages without duplicates and restores server order", async () => {
    const allThreads = Array.from({ length: 250 }, (_, index) =>
      makeThreadListEntry({
        id: `thr_${index}`,
        projectId: "proj_test",
      }),
    );
    const initialThreads = [...allThreads.slice(0, 50), allThreads[210]!];
    const navigation: SidebarNavigationCacheResponse = {
      sections: [],
      spaces: [],
      projects: [makeProject("proj_test", initialThreads)],
      personalProject: makeProject("personal", []),
      _threadPagination: {
        complete: false,
        completeProjectIds: ["personal"],
        generation: 1,
        initialLimit: 50,
        nextOffsetByProjectId: { personal: 50, proj_test: 50 },
      },
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(sidebarNavigationQueryKey(), navigation);
    listThreadsMock.mockImplementation(
      async ({ offset }: { offset?: number }) =>
        offset === 50 ? allThreads.slice(50, 250) : [],
    );

    await ensureSidebarNavigationHydrated(queryClient, navigation);

    const hydrated = queryClient.getQueryData<SidebarNavigationCacheResponse>(
      sidebarNavigationQueryKey(),
    );
    expect(hydrated?.projects[0]?.threads.map((thread) => thread.id)).toEqual(
      allThreads.map((thread) => thread.id),
    );
    expect(hydrated?._threadPagination.complete).toBe(true);
    expect(listThreadsMock).toHaveBeenCalledTimes(2);
    expect(listThreadsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ limit: 200, offset: 50 }),
    );
    expect(listThreadsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ limit: 200, offset: 250 }),
    );
    expect(sdk.threads.list).toBe(listThreadsMock);
  });

  it("restarts pagination when a bootstrap refetch replaces the cache", async () => {
    const initialThreads = Array.from({ length: 50 }, (_, index) =>
      makeThreadListEntry({
        id: `thr_${index}`,
        projectId: "proj_test",
      }),
    );
    const firstNavigation: SidebarNavigationCacheResponse = {
      sections: [],
      spaces: [],
      projects: [makeProject("proj_test", initialThreads)],
      personalProject: makeProject("personal", []),
      _threadPagination: {
        complete: false,
        completeProjectIds: ["personal"],
        generation: 2,
        initialLimit: 50,
        nextOffsetByProjectId: { personal: 50, proj_test: 50 },
      },
    };
    const secondNavigation: SidebarNavigationCacheResponse = {
      ...firstNavigation,
      _threadPagination: {
        complete: false,
        completeProjectIds: ["personal"],
        generation: 3,
        initialLimit: 50,
        nextOffsetByProjectId: { personal: 50, proj_test: 50 },
      },
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(sidebarNavigationQueryKey(), firstNavigation);
    let resolveFirstPage: ((threads: never[]) => void) | undefined;
    listThreadsMock
      .mockImplementationOnce(
        () =>
          new Promise<never[]>((resolve) => {
            resolveFirstPage = resolve;
          }),
      )
      .mockResolvedValueOnce([]);

    const firstHydration = ensureSidebarNavigationHydrated(
      queryClient,
      firstNavigation,
    );
    queryClient.setQueryData(sidebarNavigationQueryKey(), secondNavigation);
    resolveFirstPage?.([]);
    await firstHydration;

    expect(
      queryClient.getQueryData<SidebarNavigationCacheResponse>(
        sidebarNavigationQueryKey(),
      )?._threadPagination.complete,
    ).toBe(true);
    expect(listThreadsMock).toHaveBeenCalledTimes(2);
  });

  it("loads only one page for an explicit sidebar boundary request", async () => {
    const initialThreads = Array.from({ length: 50 }, (_, index) =>
      makeThreadListEntry({ id: `thr_${index}`, projectId: "proj_test" }),
    );
    const navigation: SidebarNavigationCacheResponse = {
      sections: [],
      spaces: [],
      projects: [makeProject("proj_test", initialThreads)],
      personalProject: makeProject("personal", []),
      _threadPagination: {
        complete: false,
        completeProjectIds: ["personal"],
        generation: 4,
        initialLimit: 50,
        nextOffsetByProjectId: { personal: 50, proj_test: 50 },
      },
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(sidebarNavigationQueryKey(), navigation);
    listThreadsMock.mockResolvedValue(
      Array.from({ length: 200 }, (_, index) =>
        makeThreadListEntry({
          id: `thr_${index + 50}`,
          projectId: "proj_test",
        }),
      ),
    );

    await loadMoreSidebarProjectThreads(queryClient, "proj_test");

    expect(listThreadsMock).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData<SidebarNavigationCacheResponse>(
        sidebarNavigationQueryKey(),
      )?.projects[0]?.threads,
    ).toHaveLength(250);
  });
});
