import { Command } from "commander";
import {
  PERSONAL_PROJECT_ID,
  threadVisibilitySchema,
  type Thread,
} from "@bb/domain";
import type { BaseBranchSpec, EnvironmentArgs } from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  resolveExplicitIdFlag,
  resolveContextThreadId,
} from "../../context-env.js";
import { resolveLocalHostId } from "../../daemon.js";
import {
  resolveMachineHostId,
  resolveMachineTargetOption,
} from "../machine.js";
import {
  outputJson,
  parseReasoningLevel,
  prependErrorContext,
} from "../helpers.js";
import {
  parsePermissionMode,
  buildPromptInputs,
  collectOption,
  PERMISSION_MODE_HELP,
  parseServiceTier,
} from "./helpers.js";

interface ThreadSpawnCommandOptions {
  prompt: string;
  json?: boolean;
  project?: string;
  environment?: string;
  newEnvironment?: string;
  baseBranch?: string;
  branchName?: string;
  pullRequest?: string;
  parentThread?: string;
  provider?: string;
  model?: string;
  reasoningLevel?: string;
  title?: string;
  serviceTier?: string;
  permissionMode?: string;
  parentSelf?: boolean;
  machine?: string;
  host?: string;
  file?: string[];
  image?: string[];
  section?: string;
  originKind?: string;
  sourceThread?: string;
  sourceSeqEnd?: string;
  visibility?: string;
}

export function looksLikePath(value: string): boolean {
  return value.includes("/") || value.startsWith(".") || value.startsWith("~");
}

export function requireHostId(hostId: string | null): string {
  if (!hostId) {
    throw new Error("Cannot reach local host daemon. Is it running?");
  }
  return hostId;
}

export function parsePullRequestNumber(
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error("--pull-request must be a positive integer.");
  }
  return number;
}

function resolveSpawnEnvironmentValue(flagValue?: string): string | undefined {
  const trimmedValue = flagValue?.trim();
  if (!trimmedValue) return undefined;
  if (looksLikePath(trimmedValue)) return trimmedValue;
  return resolveExplicitIdFlag({
    flagName: "--environment flag",
    value: trimmedValue,
  });
}

function resolveSpawnParentThreadId(args: {
  parentSelf?: boolean;
  parentThread?: string;
}): string | undefined {
  const explicitParentThreadId = resolveExplicitIdFlag({
    flagName: "--parent-thread",
    value: args.parentThread,
  });
  if (explicitParentThreadId && args.parentSelf) {
    throw new Error("Cannot combine --parent-thread with --parent-self.");
  }
  if (args.parentSelf) {
    const selfThreadId = resolveContextThreadId();
    if (!selfThreadId) {
      throw new Error("--parent-self requires BB_THREAD_ID to be set.");
    }
    return selfThreadId;
  }
  return explicitParentThreadId;
}

export function buildSpawnEnvironment(args: {
  defaultPersonalWorkspace: boolean;
  environmentValue?: string;
  newEnvironmentKind?: string;
  hostId: string | null;
  baseBranch?: string;
  branchName?: string;
  pullRequestNumber?: number;
}): EnvironmentArgs {
  const environmentValue = args.environmentValue?.trim();
  const newEnvironmentKind = args.newEnvironmentKind?.trim();
  const trimmedBaseBranch = args.baseBranch?.trim();
  const branchName = args.branchName?.trim();
  const pullRequestNumber = args.pullRequestNumber;
  const baseBranch: BaseBranchSpec = trimmedBaseBranch
    ? { kind: "named", name: trimmedBaseBranch }
    : { kind: "default" };

  if (environmentValue && newEnvironmentKind) {
    throw new Error("Cannot combine --environment with --new-environment.");
  }
  if (
    environmentValue &&
    !looksLikePath(environmentValue) &&
    (branchName || pullRequestNumber !== undefined || trimmedBaseBranch)
  ) {
    throw new Error(
      "Branch and pull-request flags cannot be combined with an existing environment ID.",
    );
  }
  if (pullRequestNumber !== undefined && trimmedBaseBranch) {
    throw new Error("--pull-request cannot be combined with --base-branch.");
  }
  if (
    branchName &&
    newEnvironmentKind !== "worktree" &&
    pullRequestNumber === undefined &&
    !trimmedBaseBranch
  ) {
    throw new Error(
      "--branch-name requires --base-branch unless --pull-request or --new-environment worktree is used.",
    );
  }
  if (
    args.defaultPersonalWorkspace &&
    (branchName || pullRequestNumber !== undefined || trimmedBaseBranch)
  ) {
    throw new Error(
      "Branch and pull-request flags require a repository-backed project.",
    );
  }
  if (trimmedBaseBranch && newEnvironmentKind !== "worktree" && !branchName) {
    throw new Error(
      "--base-branch requires --new-environment worktree or --branch-name.",
    );
  }
  if (newEnvironmentKind) {
    if (newEnvironmentKind === "worktree") {
      return {
        type: "host",
        hostId: requireHostId(args.hostId),
        workspace: {
          type: "managed-worktree",
          baseBranch,
          ...(branchName ? { branchName } : {}),
          ...(pullRequestNumber === undefined ? {} : { pullRequestNumber }),
        },
      };
    }
    throw new Error(
      `Unknown environment kind '${newEnvironmentKind}'. Supported: worktree.`,
    );
  }
  if (!environmentValue) {
    if (args.defaultPersonalWorkspace) {
      return {
        type: "host",
        ...(args.hostId ? { hostId: args.hostId } : {}),
        workspace: { type: "personal" },
      };
    }
    const unmanagedBranch =
      pullRequestNumber !== undefined
        ? {
            kind: "pull-request" as const,
            number: pullRequestNumber,
            name: branchName || `pr-${pullRequestNumber}`,
          }
        : branchName && trimmedBaseBranch
          ? {
              kind: "new" as const,
              name: branchName,
              baseBranch: trimmedBaseBranch,
            }
          : undefined;
    return {
      type: "host",
      hostId: requireHostId(args.hostId),
      workspace: {
        type: "unmanaged",
        path: null,
        ...(unmanagedBranch ? { branch: unmanagedBranch } : {}),
      },
    };
  }
  if (looksLikePath(environmentValue)) {
    const unmanagedBranch =
      pullRequestNumber !== undefined
        ? {
            kind: "pull-request" as const,
            number: pullRequestNumber,
            name: branchName || `pr-${pullRequestNumber}`,
          }
        : branchName && trimmedBaseBranch
          ? {
              kind: "new" as const,
              name: branchName,
              baseBranch: trimmedBaseBranch,
            }
          : undefined;
    return {
      type: "host",
      hostId: requireHostId(args.hostId),
      workspace: {
        type: "unmanaged",
        path: environmentValue,
        ...(unmanagedBranch ? { branch: unmanagedBranch } : {}),
      },
    };
  }
  return {
    type: "reuse",
    environmentId: environmentValue,
  };
}

export function registerSpawnCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("spawn")
    .description(
      "Spawn a new thread; omitted execution flags use remembered project defaults, then the target provider catalog default",
    )
    .requiredOption("--prompt <prompt>", "Initial prompt for the thread")
    .option("--json", "Print machine-readable JSON output")
    .requiredOption("--project <id>", "Project ID")
    .option(
      "--environment <id-or-path>",
      "Existing environment ID or unmanaged workspace path",
    )
    .option(
      "--new-environment <kind>",
      "Create a new managed environment of the given kind (worktree)",
    )
    .option(
      "--base-branch <branch>",
      "Base branch for a new worktree or a named branch in the current checkout.",
    )
    .option(
      "--branch-name <branch>",
      "Explicit branch name for a new worktree, current checkout, or pull request.",
    )
    .option(
      "--pull-request <number>",
      "Fetch this GitHub pull request head before the thread starts.",
    )
    .option(
      "--machine <id-or-name>",
      "Execution machine ID or unambiguous name",
    )
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--parent-thread <id>", "Parent thread ID for worker thread links")
    .option("--parent-self", "Parent the new thread to BB_THREAD_ID")
    .option(
      "--provider <id>",
      "Provider ID for the thread. Omit to use the project's remembered provider choice",
    )
    .option(
      "--model <model>",
      "Model ID for the thread. Omit to use the project's remembered default for the resolved provider",
    )
    .option(
      "--reasoning-level <level>",
      "Reasoning level: low, medium, high, xhigh, max (provider-dependent)",
    )
    .option("--title <title>", "Thread title")
    .option("--service-tier <tier>", "Service tier: fast or default")
    .option("--permission-mode <mode>", PERMISSION_MODE_HELP)
    .option(
      "--file <path>",
      "Pass a host-readable absolute or uploaded attachment file path (repeatable)",
      collectOption,
      [],
    )
    .option(
      "--image <path>",
      "Pass a host-readable absolute or uploaded attachment image path (repeatable)",
      collectOption,
      [],
    )
    .option("--section <id>", "Create the thread in a section")
    .option(
      "--visibility <visibility>",
      "Thread visibility: visible or hidden (a child inherits its parent)",
    )
    .option("--origin-kind <kind>", "Thread origin: fork")
    .option("--source-thread <id>", "Source thread for a fork")
    .option("--source-seq-end <seq>", "Last source event sequence")
    .action(
      action(async (opts: ThreadSpawnCommandOptions) => {
        const projectId = resolveExplicitIdFlag({
          flagName: "--project flag",
          value: opts.project,
        });
        if (!projectId) {
          throw new Error("Missing required option --project <id>.");
        }
        const environmentValue = resolveSpawnEnvironmentValue(opts.environment);
        const machineTarget = resolveMachineTargetOption(opts);
        if (
          machineTarget &&
          environmentValue &&
          !looksLikePath(environmentValue)
        ) {
          throw new Error(
            "Cannot combine --machine or --host with an existing environment ID; that environment already selects its machine.",
          );
        }
        const defaultPersonalWorkspace =
          projectId === PERSONAL_PROJECT_ID &&
          !environmentValue &&
          !opts.newEnvironment;
        const needsHostId =
          Boolean(opts.newEnvironment) ||
          (!defaultPersonalWorkspace &&
            (!environmentValue || looksLikePath(environmentValue)));
        const hostId = machineTarget
          ? await resolveMachineHostId({
              serverUrl: getUrl(),
              target: machineTarget,
            })
          : needsHostId
            ? await resolveLocalHostId()
            : null;
        const environment = buildSpawnEnvironment({
          defaultPersonalWorkspace,
          environmentValue,
          newEnvironmentKind: opts.newEnvironment,
          hostId,
          baseBranch: opts.baseBranch,
          branchName: opts.branchName,
          pullRequestNumber: parsePullRequestNumber(opts.pullRequest),
        });
        const reasoningLevel = parseReasoningLevel(opts.reasoningLevel);
        const serviceTier = parseServiceTier(opts.serviceTier);
        const permissionMode = parsePermissionMode(opts.permissionMode);
        const visibility =
          opts.visibility === undefined
            ? undefined
            : threadVisibilitySchema.parse(opts.visibility);
        const parentThreadId = resolveSpawnParentThreadId({
          parentSelf: opts.parentSelf,
          parentThread: opts.parentThread,
        });
        if (opts.originKind !== undefined && opts.originKind !== "fork") {
          throw new Error("--origin-kind must be fork.");
        }
        const sourceSeqEnd =
          opts.sourceSeqEnd === undefined
            ? undefined
            : Number(opts.sourceSeqEnd);
        if (
          sourceSeqEnd !== undefined &&
          (!Number.isInteger(sourceSeqEnd) || sourceSeqEnd < 0)
        ) {
          throw new Error("--source-seq-end must be a non-negative integer.");
        }

        let thread: Thread;
        try {
          const sdk = createCliBbSdk(getUrl());
          thread = await sdk.threads.spawn({
            origin: "cli",
            projectId,
            ...(opts.provider ? { providerId: opts.provider } : {}),
            ...(opts.model ? { model: opts.model } : {}),
            input: buildPromptInputs({
              message: opts.prompt,
              files: opts.file,
              images: opts.image,
            }),
            ...(reasoningLevel ? { reasoningLevel } : {}),
            ...(opts.title ? { title: opts.title } : {}),
            ...(serviceTier ? { serviceTier } : {}),
            ...(permissionMode ? { permissionMode } : {}),
            ...(visibility ? { visibility } : {}),
            environment,
            // The typed $post client types this body against the schema's
            // output shape, where startedOnBehalfOf/originKind
            // (`.default(null)`) are required — so a normal spawn passes the
            // explicit null the server would otherwise fill. (A fork sets
            // these; the CLI never does. z.input would re-optionalize the
            // SDK arg type but the underlying $post still requires them, so the
            // null lives here.)
            startedOnBehalfOf: null,
            originKind: opts.originKind ?? null,
            ...(parentThreadId ? { parentThreadId } : {}),
            ...(opts.section ? { sectionId: opts.section } : {}),
            ...(opts.sourceThread ? { sourceThreadId: opts.sourceThread } : {}),
            ...(sourceSeqEnd !== undefined ? { sourceSeqEnd } : {}),
          });
        } catch (err: unknown) {
          throw prependErrorContext("Failed to create thread", err);
        }

        if (outputJson(opts, thread)) return;
        console.log(`Thread spawned: ${thread.id}`);
        // A hidden child reports to its parent too, so the promise follows the
        // parent link alone.
        if (
          thread.parentThreadId &&
          thread.parentThreadId === resolveContextThreadId()
        ) {
          console.log("You will be notified when this thread is done.");
        }
        printThread(thread);
      }),
    );
}

function printThread(thread: Thread): void {
  console.log("");
  console.log(`  ID:       ${thread.id}`);
  console.log(
    `  Project:  ${thread.projectId === PERSONAL_PROJECT_ID ? "-" : thread.projectId}`,
  );
  console.log(`  Status:   ${thread.status}`);
  if (thread.visibility === "hidden") {
    console.log("  Visibility: hidden");
  }
  if (thread.archivedAt !== null) {
    console.log(`  Archived: ${new Date(thread.archivedAt).toLocaleString()}`);
  }
  console.log(`  Created:  ${new Date(thread.createdAt).toLocaleString()}`);
  console.log(`  Updated:  ${new Date(thread.updatedAt).toLocaleString()}`);
  console.log("");
}
