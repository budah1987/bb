import { QueryClient } from "@tanstack/react-query";
import type { ProjectWithThreadsResponse } from "@bb/server-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import { sdk } from "@/lib/sdk";
import {
  ensureSidebarNavigationHydrated,
  loadMoreSidebarProjectThreads,
  retainSidebarNavigationHydration,
  sidebarNavigationQueryKey,
  type SidebarNavigationCacheResponse,
} from "./sidebar-navigation-query";

const listThreadsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdk", () => ({
  sdk: { projects: { sidebarThreads: listThreadsMock } },
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
    vi.unstubAllGlobals();
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
      nextThreadCursorByProjectId: {
        personal: null,
        proj_test: "cursor-50",
      },
      projects: [makeProject("proj_test", initialThreads)],
      personalProject: makeProject("personal", []),
      _threadPagination: {
        complete: false,
        completeProjectIds: ["personal"],
        generation: 1,
        initialLimit: 50,
        nextCursorByProjectId: { personal: null, proj_test: "cursor-50" },
      },
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(sidebarNavigationQueryKey(), navigation);
    listThreadsMock
      .mockResolvedValueOnce({
        threads: allThreads.slice(50, 250),
        nextCursor: "cursor-250",
      })
      .mockResolvedValueOnce({ threads: [], nextCursor: null });

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
      expect.objectContaining({ cursor: "cursor-50", limit: "200" }),
    );
    expect(listThreadsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "cursor-250", limit: "200" }),
    );
    expect(sdk.projects.sidebarThreads).toBe(listThreadsMock);
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
      nextThreadCursorByProjectId: {
        personal: null,
        proj_test: "cursor-50",
      },
      projects: [makeProject("proj_test", initialThreads)],
      personalProject: makeProject("personal", []),
      _threadPagination: {
        complete: false,
        completeProjectIds: ["personal"],
        generation: 2,
        initialLimit: 50,
        nextCursorByProjectId: { personal: null, proj_test: "cursor-50" },
      },
    };
    const secondNavigation: SidebarNavigationCacheResponse = {
      ...firstNavigation,
      nextThreadCursorByProjectId: {
        personal: null,
        proj_test: "cursor-new",
      },
      _threadPagination: {
        complete: false,
        completeProjectIds: ["personal"],
        generation: 3,
        initialLimit: 50,
        nextCursorByProjectId: { personal: null, proj_test: "cursor-new" },
      },
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(sidebarNavigationQueryKey(), firstNavigation);
    let resolveFirstPage:
      | ((page: { threads: never[]; nextCursor: null }) => void)
      | undefined;
    listThreadsMock
      .mockImplementationOnce(
        () =>
          new Promise<{ threads: never[]; nextCursor: null }>((resolve) => {
            resolveFirstPage = resolve;
          }),
      )
      .mockResolvedValueOnce({ threads: [], nextCursor: null });

    const firstHydration = ensureSidebarNavigationHydrated(
      queryClient,
      firstNavigation,
    );
    queryClient.setQueryData(sidebarNavigationQueryKey(), secondNavigation);
    resolveFirstPage?.({ threads: [], nextCursor: null });
    await firstHydration;

    expect(
      queryClient.getQueryData<SidebarNavigationCacheResponse>(
        sidebarNavigationQueryKey(),
      )?._threadPagination.complete,
    ).toBe(true);
    expect(listThreadsMock).toHaveBeenCalledTimes(2);
    expect(listThreadsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "cursor-new" }),
    );
  });

  it("loads only one page for an explicit sidebar boundary request", async () => {
    const initialThreads = Array.from({ length: 50 }, (_, index) =>
      makeThreadListEntry({ id: `thr_${index}`, projectId: "proj_test" }),
    );
    const navigation: SidebarNavigationCacheResponse = {
      sections: [],
      spaces: [],
      nextThreadCursorByProjectId: {
        personal: null,
        proj_test: "cursor-50",
      },
      projects: [makeProject("proj_test", initialThreads)],
      personalProject: makeProject("personal", []),
      _threadPagination: {
        complete: false,
        completeProjectIds: ["personal"],
        generation: 4,
        initialLimit: 50,
        nextCursorByProjectId: { personal: null, proj_test: "cursor-50" },
      },
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(sidebarNavigationQueryKey(), navigation);
    listThreadsMock.mockResolvedValue({
      threads: Array.from({ length: 200 }, (_, index) =>
        makeThreadListEntry({
          id: `thr_${index + 50}`,
          projectId: "proj_test",
        }),
      ),
      nextCursor: "cursor-250",
    });

    await loadMoreSidebarProjectThreads(queryClient, "proj_test");

    expect(listThreadsMock).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData<SidebarNavigationCacheResponse>(
        sidebarNavigationQueryKey(),
      )?.projects[0]?.threads,
    ).toHaveLength(250);
  });

  it("hydrates one project page at a time across the whole query client", async () => {
    const navigation: SidebarNavigationCacheResponse = {
      sections: [],
      spaces: [],
      nextThreadCursorByProjectId: {
        personal: null,
        "proj-a": "cursor-a",
        "proj-b": "cursor-b",
        "proj-c": "cursor-c",
      },
      projects: [
        makeProject("proj-a", []),
        makeProject("proj-b", []),
        makeProject("proj-c", []),
      ],
      personalProject: makeProject("personal", []),
      _threadPagination: {
        complete: false,
        completeProjectIds: ["personal"],
        generation: 5,
        initialLimit: 50,
        nextCursorByProjectId: {
          personal: null,
          "proj-a": "cursor-a",
          "proj-b": "cursor-b",
          "proj-c": "cursor-c",
        },
      },
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(sidebarNavigationQueryKey(), navigation);
    const pageResolvers: Array<
      (page: { threads: never[]; nextCursor: null }) => void
    > = [];
    let activeRequests = 0;
    let peakActiveRequests = 0;
    listThreadsMock.mockImplementation(
      () =>
        new Promise<{ threads: never[]; nextCursor: null }>((resolve) => {
          activeRequests += 1;
          peakActiveRequests = Math.max(peakActiveRequests, activeRequests);
          pageResolvers.push((page) => {
            activeRequests -= 1;
            resolve(page);
          });
        }),
    );

    const release = retainSidebarNavigationHydration(queryClient);
    expect(listThreadsMock).toHaveBeenCalledTimes(1);
    pageResolvers.shift()?.({ threads: [], nextCursor: null });
    await vi.waitFor(() => expect(listThreadsMock).toHaveBeenCalledTimes(2));
    pageResolvers.shift()?.({ threads: [], nextCursor: null });
    await vi.waitFor(() => expect(listThreadsMock).toHaveBeenCalledTimes(3));
    pageResolvers.shift()?.({ threads: [], nextCursor: null });
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryData<SidebarNavigationCacheResponse>(
          sidebarNavigationQueryKey(),
        )?._threadPagination.complete,
      ).toBe(true),
    );
    release();

    expect(peakActiveRequests).toBe(1);
  });

  it("aborts background work after its final consumer releases", async () => {
    const navigation: SidebarNavigationCacheResponse = {
      sections: [],
      spaces: [],
      nextThreadCursorByProjectId: {
        personal: null,
        proj_test: "cursor-50",
      },
      projects: [makeProject("proj_test", [])],
      personalProject: makeProject("personal", []),
      _threadPagination: {
        complete: false,
        completeProjectIds: ["personal"],
        generation: 6,
        initialLimit: 50,
        nextCursorByProjectId: {
          personal: null,
          proj_test: "cursor-50",
        },
      },
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(sidebarNavigationQueryKey(), navigation);
    let requestSignal: AbortSignal | undefined;
    listThreadsMock
      .mockImplementationOnce(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_, reject) => {
            requestSignal = signal;
            signal.addEventListener("abort", () => reject(signal.reason));
          }),
      )
      .mockResolvedValueOnce({ threads: [], nextCursor: null });

    const releaseFirst = retainSidebarNavigationHydration(queryClient);
    const releaseSecond = retainSidebarNavigationHydration(queryClient);
    expect(requestSignal?.aborted).toBe(false);

    releaseFirst();
    expect(requestSignal?.aborted).toBe(false);
    releaseSecond();
    expect(requestSignal?.aborted).toBe(true);
    const foreground = loadMoreSidebarProjectThreads(queryClient, "proj_test");
    await foreground;
    expect(listThreadsMock).toHaveBeenCalledTimes(2);
  });

  it("pauses background pages while hidden and resumes when visible", async () => {
    class FakeDocument extends EventTarget {
      visibilityState: DocumentVisibilityState = "hidden";
    }
    const fakeDocument = new FakeDocument();
    vi.stubGlobal("document", fakeDocument);
    const navigation: SidebarNavigationCacheResponse = {
      sections: [],
      spaces: [],
      nextThreadCursorByProjectId: {
        personal: null,
        proj_test: "cursor-50",
      },
      projects: [makeProject("proj_test", [])],
      personalProject: makeProject("personal", []),
      _threadPagination: {
        complete: false,
        completeProjectIds: ["personal"],
        generation: 7,
        initialLimit: 50,
        nextCursorByProjectId: {
          personal: null,
          proj_test: "cursor-50",
        },
      },
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(sidebarNavigationQueryKey(), navigation);
    listThreadsMock.mockResolvedValue({ threads: [], nextCursor: null });

    const release = retainSidebarNavigationHydration(queryClient);
    expect(listThreadsMock).not.toHaveBeenCalled();

    fakeDocument.visibilityState = "visible";
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(listThreadsMock).toHaveBeenCalledTimes(1));
    release();
  });

  it("runs queued foreground pagination before the next background page", async () => {
    const navigation: SidebarNavigationCacheResponse = {
      sections: [],
      spaces: [],
      nextThreadCursorByProjectId: {
        personal: null,
        "proj-a": "cursor-a",
        "proj-b": "cursor-b",
        "proj-c": "cursor-c",
      },
      projects: [
        makeProject("proj-a", []),
        makeProject("proj-b", []),
        makeProject("proj-c", []),
      ],
      personalProject: makeProject("personal", []),
      _threadPagination: {
        complete: false,
        completeProjectIds: ["personal"],
        generation: 8,
        initialLimit: 50,
        nextCursorByProjectId: {
          personal: null,
          "proj-a": "cursor-a",
          "proj-b": "cursor-b",
          "proj-c": "cursor-c",
        },
      },
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(sidebarNavigationQueryKey(), navigation);
    const pageResolvers: Array<
      (page: { threads: never[]; nextCursor: null }) => void
    > = [];
    listThreadsMock.mockImplementation(
      () =>
        new Promise<{ threads: never[]; nextCursor: null }>((resolve) => {
          pageResolvers.push(resolve);
        }),
    );

    const release = retainSidebarNavigationHydration(queryClient);
    expect(listThreadsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ projectId: "proj-a" }),
    );
    const foreground = loadMoreSidebarProjectThreads(queryClient, "proj-c");
    pageResolvers.shift()?.({ threads: [], nextCursor: null });
    await vi.waitFor(() => expect(listThreadsMock).toHaveBeenCalledTimes(2));
    expect(listThreadsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ projectId: "proj-c" }),
    );
    pageResolvers.shift()?.({ threads: [], nextCursor: null });
    await foreground;
    release();
  });
});
