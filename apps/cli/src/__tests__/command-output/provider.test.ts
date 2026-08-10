import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogPayloads,
  getHelpOutput,
  readlineMocks,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerProviderCommands } from "../../commands/provider.js";

function providerAuthStatuses(claudeState: "loggedIn" | "loggedOut") {
  return {
    claudeCode: {
      provider: "claudeCode",
      displayName: "Claude Code",
      state: claudeState,
      authMethod: claudeState === "loggedIn" ? "claude.ai" : null,
      accountEmail: claudeState === "loggedIn" ? "person@example.com" : null,
      organizationName: claudeState === "loggedIn" ? "Example" : null,
      message: null,
    },
    codex: {
      provider: "codex",
      displayName: "Codex",
      state: "loggedOut",
      authMethod: null,
      accountEmail: null,
      organizationName: null,
      message: null,
    },
  };
}

function providerAuthSession(phase: "waitingForCode" | "succeeded") {
  return {
    sessionId: "session-1",
    provider: "claudeCode",
    phase,
    oauthUrl: "https://claude.ai/oauth/test",
    userCode: null,
    codeInputRequired: true,
    message: null,
    recoveryCommand: null,
    startedAt: 1,
  };
}

describe("bb provider command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerProviderCommands(program, () => "http://server");

  it("bb provider list renders the shared borderless table", async () => {
    const get = vi.fn(async () => [{ id: "openai", displayName: "OpenAI" }]);
    stubServerApi({ "v1.system.providers.$get": get });

    await runCommand(["provider", "list"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "",
      "ID      Name  \n------  ------\nopenai  OpenAI",
      "",
    ]);
  });

  it("discovers provider routing selectors in command help", async () => {
    const help = await getHelpOutput(["provider", "list"], register);
    expect(help).toContain("--machine <id-or-name>");
    expect(help).toContain("--host <id-or-name>");
    expect(help).toContain("--environment <id>");
  });

  it("bb provider list resolves a machine and preserves portable JSON output", async () => {
    const getProviders = vi.fn(async () => [
      { id: "acp-remote", displayName: "Remote ACP" },
    ]);
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [
        {
          id: "host-remote",
          name: "builder",
          type: "persistent",
          status: "connected",
          lastSeenAt: 1,
          lastRejectedProtocolVersion: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      "v1.system.providers.$get": getProviders,
    });

    await runCommand(
      ["provider", "list", "--machine", "builder", "--json"],
      register,
    );

    expect(getProviders).toHaveBeenCalledWith({
      query: { hostId: "host-remote" },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(
        [{ id: "acp-remote", displayName: "Remote ACP" }],
        null,
        2,
      ),
    ]);
  });

  it("bb provider models renders the shared borderless table", async () => {
    const get = vi.fn(async () => [
      { model: "gpt-5", displayName: "GPT-5", isDefault: true },
    ]);
    stubServerApi({
      "v1.system.execution-options.$get": vi.fn(async () => ({
        providers: [],
        models: await get(),
        selectedOnlyModels: [],
      })),
    });

    await runCommand(["provider", "models", "openai"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Models for openai:",
      "",
      "Model  Name   Default\n-----  -----  -------\ngpt-5  GPT-5  *",
      "",
    ]);
  });

  it("bb provider models includes a matching selected-only model", async () => {
    const get = vi.fn(async () => ({
      providers: [],
      models: [
        {
          model: "claude-haiku-4-5",
          displayName: "Claude Haiku 4.5",
          isDefault: true,
        },
      ],
      selectedOnlyModels: [
        {
          model: "claude-opus-4-6",
          displayName: "Claude Opus 4.6",
          isDefault: false,
        },
      ],
    }));
    stubServerApi({ "v1.system.execution-options.$get": get });

    await runCommand(
      [
        "provider",
        "models",
        "claude-code",
        "--selected-model",
        "claude-opus-4-6",
      ],
      register,
    );

    expect(get).toHaveBeenCalledWith({
      query: {
        providerId: "claude-code",
      },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Models for claude-code:",
      "",
      "Model             Name              Default\n----------------  ----------------  -------\nclaude-opus-4-6   Claude Opus 4.6\n----------------  ----------------  -------\nclaude-haiku-4-5  Claude Haiku 4.5  *",
      "",
    ]);
  });

  it("bb provider models routes through an environment", async () => {
    const get = vi.fn(async () => ({
      providers: [],
      models: [],
      selectedOnlyModels: [],
      modelLoadError: null,
    }));
    stubServerApi({ "v1.system.execution-options.$get": get });

    await runCommand(
      ["provider", "models", "codex", "--environment", "env-remote", "--json"],
      register,
    );

    expect(get).toHaveBeenCalledWith({
      query: { environmentId: "env-remote", providerId: "codex" },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual(["[]"]);
  });

  it("rejects simultaneous machine and environment selectors", async () => {
    await expect(
      runCommand(
        [
          "provider",
          "list",
          "--host",
          "builder",
          "--environment",
          "env-remote",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(console.error).toHaveBeenCalledWith(
      "Error: Cannot combine --machine or --host with --environment; the environment already selects its machine.",
    );
  });

  it("forwards the Claude one-time code unchanged", async () => {
    const submit = vi.fn(async () => ({
      statuses: providerAuthStatuses("loggedIn"),
      sessions: [providerAuthSession("succeeded")],
    }));
    readlineMocks.question.mockResolvedValue("  exact-code  ");
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [
        {
          id: "host-remote",
          name: "builder",
          type: "persistent",
          status: "connected",
          lastSeenAt: 1,
          lastRejectedProtocolVersion: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      "v1.hosts.:id.provider-auth.start.$post": vi.fn(async () => ({
        statuses: providerAuthStatuses("loggedOut"),
        sessions: [providerAuthSession("waitingForCode")],
      })),
      "v1.hosts.:id.provider-auth.submit-code.$post": submit,
    });

    await runCommand(
      ["provider", "auth", "login", "claude", "--machine", "builder"],
      register,
    );

    expect(submit).toHaveBeenCalledWith({
      param: { id: "host-remote" },
      json: { sessionId: "session-1", code: "  exact-code  " },
    });
  });
});
