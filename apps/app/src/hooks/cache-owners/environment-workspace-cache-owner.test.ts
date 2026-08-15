import { describe, expect, it } from "vitest";
import type { Environment, ThreadListEntry } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { createAppQueryClient } from "@/lib/query-client";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadSearchQueryKey,
} from "../queries/query-keys";
import { applyEnvironmentUpdateResult } from "./environment-workspace-cache-owner";

function createEnvironment(): Environment {
  return {
    baseBranch: null,
    branchName: "main",
    createdAt: 1000,
    defaultBranch: "main",
    hostId: "host_1",
    id: "env_1",
    isGitRepo: true,
    isWorktree: true,
    managed: true,
    mergeBaseBranch: null,
    githubAccountLogin: null,
    name: "Renamed environment",
    path: "/tmp/project",
    projectId: "proj_1",
    status: "ready",
    updatedAt: 2000,
    workspaceProvisionType: "managed-worktree",
  };
}

function createLocalThread(): ThreadListEntry {
  return {
    id: "thread-1",
    projectId: "proj_1",
    environmentId: "env_1",
    providerId: "codex",
    title: "Conversation",
    titleFallback: "Conversation",
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: "host_1",
    environmentName: "Old workspace name",
    environmentBranchName: "main",
    environmentWorkspaceDisplayKind: "other",
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
  };
}

describe("applyEnvironmentUpdateResult", () => {
  it("updates local workspace names in thread-list and sidebar caches", () => {
    const queryClient = createAppQueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
      showMutationErrorToasts: false,
    });
    const thread = createLocalThread();
    const threadListKey = threadListQueryKey({
      archived: false,
      projectId: "proj_1",
    });
    const sidebar: SidebarBootstrapResponse = {
      sections: [],
      spaces: [],
      nextThreadCursorByProjectId: {},
      projects: [
        {
          id: "proj_1",
          kind: "standard",
          name: "Project",
          gitRemoteUrl: null,
          githubAccountLogin: null,
          createdAt: 1,
          updatedAt: 1,
          sources: [],
          threads: [thread],
          defaultExecutionOptions: null,
        },
      ],
      personalProject: {
        id: "proj_personal",
        kind: "personal",
        name: "Personal",
        gitRemoteUrl: null,
        githubAccountLogin: null,
        createdAt: 1,
        updatedAt: 1,
        sources: [],
        threads: [],
        defaultExecutionOptions: null,
      },
    };
    queryClient.setQueryData(threadListKey, [thread]);
    queryClient.setQueryData(sidebarNavigationQueryKey(), sidebar);

    const environment = {
      ...createEnvironment(),
      isWorktree: false,
      managed: false,
      name: "New workspace name",
      workspaceProvisionType: "unmanaged" as const,
    };
    applyEnvironmentUpdateResult({ environment, queryClient });

    expect(
      queryClient.getQueryData<ThreadListEntry[]>(threadListKey)?.[0]
        ?.environmentName,
    ).toBe("New workspace name");
    expect(
      queryClient.getQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
      )?.projects[0]?.threads[0]?.environmentName,
    ).toBe("New workspace name");
  });

  it("invalidates cached thread search rows that render environment metadata", () => {
    const queryClient = createAppQueryClient({
      defaultOptions: {
        queries: {
          gcTime: Infinity,
          retry: false,
        },
      },
      showMutationErrorToasts: false,
    });
    const threadSearchKey = threadSearchQueryKey({
      limitPerGroup: 20,
      query: "renamed",
    });
    queryClient.setQueryData(threadSearchKey, {
      active: { results: [], total: 0 },
      archived: { results: [], total: 0 },
    });

    applyEnvironmentUpdateResult({
      environment: createEnvironment(),
      queryClient,
    });

    expect(queryClient.getQueryState(threadSearchKey)?.isInvalidated).toBe(
      true,
    );
  });
});
