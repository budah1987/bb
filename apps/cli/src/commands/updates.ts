import { Command } from "commander";
import {
  BBAMIR_UPSTREAM_UPDATE_TITLE,
  buildBbamirUpstreamUpdatePrompt,
  isLocalPathProjectSource,
  type Host,
  type Thread,
} from "@bb/domain";
import type {
  HostProviderCliStatusResponse,
  ProjectResponse,
} from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { resolveExplicitIdFlag } from "../context-env.js";
import { renderBorderlessTable } from "../table.js";
import { outputJson, prependErrorContext } from "./helpers.js";
import { resolveMachineHostId, resolveMachineId } from "./machine.js";

const MANAGED_PROVIDERS = ["codex", "claudeCode"] as const;

type ProviderCliKey = (typeof MANAGED_PROVIDERS)[number];
type ProviderCliStatus = HostProviderCliStatusResponse[ProviderCliKey];
type ProviderCliStatusResponse = HostProviderCliStatusResponse;

interface UpdatesCommandOptions {
  json?: boolean;
  machine?: string;
}

interface BbamirUpdateCommandOptions {
  json?: boolean;
  machine?: string;
  project: string;
}

interface ProviderUpdateTarget {
  host: Host;
  provider: ProviderCliKey;
  status: ProviderCliStatus;
}

interface MachineUpdatesEntry {
  host: Host;
  providerStatus: ProviderCliStatusResponse | null;
  statusError: string | null;
}

function providerStateLabel(status: ProviderCliStatus): string {
  if (!status.installed) return "not installed";
  if (status.versionUnsupported) return "update needed";
  if (status.needsUpdate) {
    return status.installAction === null
      ? "update manually"
      : "update available";
  }
  return "up to date";
}

function providerVersionLabel(status: ProviderCliStatus): string {
  const current = status.currentVersion ?? "unknown";
  const latest = status.latestVersion;
  if (latest !== null && latest !== status.currentVersion) {
    return `${current} -> ${latest}`;
  }
  return current;
}

function isActionableProviderStatus(status: ProviderCliStatus): boolean {
  return (
    status.installAction !== null &&
    (!status.installed || status.needsUpdate || status.versionUnsupported)
  );
}

async function collectMachineUpdates(
  sdk: ReturnType<typeof createCliBbSdk>,
  hosts: readonly Host[],
): Promise<MachineUpdatesEntry[]> {
  return Promise.all(
    hosts.map(async (host): Promise<MachineUpdatesEntry> => {
      if (host.status !== "connected") {
        return { host, providerStatus: null, statusError: null };
      }
      try {
        return {
          host,
          providerStatus: await sdk.hosts.providerCliStatus({
            hostId: host.id,
          }),
          statusError: null,
        };
      } catch (error) {
        return {
          host,
          providerStatus: null,
          statusError: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

function actionableTargets(
  entries: readonly MachineUpdatesEntry[],
): ProviderUpdateTarget[] {
  const targets: ProviderUpdateTarget[] = [];
  for (const entry of entries) {
    if (entry.providerStatus === null) continue;
    for (const provider of MANAGED_PROVIDERS) {
      const status = entry.providerStatus[provider];
      if (isActionableProviderStatus(status)) {
        targets.push({ host: entry.host, provider, status });
      }
    }
  }
  return targets;
}

function printUpdatesTable(args: {
  appRow: readonly [string, string, string];
  entries: readonly MachineUpdatesEntry[];
}): void {
  const rows: string[][] = [[...args.appRow]];
  for (const entry of args.entries) {
    if (entry.host.status !== "connected") {
      rows.push([entry.host.name, "-", "offline"]);
      continue;
    }
    if (entry.providerStatus === null) {
      rows.push([entry.host.name, "-", entry.statusError ?? "status failed"]);
      continue;
    }
    for (const provider of MANAGED_PROVIDERS) {
      const status = entry.providerStatus[provider];
      rows.push([
        `${entry.host.name} · ${status.displayName}`,
        providerVersionLabel(status),
        providerStateLabel(status),
      ]);
    }
  }
  const widths = [
    Math.max(6, ...rows.map((row) => row[0].length)),
    Math.max(7, ...rows.map((row) => row[1].length)),
    Math.max(5, ...rows.map((row) => row[2].length)),
  ];
  console.log("");
  console.log(
    renderBorderlessTable(
      {
        head: ["Target", "Version", "State"],
        colWidths: widths,
        trimTrailingWhitespace: true,
      },
      rows,
    ),
  );
  console.log("");
}

function selectBbamirSource(args: {
  hosts: readonly Host[];
  project: ProjectResponse;
  selectedHostId: string | null;
}): { hostId: string; path: string } {
  if (
    args.project.kind !== "standard" ||
    args.project.name.trim().toLocaleLowerCase() !== "bbamir"
  ) {
    throw new Error(
      `Project ${args.project.id} is not the BBamir project; refusing to update it.`,
    );
  }

  const connectedHostIds = new Set(
    args.hosts
      .filter((host) => host.status === "connected")
      .map((host) => host.id),
  );
  const sources = args.project.sources.filter(
    (source) =>
      isLocalPathProjectSource(source) &&
      connectedHostIds.has(source.hostId) &&
      (args.selectedHostId === null || source.hostId === args.selectedHostId),
  );
  const defaultSources = sources.filter((source) => source.isDefault);
  const candidates = defaultSources.length > 0 ? defaultSources : sources;
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? "BBamir has no connected local checkout. Connect its machine first."
        : "BBamir has more than one eligible checkout; pass --machine to choose one.",
    );
  }
  const source = candidates[0];
  if (!isLocalPathProjectSource(source)) {
    throw new Error("BBamir requires a local checkout for an upstream update.");
  }
  return { hostId: source.hostId, path: source.path };
}

async function startBbamirUpdate(
  options: BbamirUpdateCommandOptions,
  serverUrl: string,
): Promise<void> {
  const projectId = resolveExplicitIdFlag({
    flagName: "--project flag",
    value: options.project,
  });
  if (!projectId) {
    throw new Error("Missing required option --project <id>.");
  }

  const sdk = createCliBbSdk(serverUrl);
  const [project, hosts] = await Promise.all([
    sdk.projects.get({ projectId }),
    sdk.hosts.list(),
  ]);
  const selectedHostId =
    options.machine === undefined
      ? null
      : await resolveMachineHostId({
          serverUrl,
          target: options.machine,
        });
  const source = selectBbamirSource({
    hosts,
    project,
    selectedHostId,
  });

  let thread: Thread;
  try {
    thread = await sdk.threads.spawn({
      origin: "cli",
      projectId,
      title: BBAMIR_UPSTREAM_UPDATE_TITLE,
      input: [
        {
          type: "text",
          text: buildBbamirUpstreamUpdatePrompt({ sourcePath: source.path }),
          mentions: [],
        },
      ],
      environment: {
        type: "host",
        hostId: source.hostId,
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "default" },
        },
      },
      startedOnBehalfOf: null,
      originKind: null,
      childOrigin: null,
    });
  } catch (error: unknown) {
    throw prependErrorContext(
      "Failed to create BBamir update workspace",
      error,
    );
  }

  if (outputJson(options, thread)) return;
  console.log(`BBamir update workspace created: ${thread.id}`);
}

export function registerUpdatesCommands(
  program: Command,
  getUrl: () => string,
): void {
  const updates = program
    .command("updates")
    .description("Inspect and apply bb and provider CLI updates");

  updates
    .command("status", { isDefault: true })
    .description("Show bb and provider CLI update status across machines")
    .option("--machine <id-or-name>", "Limit to one machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: UpdatesCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const [version, hosts] = await Promise.all([
          sdk.system.version(),
          sdk.hosts.list(),
        ]);
        const selectedHosts =
          opts.machine === undefined
            ? hosts
            : hosts.filter(
                (host) => host.id === resolveMachineId(hosts, opts.machine!),
              );
        const entries = await collectMachineUpdates(sdk, selectedHosts);
        if (
          outputJson(opts, {
            app: version,
            machines: entries.map((entry) => ({
              host: entry.host,
              providerStatus: entry.providerStatus,
              statusError: entry.statusError,
            })),
          })
        ) {
          return;
        }

        const appState = version.isDevelopment
          ? "development mode"
          : version.updateAvailable
            ? `update available (run: ${version.upgradeCommand})`
            : "up to date";
        const appVersionLabel =
          version.latestVersion !== null &&
          version.latestVersion !== version.currentVersion
            ? `${version.currentVersion} -> ${version.latestVersion}`
            : version.currentVersion;
        printUpdatesTable({
          appRow: ["bb-app", appVersionLabel, appState],
          entries,
        });
      }),
    );

  updates
    .command("from-bb")
    .description(
      "Start a protected BBamir upstream-update workspace with conflict planning",
    )
    .requiredOption("--project <id>", "BBamir project ID")
    .option(
      "--machine <id-or-name>",
      "Limit the update to one connected machine",
    )
    .option("--json", "Print the created thread as JSON")
    .action(
      action(async (opts: BbamirUpdateCommandOptions) => {
        await startBbamirUpdate(opts, getUrl());
      }),
    );

  updates
    .command("apply")
    .description("Run every available provider CLI install/update")
    .option("--machine <id-or-name>", "Limit to one machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: UpdatesCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hosts = await sdk.hosts.list();
        const selectedHosts =
          opts.machine === undefined
            ? hosts
            : hosts.filter(
                (host) => host.id === resolveMachineId(hosts, opts.machine!),
              );
        const entries = await collectMachineUpdates(sdk, selectedHosts);
        const targets = actionableTargets(entries);
        if (targets.length === 0) {
          if (outputJson(opts, { results: [] })) return;
          const hasManualUpdates = entries.some(
            (entry) =>
              entry.providerStatus !== null &&
              MANAGED_PROVIDERS.some((provider) => {
                const status = entry.providerStatus?.[provider];
                return (
                  status !== undefined &&
                  status.installed &&
                  status.needsUpdate &&
                  status.installAction === null
                );
              }),
          );
          console.log(
            hasManualUpdates
              ? "No updates bb can apply. Run bb updates status for manual updates."
              : "Everything is up to date.",
          );
          return;
        }

        const results: {
          hostId: string;
          hostName: string;
          provider: ProviderCliKey;
          success: boolean;
          message: string | null;
        }[] = [];
        for (const target of targets) {
          const actionKind = target.status.installAction?.kind ?? "install";
          if (!opts.json) {
            console.log(
              `${target.status.displayName} on ${target.host.name}: running ${actionKind}…`,
            );
          }
          try {
            const events = await sdk.hosts.installProviderCli({
              hostId: target.host.id,
              provider: target.provider,
              actionKind,
            });
            const completed = events.find(
              (event) => event.type === "completed",
            );
            const errorEvent = events.find((event) => event.type === "error");
            const success =
              completed?.type === "completed" && completed.success;
            results.push({
              hostId: target.host.id,
              hostName: target.host.name,
              provider: target.provider,
              success,
              message: errorEvent?.type === "error" ? errorEvent.message : null,
            });
            if (!opts.json) {
              console.log(
                success
                  ? `${target.status.displayName} on ${target.host.name}: done`
                  : `${target.status.displayName} on ${target.host.name}: failed${
                      errorEvent?.type === "error"
                        ? ` (${errorEvent.message})`
                        : ""
                    }`,
              );
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            results.push({
              hostId: target.host.id,
              hostName: target.host.name,
              provider: target.provider,
              success: false,
              message,
            });
            if (!opts.json) {
              console.log(
                `${target.status.displayName} on ${target.host.name}: failed (${message})`,
              );
            }
          }
        }
        if (outputJson(opts, { results })) return;
        const failures = results.filter((result) => !result.success);
        if (failures.length > 0) {
          throw new Error(
            `${failures.length} update${failures.length === 1 ? "" : "s"} failed.`,
          );
        }
      }),
    );
}
