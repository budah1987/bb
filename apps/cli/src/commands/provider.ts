import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import type { AvailableModel } from "@bb/domain";
import type { ProviderHostRoutingArgs } from "@bb/sdk";
import type {
  HostProviderAuthSnapshot,
  SystemProviderInfo,
} from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";
import { resolveMachineEnvironmentRouting } from "./machine.js";

interface ProviderListCommandOptions {
  environment?: string;
  host?: string;
  json?: boolean;
  machine?: string;
}

interface ProviderModelsCommandOptions {
  environment?: string;
  host?: string;
  json?: boolean;
  machine?: string;
  selectedModel?: string;
}

interface ProviderAuthCommandOptions extends ProviderListCommandOptions {
  wait?: boolean;
}

type CliProviderAuthKey = "claude" | "codex";

interface IncludeSelectedOnlyModelArgs {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
  selectedModel?: string;
}

async function resolveProviderRouting(
  opts: ProviderListCommandOptions,
  serverUrl: string,
): Promise<ProviderHostRoutingArgs> {
  return resolveMachineEnvironmentRouting(opts, serverUrl);
}

function addProviderRoutingOptions(command: Command): Command {
  return command
    .option("--machine <id-or-name>", "Machine whose providers should be used")
    .option("--host <id-or-name>", "Alias for --machine")
    .option(
      "--environment <id>",
      "Environment whose machine providers should be used",
    );
}

function parseProviderAuthKey(value: string): {
  cliKey: CliProviderAuthKey;
  provider: "claudeCode" | "codex";
} {
  if (value === "claude") return { cliKey: value, provider: "claudeCode" };
  if (value === "codex") return { cliKey: value, provider: value };
  throw new Error("provider must be claude or codex.");
}

async function resolveProviderAuthHostId(
  opts: ProviderListCommandOptions,
  serverUrl: string,
): Promise<string> {
  const sdk = createCliBbSdk(serverUrl);
  const routing = await resolveProviderRouting(opts, serverUrl);
  if (routing.hostId) return routing.hostId;
  if (routing.environmentId) {
    return (
      await sdk.environments.get({
        environmentId: routing.environmentId,
      })
    ).hostId;
  }
  const primaryHostId = (await sdk.system.config()).primaryHostId;
  if (primaryHostId) return primaryHostId;
  const hosts = await sdk.hosts.list();
  const fallback =
    hosts.find((host) => host.status === "connected") ?? hosts[0] ?? null;
  if (!fallback) throw new Error("No primary machine is configured.");
  return fallback.id;
}

export function registerProviderCommands(
  program: Command,
  getUrl: () => string,
): void {
  const provider = program
    .command("provider")
    .description("Inspect providers, models, and subscription login");

  addProviderRoutingOptions(provider.command("list"))
    .description("List available providers")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ProviderListCommandOptions) => {
        const serverUrl = getUrl();
        const sdk = createCliBbSdk(serverUrl);
        const providers = await sdk.providers.list(
          await resolveProviderRouting(opts, serverUrl),
        );
        if (outputJson(opts, providers)) return;
        if (providers.length === 0) {
          console.log("No providers available");
          return;
        }
        printProviderTable(providers);
      }),
    );

  addProviderRoutingOptions(provider.command("models [providerId]"))
    .description("List available models for a provider")
    .option("--json", "Print machine-readable JSON output")
    .option(
      "--selected-model <model>",
      "Include a selected-only model if it matches",
    )
    .action(
      action(
        async (
          providerId: string | undefined,
          opts: ProviderModelsCommandOptions,
        ) => {
          const serverUrl = getUrl();
          const sdk = createCliBbSdk(serverUrl);
          const executionOptions = await sdk.providers.models({
            ...(await resolveProviderRouting(opts, serverUrl)),
            ...(providerId ? { providerId } : {}),
          });
          const models = includeSelectedOnlyModel({
            models: executionOptions.models,
            selectedOnlyModels: executionOptions.selectedOnlyModels,
            selectedModel: opts.selectedModel,
          });
          if (outputJson(opts, models)) return;
          if (models.length === 0) {
            console.log("No models available");
            return;
          }
          printModelTable(models, providerId);
        },
      ),
    );

  const auth = provider
    .command("auth")
    .description("Inspect or start provider subscription login");

  addProviderRoutingOptions(auth.command("status"))
    .description("Show Claude Code and Codex login status")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ProviderAuthCommandOptions) => {
        const serverUrl = getUrl();
        const hostId = await resolveProviderAuthHostId(opts, serverUrl);
        const snapshot = await createCliBbSdk(
          serverUrl,
        ).hosts.providerAuthStatus({ hostId });
        if (outputJson(opts, snapshot)) return;
        printProviderAuthStatus(snapshot);
      }),
    );

  addProviderRoutingOptions(auth.command("login <provider>"))
    .description("Log in to Claude Code or Codex with a subscription")
    .option("--json", "Print the initial machine-readable login state")
    .option("--no-wait", "Return after showing the link and code")
    .action(
      action(
        async (providerValue: string, opts: ProviderAuthCommandOptions) => {
          const selected = parseProviderAuthKey(providerValue);
          const serverUrl = getUrl();
          const hostId = await resolveProviderAuthHostId(opts, serverUrl);
          const sdk = createCliBbSdk(serverUrl);
          let snapshot = await sdk.hosts.startProviderAuth({
            hostId,
            provider: selected.provider,
          });
          if (outputJson(opts, snapshot)) return;
          const session = snapshot.sessions.find(
            (candidate) => candidate.provider === selected.provider,
          );
          if (!session) {
            printProviderAuthStatus(snapshot);
            return;
          }
          printProviderAuthSession(session);
          if (opts.wait === false) return;

          if (selected.cliKey === "claude") {
            if (session.phase !== "waitingForCode") return;
            const readline = createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            try {
              const code = await readline.question("One-time code: ");
              snapshot = await sdk.hosts.submitProviderAuthCode({
                hostId,
                sessionId: session.sessionId,
                code,
              });
            } finally {
              readline.close();
            }
          } else {
            snapshot = await waitForProviderAuth(sdk, hostId, "codex");
          }
          printProviderAuthStatus(snapshot);
          const completedSession = snapshot.sessions.find(
            (candidate) => candidate.provider === selected.provider,
          );
          if (completedSession?.recoveryCommand) {
            console.log(`Run locally: ${completedSession.recoveryCommand}`);
            console.log(
              "Enter your Mac password only on that Mac. Never send it through BB.",
            );
          }
        },
      ),
    );
}

async function waitForProviderAuth(
  sdk: {
    hosts: {
      providerAuthStatus(args: {
        hostId: string;
      }): Promise<HostProviderAuthSnapshot>;
    };
  },
  hostId: string,
  provider: "claudeCode" | "codex",
): Promise<HostProviderAuthSnapshot> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    const snapshot = await sdk.hosts.providerAuthStatus({ hostId });
    const session = snapshot.sessions.find(
      (candidate) => candidate.provider === provider,
    );
    if (
      snapshot.statuses[provider].state === "loggedIn" ||
      !session ||
      ["succeeded", "recoveryRequired", "failed"].includes(session.phase)
    ) {
      return snapshot;
    }
  }
  throw new Error("Provider login timed out after 10 minutes.");
}

function printProviderAuthSession(
  session: HostProviderAuthSnapshot["sessions"][number],
): void {
  if (session.oauthUrl) console.log(`Open: ${session.oauthUrl}`);
  if (session.userCode) console.log(`One-time code: ${session.userCode}`);
  if (session.message) console.log(session.message);
}

function printProviderAuthStatus(snapshot: HostProviderAuthSnapshot): void {
  const statuses = [snapshot.statuses.claudeCode, snapshot.statuses.codex];
  const rows = statuses.map((status) => [
    status.displayName,
    status.state,
    status.accountEmail ?? "—",
    status.organizationName ?? "—",
  ]);
  const table = renderBorderlessTable(
    {
      head: ["Provider", "Status", "Account", "Organization"],
      colWidths: [
        Math.max(8, ...rows.map((row) => row[0].length)),
        Math.max(6, ...rows.map((row) => row[1].length)),
        Math.max(7, ...rows.map((row) => row[2].length)),
        Math.max(12, ...rows.map((row) => row[3].length)),
      ],
    },
    rows,
  );
  console.log("");
  console.log(table);
  console.log("");
}

function includeSelectedOnlyModel(
  args: IncludeSelectedOnlyModelArgs,
): AvailableModel[] {
  if (!args.selectedModel) {
    return args.models;
  }
  if (args.models.some((model) => model.model === args.selectedModel)) {
    return args.models;
  }
  const selectedOnlyModel = args.selectedOnlyModels.find(
    (model) => model.model === args.selectedModel,
  );
  return selectedOnlyModel ? [selectedOnlyModel, ...args.models] : args.models;
}

function printProviderTable(providers: SystemProviderInfo[]): void {
  const rows = providers.map((provider) => [provider.id, provider.displayName]);
  const idWidth = Math.max(4, ...rows.map((row) => row[0].length));
  const nameWidth = Math.max(4, ...rows.map((row) => row[1].length));
  const table = renderBorderlessTable(
    {
      head: ["ID", "Name"],
      colWidths: [idWidth, nameWidth],
    },
    rows,
  );

  console.log("");
  console.log(table);
  console.log("");
}

function printModelTable(models: AvailableModel[], providerId?: string): void {
  if (providerId) {
    console.log(`Models for ${providerId}:`);
  }

  const rows = models.map((model) => [
    model.model,
    model.displayName ?? model.model,
    model.isDefault ? "*" : "",
  ]);
  const modelWidth = Math.max(5, ...rows.map((row) => row[0].length));
  const nameWidth = Math.max(4, ...rows.map((row) => row[1].length));
  const defaultWidth = Math.max(7, ...rows.map((row) => row[2].length));
  const table = renderBorderlessTable(
    {
      head: ["Model", "Name", "Default"],
      colWidths: [modelWidth, nameWidth, defaultWidth],
      trimTrailingWhitespace: true,
    },
    rows,
  );

  console.log("");
  console.log(table);
  console.log("");
}
