import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";

const context = {
  thread: {
    id: "thread",
    title: "Test",
    parentThreadId: null,
    sourceThreadId: null,
  },
  project: {
    id: "project",
    kind: "standard" as const,
    name: "Test",
    gitRemoteUrl: null,
  },
  environment: {
    id: "environment",
    name: "Test",
    path: "/tmp/test",
    workspaceProvisionType: "unmanaged" as const,
    branchName: null,
  },
  host: { id: "host", name: "Host" },
  provider: { id: "claude-code", model: "claude-sonnet-4-6" },
  origin: { kind: null, pluginId: null },
};

describe("Claude auto compact plugin", () => {
  it("enables native compaction at 300k by default", async () => {
    const host = createFakePluginHost({ pluginId: "claude-auto-compact" });
    await plugin(host.bb);

    await expect(host.harness.callRpc("getSettings", null)).resolves.toEqual({
      enabled: true,
      autoCompactWindow: 300_000,
    });
    expect(host.harness.resolveClaudeCodeSessionConfiguration(context)).toEqual(
      {
        autoCompactEnabled: true,
        autoCompactWindow: 300_000,
      },
    );
    await host.harness.dispose();
  });

  it("updates the live session policy through RPC and CLI", async () => {
    const host = createFakePluginHost({ pluginId: "claude-auto-compact" });
    await plugin(host.bb);

    await host.harness.callRpc("updateSettings", {
      enabled: false,
      autoCompactWindow: 380_000,
    });
    expect(host.harness.resolveClaudeCodeSessionConfiguration(context)).toEqual(
      {
        autoCompactEnabled: false,
        autoCompactWindow: 380_000,
      },
    );

    await expect(host.harness.runCli(["on"])).resolves.toMatchObject({
      exitCode: 0,
    });
    await expect(
      host.harness.runCli(["threshold", "350k"]),
    ).resolves.toMatchObject({ exitCode: 0 });
    expect(host.harness.resolveClaudeCodeSessionConfiguration(context)).toEqual(
      {
        autoCompactEnabled: true,
        autoCompactWindow: 350_000,
      },
    );
    await host.harness.dispose();
  });
});
