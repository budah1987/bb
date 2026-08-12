import { beforeEach, describe, expect, it, vi } from "vitest";
import type { conductorRpcContract } from "bb-plugin-conductor-workspaces/rpc-contract";

const sdkMocks = vi.hoisted(() => ({
  archiveThreads: vi.fn(),
  environmentRename: vi.fn(),
  environmentGet: vi.fn(),
  environmentStatus: vi.fn(),
  environmentUpdate: vi.fn(),
  hostsList: vi.fn(),
  managerRun: vi.fn(),
  managerSettings: vi.fn(),
  managerShow: vi.fn(),
  projectCreate: vi.fn(),
  projectUpdate: vi.fn(),
  githubRepositories: vi.fn(),
  updateFromMain: vi.fn(),
}));

const callPluginRpc = vi.hoisted(() => vi.fn());

vi.mock("./sdk", () => ({
  sdk: {
    environments: {
      archiveThreads: sdkMocks.archiveThreads,
      get: sdkMocks.environmentGet,
      rename: sdkMocks.environmentRename,
      status: sdkMocks.environmentStatus,
      update: sdkMocks.environmentUpdate,
      updateFromMain: sdkMocks.updateFromMain,
    },
    hosts: { list: sdkMocks.hostsList },
    projects: {
      create: sdkMocks.projectCreate,
      manager: {
        run: sdkMocks.managerRun,
        settings: sdkMocks.managerSettings,
        show: sdkMocks.managerShow,
      },
      update: sdkMocks.projectUpdate,
    },
    system: { githubRepositories: sdkMocks.githubRepositories },
  },
}));

vi.mock("./plugin-sdk-hooks", () => ({ callPluginRpc }));

vi.mock("./plugin-sdk-app-impl", () => ({
  pluginSdkAppImplementation: {
    Markdown: vi.fn(),
    ThreadChat: vi.fn(),
    experimental_NewThreadComposer: vi.fn(),
    experimental_useSidebarThreadActions: vi.fn(),
    experimental_useSidebarThreadPullRequest: vi.fn(),
    experimental_useSidebarThreadSplit: vi.fn(),
    experimental_useSidebarThreads: vi.fn(),
    useBbContext: vi.fn(),
    useBbNavigate: vi.fn(),
    useComposer: vi.fn(),
    useComposerView: vi.fn(),
    useRealtime: vi.fn(),
    useRealtimeConnectionState: vi.fn(),
    useSettings: vi.fn(),
  },
}));

import { useRpc } from "./conductor-plugin-sdk-app";

describe("core Conductor RPC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads workspace Git state through the core SDK", async () => {
    sdkMocks.environmentGet.mockResolvedValue({
      baseBranch: "main",
      branchName: "feature",
      defaultBranch: "main",
      mergeBaseBranch: null,
      name: "Feature",
      path: "/work/feature",
    });
    sdkMocks.environmentStatus.mockResolvedValue({
      outcome: "available",
      workspace: {
        mergeBase: { aheadCount: 2, behindCount: 1 },
        workingTree: { files: [{ path: "one" }, { path: "two" }] },
      },
    });

    const rpc = useRpc<typeof conductorRpcContract>();
    await expect(
      rpc.call("readWorkspaceGitSummaries", {
        environmentIds: ["environment-1"],
      }),
    ).resolves.toEqual({
      summaries: [
        {
          aheadCount: 2,
          behindCount: 1,
          changedFiles: 2,
          environmentId: "environment-1",
          gitAvailable: true,
          workspacePath: "/work/feature",
        },
      ],
    });
    expect(callPluginRpc).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent Git summary requests", async () => {
    sdkMocks.environmentGet.mockResolvedValue({
      baseBranch: "main",
      defaultBranch: "main",
      mergeBaseBranch: null,
      path: "/work/feature",
    });
    sdkMocks.environmentStatus.mockResolvedValue({
      outcome: "available",
      workspace: {
        mergeBase: { aheadCount: 0, behindCount: 0 },
        workingTree: { files: [] },
      },
    });
    const rpc = useRpc<typeof conductorRpcContract>();
    const input = { environmentIds: ["environment-shared"] };

    await Promise.all([
      rpc.call("readWorkspaceGitSummaries", input),
      rpc.call("readWorkspaceGitSummaries", input),
    ]);

    expect(sdkMocks.environmentGet).toHaveBeenCalledTimes(1);
    expect(sdkMocks.environmentStatus).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrent Git summary requests", async () => {
    const statusResolvers: Array<() => void> = [];
    let activeRequests = 0;
    let peakRequests = 0;
    sdkMocks.environmentGet.mockImplementation(async ({ environmentId }) => ({
      baseBranch: "main",
      defaultBranch: "main",
      id: environmentId,
      mergeBaseBranch: null,
      path: `/work/${environmentId}`,
    }));
    sdkMocks.environmentStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          activeRequests += 1;
          peakRequests = Math.max(peakRequests, activeRequests);
          statusResolvers.push(() => {
            activeRequests -= 1;
            resolve({
              outcome: "available",
              workspace: {
                mergeBase: { aheadCount: 0, behindCount: 0 },
                workingTree: { files: [] },
              },
            });
          });
        }),
    );
    const rpc = useRpc<typeof conductorRpcContract>();
    const result = rpc.call("readWorkspaceGitSummaries", {
      environmentIds: Array.from(
        { length: 12 },
        (_, index) => `environment-${index}`,
      ),
    });

    await vi.waitFor(() => expect(statusResolvers).toHaveLength(6));
    statusResolvers.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(statusResolvers).toHaveLength(6));
    statusResolvers.splice(0).forEach((resolve) => resolve());
    await result;

    expect(peakRequests).toBe(6);
    expect(sdkMocks.environmentStatus).toHaveBeenCalledTimes(12);
  });

  it("keeps Conductor available when legacy plugin storage is unavailable", async () => {
    callPluginRpc.mockRejectedValue(new Error("plugin disabled"));
    const rpc = useRpc<typeof conductorRpcContract>();

    await expect(rpc.call("readReconciliation", {})).resolves.toEqual({
      legacyWorkspaces: [],
      recordedSignature: null,
    });
  });

  it("reads legacy workspace data during the compatibility window", async () => {
    callPluginRpc.mockResolvedValue({
      legacyWorkspaces: [
        {
          anchorThreadId: "anchor-thread",
          branchName: "feature",
          environmentName: "Feature",
          firstTabThreadId: "first-thread",
          id: "legacy-workspace",
          projectId: "project-1",
          title: "Legacy workspace",
        },
      ],
      recordedSignature: "signature-1",
    });
    const rpc = useRpc<typeof conductorRpcContract>();

    await expect(rpc.call("readReconciliation", {})).resolves.toMatchObject({
      legacyWorkspaces: [{ id: "legacy-workspace" }],
      recordedSignature: "signature-1",
    });
  });

  it("records only complete reconciliation reports", async () => {
    callPluginRpc.mockRejectedValue(new Error("plugin disabled"));
    const rpc = useRpc<typeof conductorRpcContract>();
    const report = {
      activeConversations: 2,
      archivedConversations: 1,
      duplicateConversations: 0,
      environmentsProjected: 1,
      legacyOrganizersHidden: 0,
      missingConversations: 0,
      projectsScanned: 1,
      signature: "signature-2",
      unassignedConversations: 0,
      version: 2,
    };

    await expect(rpc.call("recordReconciliation", report)).resolves.toEqual({
      recorded: false,
    });
    await expect(
      rpc.call("recordReconciliation", {
        ...report,
        missingConversations: 1,
      }),
    ).rejects.toThrow("refused an incomplete projection");
  });

  it("keeps the archive guard before the core archive request", async () => {
    sdkMocks.environmentStatus.mockResolvedValue({
      outcome: "available",
      workspace: { workingTree: { hasUncommittedChanges: true } },
    });
    const rpc = useRpc<typeof conductorRpcContract>();

    await expect(
      rpc.call("archiveWorkspace", {
        confirmUncommittedChanges: false,
        environmentId: "environment-1",
      }),
    ).resolves.toEqual({ outcome: "confirmation_required" });
    expect(sdkMocks.archiveThreads).not.toHaveBeenCalled();
  });

  it("reads and renames workspace identity through core routes", async () => {
    sdkMocks.environmentGet.mockResolvedValue({
      branchName: "feature",
      name: "Feature",
      path: "C:\\workspaces\\feature-folder",
    });
    const rpc = useRpc<typeof conductorRpcContract>();

    await expect(
      rpc.call("readWorkspaceRenameDetails", {
        environmentId: "environment-1",
      }),
    ).resolves.toEqual({
      branchName: "feature",
      displayName: "Feature",
      folderName: "feature-folder",
    });
    await rpc.call("renameWorkspace", {
      environmentId: "environment-1",
      scope: "display",
      value: "Renamed feature",
    });
    await rpc.call("renameWorkspace", {
      environmentId: "environment-1",
      scope: "branch",
      value: "renamed-feature",
    });

    expect(sdkMocks.environmentUpdate).toHaveBeenCalledWith({
      environmentId: "environment-1",
      name: "Renamed feature",
    });
    expect(sdkMocks.environmentRename).toHaveBeenCalledWith({
      environmentId: "environment-1",
      target: "branch",
      value: "renamed-feature",
    });
  });

  it("archives through the core route after confirmation", async () => {
    sdkMocks.archiveThreads.mockResolvedValue({
      archivedThreadIds: ["thread-1", "thread-2"],
    });
    const rpc = useRpc<typeof conductorRpcContract>();

    await expect(
      rpc.call("archiveWorkspace", {
        confirmUncommittedChanges: true,
        environmentId: "environment-1",
      }),
    ).resolves.toEqual({
      archivedThreadIds: ["thread-1", "thread-2"],
      outcome: "archived",
    });
  });

  it("uses a connected host for the GitHub catalog", async () => {
    sdkMocks.hostsList.mockResolvedValue([
      { id: "host-offline", status: "disconnected" },
      { id: "host-connected", status: "connected" },
    ]);
    sdkMocks.githubRepositories.mockResolvedValue({
      accounts: [{ active: true, login: "amir" }],
      repositories: [
        {
          accessibleBy: ["amir"],
          activeAccount: "amir",
          defaultBranch: "main",
          isPrivate: true,
          name: "bb",
          nameWithOwner: "amir/bb",
          owner: "amir",
          updatedAt: "2026-08-11T00:00:00.000Z",
          url: "https://github.com/amir/bb",
        },
      ],
    });
    const rpc = useRpc<typeof conductorRpcContract>();

    await expect(rpc.call("readGithubCatalog", {})).resolves.toMatchObject({
      hostId: "host-connected",
      repositories: [{ nameWithOwner: "amir/bb" }],
    });
    expect(sdkMocks.githubRepositories).toHaveBeenCalledWith({
      hostId: "host-connected",
    });
  });

  it("creates projects and updates their GitHub account", async () => {
    sdkMocks.projectCreate.mockResolvedValue({ id: "project-1" });
    sdkMocks.projectUpdate.mockResolvedValue({ githubAccountLogin: "amir" });
    const rpc = useRpc<typeof conductorRpcContract>();

    await expect(
      rpc.call("createGithubProject", {
        accountLogin: "amir",
        hostId: "host-1",
        name: "BB",
        remoteUrl: "https://github.com/amir/bb",
      }),
    ).resolves.toEqual({ projectId: "project-1" });
    await expect(
      rpc.call("setProjectGithubAccount", {
        accountLogin: "amir",
        projectId: "project-1",
      }),
    ).resolves.toEqual({ accountLogin: "amir" });
  });

  it("runs manager and update actions through core routes", async () => {
    const managerSettings = {
      enabled: true,
      model: "gpt-5.6-terra",
      permissionMode: "auto" as const,
      providerId: "codex",
      reasoningLevel: "high" as const,
      serviceTier: "default" as const,
    };
    sdkMocks.managerShow.mockResolvedValue(managerSettings);
    sdkMocks.managerSettings.mockResolvedValue(managerSettings);
    sdkMocks.managerRun.mockResolvedValue({ id: "manager-thread" });
    sdkMocks.updateFromMain.mockResolvedValue({
      message: "Workspace updated from main.",
      outcome: "updated",
    });
    const rpc = useRpc<typeof conductorRpcContract>();

    await expect(
      rpc.call("readProjectManager", { projectId: "project-1" }),
    ).resolves.toEqual(managerSettings);
    await expect(
      rpc.call("updateProjectManager", {
        projectId: "project-1",
        settings: managerSettings,
      }),
    ).resolves.toEqual(managerSettings);
    await expect(
      rpc.call("runProjectManager", {
        projectId: "project-1",
        prompt: "Review status",
      }),
    ).resolves.toEqual({ threadId: "manager-thread" });
    await expect(
      rpc.call("updateWorkspaceFromMain", {
        environmentId: "environment-1",
      }),
    ).resolves.toEqual({
      message: "Workspace updated from main.",
      outcome: "updated",
    });
  });
});
