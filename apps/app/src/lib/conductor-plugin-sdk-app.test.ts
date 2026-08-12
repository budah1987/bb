import { beforeEach, describe, expect, it, vi } from "vitest";
import type { conductorRpcContract } from "bb-plugin-conductor-workspaces/core";

const sdkMocks = vi.hoisted(() => ({
  environmentGet: vi.fn(),
  environmentStatus: vi.fn(),
  archiveThreads: vi.fn(),
}));

const callPluginRpc = vi.hoisted(() => vi.fn());

vi.mock("./sdk", () => ({
  sdk: {
    environments: {
      get: sdkMocks.environmentGet,
      status: sdkMocks.environmentStatus,
      archiveThreads: sdkMocks.archiveThreads,
    },
    hosts: { list: vi.fn() },
    projects: {
      create: vi.fn(),
      manager: { run: vi.fn(), settings: vi.fn(), show: vi.fn() },
      update: vi.fn(),
    },
    system: { githubRepositories: vi.fn() },
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
});
