import { Command } from "commander";
import type {
  CommitActionResponse,
  PublishToMainActionResponse,
  UpdateFromMainActionResponse,
  SquashMergeActionResponse,
} from "@bb/server-contract";
import type {
  EnvironmentDiffArgs,
  EnvironmentDiffFileArgs,
  EnvironmentDiffPatchArgs,
  EnvironmentUpdateArgs,
} from "@bb/sdk";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import {
  outputJson,
  prependErrorContext,
  printEnvironmentGitOperationResult,
} from "./helpers.js";

interface EnvironmentCommitCommandOptions {
  json?: boolean;
  path?: string[];
}

interface EnvironmentPublishToMainCommandOptions {
  json?: boolean;
  preserveTargetChanges?: boolean;
}

interface EnvironmentShowCommandOptions {
  json?: boolean;
}

interface EnvironmentStatusCommandOptions {
  json?: boolean;
  mergeBaseBranch?: string;
}

interface EnvironmentDockerProvenanceCommandOptions {
  json?: boolean;
}

interface EnvironmentDockerActivityCommandOptions {
  json?: boolean;
}

interface EnvironmentDockerControlCommandOptions {
  action: "restart" | "stop";
  container: string;
  json?: boolean;
}

interface EnvironmentPreviewsCommandOptions {
  json?: boolean;
}

interface EnvironmentDevServerStartCommandOptions {
  command: string;
  json?: boolean;
  port?: string;
  thread: string;
  title: string;
}

interface EnvironmentPreviewPortCommandOptions {
  json?: boolean;
  port: string;
}

interface EnvironmentPreviewBypassCommandOptions {
  json?: boolean;
  provider: string;
  secretEnv: string;
}

interface EnvironmentBranchesCommandOptions {
  json?: boolean;
  limit?: string;
  query?: string;
}

interface EnvironmentPathsCommandOptions {
  directories?: boolean;
  files?: boolean;
  json?: boolean;
  limit?: string;
  query?: string;
}

interface EnvironmentDiffCommandOptions {
  json?: boolean;
  mergeBaseBranch?: string;
  sha?: string;
  target: string;
}

interface EnvironmentDiffFileCommandOptions {
  json?: boolean;
  mergeBaseRef?: string;
  path: string;
  sha?: string;
  side: string;
  target: string;
}

interface EnvironmentDiffPatchCommandOptions extends EnvironmentDiffCommandOptions {
  path: string[];
}

interface EnvironmentUpdateCommandOptions {
  clearGithubAccount?: boolean;
  clearMergeBaseBranch?: boolean;
  clearName?: boolean;
  githubAccount?: string;
  json?: boolean;
  mergeBaseBranch?: string;
  name?: string;
}

interface EnvironmentRenameCommandOptions {
  branch?: string;
  folder?: string;
  json?: boolean;
}

interface EnvironmentSquashMergeCommandOptions {
  mergeBaseBranch: string;
  json?: boolean;
}

interface EnvironmentPullRequestCommandOptions {
  allFailed?: boolean;
  base?: string;
  body?: string;
  draft?: boolean;
  fallbackTitle?: string;
  json?: boolean;
  method?: "merge" | "squash" | "rebase";
  check?: string;
  title?: string;
}

interface BuildEnvironmentUpdateArgsInput {
  id: string;
  opts: EnvironmentUpdateCommandOptions;
}

function validateLimit(limit: string | undefined): void {
  if (limit !== undefined && !/^\d+$/u.test(limit)) {
    throw new Error("--limit must contain only digits.");
  }
}

function booleanQueryValue(value: boolean): "true" | "false" {
  return value ? "true" : "false";
}

function parseDiffFileSide(value: string): "old" | "new" {
  switch (value) {
    case "old":
      return "old";
    case "new":
      return "new";
    default:
      throw new Error("--side must be old or new.");
  }
}

function buildEnvironmentDiffArgs(
  id: string,
  opts: EnvironmentDiffCommandOptions,
): EnvironmentDiffArgs {
  switch (opts.target) {
    case "uncommitted":
      if (opts.mergeBaseBranch !== undefined || opts.sha !== undefined) {
        throw new Error(
          "--target uncommitted cannot be combined with --merge-base-branch or --sha.",
        );
      }
      return { environmentId: id, target: "uncommitted" };
    case "branch_committed":
    case "all":
      if (!opts.mergeBaseBranch) {
        throw new Error(
          `--merge-base-branch is required when --target ${opts.target} is used.`,
        );
      }
      if (opts.sha !== undefined) {
        throw new Error(
          `--target ${opts.target} cannot be combined with --sha.`,
        );
      }
      return {
        environmentId: id,
        target: opts.target,
        mergeBaseBranch: opts.mergeBaseBranch,
      };
    case "commit":
      if (!opts.sha) {
        throw new Error("--sha is required when --target commit is used.");
      }
      if (opts.mergeBaseBranch !== undefined) {
        throw new Error(
          "--target commit cannot be combined with --merge-base-branch.",
        );
      }
      return { environmentId: id, target: "commit", sha: opts.sha };
    default:
      throw new Error(
        "--target must be uncommitted, branch_committed, all, or commit.",
      );
  }
}

function buildEnvironmentDiffFileArgs(
  id: string,
  opts: EnvironmentDiffFileCommandOptions,
): EnvironmentDiffFileArgs {
  const side = parseDiffFileSide(opts.side);
  const common = {
    environmentId: id,
    path: opts.path,
    side,
  };
  switch (opts.target) {
    case "uncommitted":
      if (opts.mergeBaseRef !== undefined || opts.sha !== undefined) {
        throw new Error(
          "--target uncommitted cannot be combined with --merge-base-ref or --sha.",
        );
      }
      return { ...common, target: "uncommitted" };
    case "branch_committed":
      if (!opts.mergeBaseRef) {
        throw new Error(
          `--merge-base-ref is required when --target ${opts.target} is used.`,
        );
      }
      if (opts.sha !== undefined) {
        throw new Error(
          `--target ${opts.target} cannot be combined with --sha.`,
        );
      }
      return {
        ...common,
        target: opts.target,
        mergeBaseRef: opts.mergeBaseRef,
      };
    case "all":
      if (!opts.mergeBaseRef) {
        throw new Error(
          `--merge-base-ref is required when --target ${opts.target} is used.`,
        );
      }
      if (opts.sha !== undefined) {
        throw new Error(
          `--target ${opts.target} cannot be combined with --sha.`,
        );
      }
      return {
        ...common,
        target: "all",
        mergeBaseRef: opts.mergeBaseRef,
      };
    case "commit":
      if (!opts.sha) {
        throw new Error("--sha is required when --target commit is used.");
      }
      if (opts.mergeBaseRef !== undefined) {
        throw new Error(
          "--target commit cannot be combined with --merge-base-ref.",
        );
      }
      return { ...common, target: "commit", sha: opts.sha };
    default:
      throw new Error(
        "--target must be uncommitted, branch_committed, all, or commit.",
      );
  }
}

function buildEnvironmentDiffPatchArgs(
  id: string,
  opts: EnvironmentDiffPatchCommandOptions,
): EnvironmentDiffPatchArgs {
  if (opts.path.length === 0) {
    throw new Error("Provide at least one --path.");
  }
  const diffArgs = buildEnvironmentDiffArgs(id, opts);
  switch (diffArgs.target) {
    case "uncommitted":
      return {
        environmentId: id,
        paths: opts.path,
        target: { type: "uncommitted" },
      };
    case "branch_committed":
    case "all":
      return {
        environmentId: id,
        paths: opts.path,
        target: {
          type: diffArgs.target,
          mergeBaseBranch: diffArgs.mergeBaseBranch,
        },
      };
    case "commit":
      return {
        environmentId: id,
        paths: opts.path,
        target: { type: "commit", sha: diffArgs.sha },
      };
  }
}

function collectPath(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function buildEnvironmentUpdateArgs({
  id,
  opts,
}: BuildEnvironmentUpdateArgsInput): EnvironmentUpdateArgs {
  const githubAccountLogin = opts.clearGithubAccount
    ? null
    : opts.githubAccount;
  const mergeBaseBranch = opts.clearMergeBaseBranch
    ? null
    : opts.mergeBaseBranch;
  const name = opts.clearName ? null : opts.name;

  if (githubAccountLogin !== undefined) {
    return {
      environmentId: id,
      githubAccountLogin,
      ...(mergeBaseBranch !== undefined ? { mergeBaseBranch } : {}),
      ...(name !== undefined ? { name } : {}),
    };
  }

  if (opts.clearMergeBaseBranch === true) {
    if (opts.clearName === true) {
      return { environmentId: id, mergeBaseBranch: null, name: null };
    }
    if (opts.name !== undefined) {
      return { environmentId: id, mergeBaseBranch: null, name: opts.name };
    }
    return { environmentId: id, mergeBaseBranch: null };
  }

  if (opts.mergeBaseBranch !== undefined) {
    const mergeBaseBranch = opts.mergeBaseBranch;
    if (opts.clearName === true) {
      return { environmentId: id, mergeBaseBranch, name: null };
    }
    if (opts.name !== undefined) {
      return { environmentId: id, mergeBaseBranch, name: opts.name };
    }
    return { environmentId: id, mergeBaseBranch };
  }

  if (opts.clearName === true) {
    return { environmentId: id, name: null };
  }

  if (opts.name !== undefined) {
    return { environmentId: id, name: opts.name };
  }

  throw new Error(
    "No changes requested. Provide --github-account, --clear-github-account, --merge-base-branch, --clear-merge-base-branch, --name, or --clear-name.",
  );
}

export function registerEnvironmentCommands(
  program: Command,
  getUrl: () => string,
): void {
  const environment = program
    .command("environment")
    .description("Inspect and operate on first-class environments");

  environment
    .command("show <id>")
    .description("Show environment details")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentShowCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const env = await sdk.environments.get({ environmentId: id });
        if (outputJson(opts, env)) return;
        console.log(`Environment: ${env.id}`);
        console.log(`  Project: ${env.projectId}`);
        console.log(`  Status: ${env.status}`);
        if (env.path) {
          console.log(`  Path: ${env.path}`);
        }
        if (env.name) {
          console.log(`  Name: ${env.name}`);
        }
        console.log(`  Managed: ${env.managed}`);
        console.log(`  Provision type: ${env.workspaceProvisionType}`);
        if (env.branchName) {
          console.log(`  Branch: ${env.branchName}`);
        }
        if (env.defaultBranch) {
          console.log(`  Default branch: ${env.defaultBranch}`);
        }
        if (env.mergeBaseBranch) {
          console.log(`  Merge base: ${env.mergeBaseBranch}`);
        }
        if (env.githubAccountLogin) {
          console.log(`  GitHub account: @${env.githubAccountLogin}`);
        }
        console.log(`  Git repo: ${env.isGitRepo}`);
        console.log(`  Worktree: ${env.isWorktree}`);
        console.log(`  Created: ${new Date(env.createdAt).toLocaleString()}`);
        console.log(`  Updated: ${new Date(env.updatedAt).toLocaleString()}`);
      }),
    );

  environment
    .command("status <id>")
    .description("Show an environment's workspace status")
    .option("--merge-base-branch <branch>", "Include merge-base status")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentStatusCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).environments.status({
          environmentId: id,
          ...(opts.mergeBaseBranch !== undefined
            ? { mergeBaseBranch: opts.mergeBaseBranch }
            : {}),
        });
        if (outputJson(opts, result)) return;
        if (result.outcome === "not_applicable") {
          console.log(`Status unavailable: ${result.message}`);
          return;
        }
        if (result.outcome === "unavailable") {
          console.log(`Status unavailable: ${result.failure.message}`);
          return;
        }
        const status = result.workspace;
        console.log(`State: ${status.workingTree.state}`);
        console.log(`Branch: ${status.branch.currentBranch ?? "(detached)"}`);
        console.log(`Default branch: ${status.branch.defaultBranch}`);
        console.log(`Changed files: ${status.workingTree.files.length}`);
        if (status.workingTree.lineStatsComplete) {
          console.log(`Insertions: +${status.workingTree.insertions}`);
          console.log(`Deletions: -${status.workingTree.deletions}`);
        } else {
          console.log("Line stats: unavailable for untracked files");
        }
        if (status.mergeBase) {
          console.log(`Merge base: ${status.mergeBase.mergeBaseBranch}`);
          console.log(`Ahead: ${status.mergeBase.aheadCount}`);
          console.log(`Behind: ${status.mergeBase.behindCount}`);
        }
      }),
    );

  environment
    .command("docker-provenance <id>")
    .description("Show Docker containers using this repository")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string, opts: EnvironmentDockerProvenanceCommandOptions) => {
          const result = await createCliBbSdk(
            getUrl(),
          ).environments.dockerProvenance({ environmentId: id });
          if (outputJson(opts, result)) return;
          if (result.outcome === "unavailable") {
            console.log(`Docker provenance unavailable: ${result.message}`);
            return;
          }
          if (result.services.length === 0) {
            console.log("No Docker containers use this repository.");
            return;
          }
          console.log(`Environment checkout: ${result.environmentPath}`);
          for (const service of result.services) {
            const ports =
              service.publishedPorts.length > 0
                ? ` ports ${service.publishedPorts.join(", ")}`
                : "";
            console.log(
              `${service.name}\t${service.kind}\t${service.state}\t${service.checkoutStatus}${ports}`,
            );
            if (service.ownerCheckoutRoot !== null) {
              console.log(
                `  owner ${service.ownerBranch ?? "(detached)"} at ${service.ownerCheckoutRoot}`,
              );
            }
            for (const mount of service.mounts) {
              console.log(`  ${mount.source} -> ${mount.destination}`);
            }
          }
        },
      ),
    );

  environment
    .command("docker-activity <id>")
    .description("Show Docker source and build freshness")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string, opts: EnvironmentDockerActivityCommandOptions) => {
          const result = await createCliBbSdk(
            getUrl(),
          ).environments.dockerActivity({
            environmentId: id,
          });
          if (outputJson(opts, result)) return;
          if (result.outcome === "unavailable") {
            console.log(`Docker activity unavailable: ${result.message}`);
            return;
          }
          if (result.activities.length === 0) {
            console.log("No mounted Docker builds were found.");
            return;
          }
          for (const activity of result.activities) {
            console.log(`${activity.serviceId}\t${activity.freshness}`);
            if (activity.source !== null) {
              console.log(
                `  source ${activity.source.newestFilePath ?? "(none)"} ${activity.source.newestFileMtimeMs ?? "(none)"}`,
              );
            }
            if (activity.build !== null) {
              console.log(
                `  build ${activity.build.newestFilePath ?? "(none)"} ${activity.build.newestFileMtimeMs ?? "(none)"}`,
              );
            }
          }
        },
      ),
    );

  environment
    .command("docker-control <id>")
    .description("Restart or stop an environment Docker container")
    .requiredOption("--container <id>", "Docker container ID")
    .requiredOption("--action <action>", "restart or stop")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string, opts: EnvironmentDockerControlCommandOptions) => {
          if (opts.action !== "restart" && opts.action !== "stop") {
            throw new Error("--action must be restart or stop.");
          }
          const result = await createCliBbSdk(
            getUrl(),
          ).environments.dockerControl({
            action: opts.action,
            containerId: opts.container,
            environmentId: id,
          });
          if (outputJson(opts, result)) return;
          console.log(`${result.action} requested for ${result.containerId}`);
        },
      ),
    );

  environment
    .command("previews <id>")
    .description("Show local and deployment previews")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPreviewsCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).environments.previews({
          environmentId: id,
        });
        if (outputJson(opts, result)) return;
        if (result.providers.length === 0) {
          console.log("No previews were found.");
        }
        for (const provider of result.providers) {
          const addresses =
            provider.kind === "deployment"
              ? [
                  `branch ${provider.branchUrl ?? "(none)"}`,
                  `deployment ${provider.deploymentUrl ?? "(none)"}`,
                ].join("\t")
              : (provider.url ?? "(no URL)");
          console.log(
            `${provider.label}\t${provider.kind}\t${provider.state}\t${addresses}`,
          );
        }
        for (const issue of result.issues) {
          console.log(`${issue.source}: ${issue.message}`);
        }
      }),
    );

  environment
    .command("dev-server-start <id>")
    .description("Start a durable development server")
    .requiredOption("--thread <id>", "Owning thread")
    .requiredOption("--title <title>", "Server title")
    .requiredOption(
      "--command <command>",
      "Launch command containing the {port} placeholder",
    )
    .option("--port <port>", "Preferred port")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string, opts: EnvironmentDevServerStartCommandOptions) => {
          const result = await createCliBbSdk(
            getUrl(),
          ).environments.startDevServer({
            command: opts.command,
            environmentId: id,
            ...(opts.port === undefined
              ? {}
              : { preferredPort: parseDevServerPort(opts.port) }),
            threadId: opts.thread,
            title: opts.title,
          });
          if (outputJson(opts, result)) return;
          console.log(
            `Started ${result.title} on port ${result.devServerPort ?? "unknown"} (${result.id})`,
          );
        },
      ),
    );

  for (const operation of ["share", "unshare"] as const) {
    environment
      .command(`preview-${operation} <id>`)
      .description(
        operation === "share"
          ? "Share a local preview port"
          : "Stop sharing a local preview port",
      )
      .requiredOption("--port <port>", "Local preview port")
      .option("--json", "Print machine-readable JSON output")
      .action(
        action(
          async (id: string, opts: EnvironmentPreviewPortCommandOptions) => {
            const sdk = createCliBbSdk(getUrl());
            const input = {
              environmentId: id,
              port: parseDevServerPort(opts.port),
            };
            const result =
              operation === "share"
                ? await sdk.environments.sharePreviewPort(input)
                : await sdk.environments.unsharePreviewPort(input);
            if (outputJson(opts, result)) return;
            console.log(
              operation === "share"
                ? `Shared port ${result.port}: ${"url" in result ? result.url : ""}`
                : `Stopped sharing port ${result.port}`,
            );
          },
        ),
      );
  }

  environment
    .command("preview-bypass <id>")
    .description("Create a Vercel protection-bypass preview URL")
    .requiredOption("--provider <id>", "Preview provider ID")
    .option(
      "--secret-env <name>",
      "Environment variable containing the bypass secret",
      "VERCEL_AUTOMATION_BYPASS_SECRET",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string, opts: EnvironmentPreviewBypassCommandOptions) => {
          const secret = process.env[opts.secretEnv]?.trim();
          if (!secret) {
            throw new Error(`${opts.secretEnv} is not set.`);
          }
          const result = await createCliBbSdk(
            getUrl(),
          ).environments.bypassPreviewProtection({
            environmentId: id,
            providerId: opts.provider,
            secret,
          });
          if (outputJson(opts, result)) return;
          console.log(result.url);
        },
      ),
    );

  environment
    .command("branches <id>")
    .description("List branches available in an environment")
    .option("--query <query>", "Branch-name filter")
    .option("--limit <count>", "Maximum local and remote branches")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentBranchesCommandOptions) => {
        validateLimit(opts.limit);
        const result = await createCliBbSdk(getUrl()).environments.diffBranches(
          {
            environmentId: id,
            ...(opts.query !== undefined ? { query: opts.query } : {}),
            ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
          },
        );
        if (outputJson(opts, result)) return;
        console.log("Local branches:");
        for (const branch of result.branches) console.log(`  ${branch}`);
        if (result.branches.length === 0) console.log("  (none)");
        if (result.branchesTruncated) console.log("  (truncated)");
        console.log("Remote branches:");
        for (const branch of result.remoteBranches) console.log(`  ${branch}`);
        if (result.remoteBranches.length === 0) console.log("  (none)");
        if (result.remoteBranchesTruncated) console.log("  (truncated)");
      }),
    );

  environment
    .command("paths <id>")
    .description("Search an environment's files and directories")
    .option("--query <query>", "Fuzzy path query")
    .option("--limit <count>", "Maximum paths")
    .option("--files", "Include files")
    .option("--directories", "Include directories")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPathsCommandOptions) => {
        validateLimit(opts.limit);
        const includeFiles = opts.files === true || opts.directories !== true;
        const includeDirectories =
          opts.directories === true || opts.files !== true;
        const result = await createCliBbSdk(getUrl()).environments.paths({
          environmentId: id,
          includeFiles: booleanQueryValue(includeFiles),
          includeDirectories: booleanQueryValue(includeDirectories),
          ...(opts.query !== undefined ? { query: opts.query } : {}),
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        });
        if (outputJson(opts, result)) return;
        for (const entry of result.paths) {
          console.log(`${entry.kind}\t${entry.path}`);
        }
        if (result.truncated) console.log("(results truncated)");
      }),
    );

  environment
    .command("diff <id>")
    .description("Show an environment's git diff")
    .requiredOption(
      "--target <target>",
      "Diff target: uncommitted, branch_committed, all, or commit",
    )
    .option("--merge-base-branch <branch>", "Branch-based target base")
    .option("--sha <sha>", "Commit target SHA")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentDiffCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).environments.diff(
          buildEnvironmentDiffArgs(id, opts),
        );
        if (outputJson(opts, result)) return;
        if (result.outcome === "not_applicable") {
          console.log(`Diff unavailable: ${result.message}`);
          return;
        }
        if (result.outcome === "unavailable") {
          console.log(`Diff unavailable: ${result.failure.message}`);
          return;
        }
        if (result.diff.files.trim().length > 0) {
          console.log(result.diff.files.trimEnd());
        }
        if (result.diff.shortstat.trim().length > 0) {
          console.log(result.diff.shortstat.trim());
        }
        if (result.diff.diff.length > 0) {
          console.log(result.diff.diff);
        }
        if (result.diff.truncated) console.log("(diff truncated)");
      }),
    );

  environment
    .command("diff-files <id>")
    .description("List changed files in an environment")
    .requiredOption(
      "--target <target>",
      "Diff target: uncommitted, branch_committed, all, or commit",
    )
    .option("--merge-base-branch <branch>", "Branch-based target base")
    .option("--sha <sha>", "Commit target SHA")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentDiffCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).environments.diffFiles(
          buildEnvironmentDiffArgs(id, opts),
        );
        if (outputJson(opts, result)) return;
        if (result.outcome === "not_applicable") {
          console.log(`Diff files unavailable: ${result.message}`);
          return;
        }
        if (result.outcome === "unavailable") {
          console.log(`Diff files unavailable: ${result.failure.message}`);
          return;
        }
        for (const file of result.files) {
          const path = file.previousPath
            ? `${file.previousPath} -> ${file.path}`
            : file.path;
          const stats = file.binary
            ? "binary"
            : `+${file.additions} -${file.deletions}`;
          console.log(
            `${file.changeKind}\t${stats}\t${file.origin}\t${file.loadMode}\t${path}`,
          );
        }
        if (result.shortstat.trim().length > 0) {
          console.log(result.shortstat.trim());
        }
        if (result.truncated) {
          console.log("(additional changed files omitted)");
        }
      }),
    );

  environment
    .command("diff-file <id>")
    .description("Read one side of a changed environment file")
    .requiredOption(
      "--target <target>",
      "Diff target: uncommitted, branch_committed, all, or commit",
    )
    .requiredOption("--path <path>", "Repository-relative file path")
    .requiredOption("--side <side>", "File side: old or new")
    .option("--merge-base-ref <sha>", "Resolved merge-base SHA")
    .option("--sha <sha>", "Commit target SHA")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentDiffFileCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).environments.diffFile(
          buildEnvironmentDiffFileArgs(id, opts),
        );
        if (outputJson(opts, result)) return;
        if (result.contentEncoding === "base64") {
          console.log(`Binary file: ${result.path}`);
          console.log(`Encoding: ${result.contentEncoding}`);
          console.log(`Size: ${result.sizeBytes} bytes`);
          if (result.mimeType) console.log(`MIME type: ${result.mimeType}`);
          console.log(result.content);
          return;
        }
        console.log(result.content);
      }),
    );

  environment
    .command("diff-patch <id>")
    .description("Fetch patches for selected changed files")
    .requiredOption(
      "--target <target>",
      "Diff target: uncommitted, branch_committed, all, or commit",
    )
    .option("--path <path>", "Changed file path (repeatable)", collectPath, [])
    .option("--merge-base-branch <branch>", "Branch-based target base")
    .option("--sha <sha>", "Commit target SHA")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentDiffPatchCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).environments.diffPatch(
          buildEnvironmentDiffPatchArgs(id, opts),
        );
        if (outputJson(opts, result)) return;
        if (result.outcome === "not_applicable") {
          console.log(`Diff patches unavailable: ${result.message}`);
          return;
        }
        if (result.outcome === "unavailable") {
          console.log(`Diff patches unavailable: ${result.failure.message}`);
          return;
        }
        for (const patch of result.patches) {
          console.log(`File: ${patch.path}`);
          console.log(patch.patch);
          if (patch.truncated) console.log("(patch truncated)");
        }
      }),
    );

  environment
    .command("update <id>")
    .description("Update environment metadata")
    .option("--github-account <login>", "GitHub account for this environment")
    .option(
      "--clear-github-account",
      "Follow the active GitHub CLI account instead",
    )
    .option(
      "--merge-base-branch <branch>",
      "Set the merge-base branch override",
    )
    .option("--clear-merge-base-branch", "Clear the merge-base branch override")
    .option("--name <name>", "Set the environment display name")
    .option("--clear-name", "Clear the environment display name")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentUpdateCommandOptions) => {
        const hasMergeBaseBranch = opts.mergeBaseBranch !== undefined;
        const hasClearMergeBaseBranch = opts.clearMergeBaseBranch === true;
        const hasName = opts.name !== undefined;
        const hasClearName = opts.clearName === true;
        const hasGithubAccount = opts.githubAccount !== undefined;
        const hasClearGithubAccount = opts.clearGithubAccount === true;

        if (hasGithubAccount && hasClearGithubAccount) {
          throw new Error(
            "Cannot combine --github-account with --clear-github-account.",
          );
        }

        if (hasMergeBaseBranch && hasClearMergeBaseBranch) {
          throw new Error(
            "Cannot combine --merge-base-branch with --clear-merge-base-branch.",
          );
        }
        if (hasName && hasClearName) {
          throw new Error("Cannot combine --name with --clear-name.");
        }
        if (opts.name !== undefined && opts.name.trim().length === 0) {
          throw new Error("Environment name cannot be empty.");
        }
        if (
          !hasMergeBaseBranch &&
          !hasClearMergeBaseBranch &&
          !hasName &&
          !hasClearName &&
          !hasGithubAccount &&
          !hasClearGithubAccount
        ) {
          throw new Error(
            "No changes requested. Provide --github-account, --clear-github-account, --merge-base-branch, --clear-merge-base-branch, --name, or --clear-name.",
          );
        }

        const sdk = createCliBbSdk(getUrl());
        const environment = await sdk.environments.update(
          buildEnvironmentUpdateArgs({ id, opts }),
        );

        if (outputJson(opts, environment)) return;
        console.log(`Environment ${environment.id} updated`);
        if (hasClearMergeBaseBranch || hasMergeBaseBranch) {
          console.log(
            environment.mergeBaseBranch
              ? `Merge base branch: ${environment.mergeBaseBranch}`
              : "Merge base branch cleared",
          );
        }
        if (hasClearName || hasName) {
          console.log(
            environment.name ? `Name: ${environment.name}` : "Name cleared",
          );
        }
        if (hasClearGithubAccount || hasGithubAccount) {
          console.log(
            environment.githubAccountLogin
              ? `GitHub account: @${environment.githubAccountLogin}`
              : "GitHub account follows the GitHub CLI default",
          );
        }
      }),
    );

  environment
    .command("rename <id>")
    .description("Rename an environment worktree branch or folder")
    .option("--branch <name>", "Rename the checked-out Git branch")
    .option("--folder <name>", "Rename the worktree folder")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentRenameCommandOptions) => {
        if ((opts.branch === undefined) === (opts.folder === undefined)) {
          throw new Error("Provide exactly one of --branch or --folder.");
        }
        const environment = await createCliBbSdk(getUrl()).environments.rename(
          opts.branch !== undefined
            ? { environmentId: id, target: "branch", value: opts.branch }
            : {
                environmentId: id,
                target: "folder",
                value: opts.folder ?? "",
              },
        );
        if (outputJson(opts, environment)) return;
        console.log(`Environment ${environment.id} renamed`);
        if (opts.branch !== undefined) {
          console.log(`Branch: ${environment.branchName ?? opts.branch}`);
        } else {
          console.log(`Path: ${environment.path ?? "unavailable"}`);
        }
      }),
    );

  environment
    .command("commit <id>")
    .description("Commit changes in an environment")
    .option("--path <path>", "Changed file path (repeatable)", collectPath)
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentCommitCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        let result: CommitActionResponse;
        try {
          result = await sdk.environments.commit({
            environmentId: id,
            ...(opts.path === undefined ? {} : { paths: opts.path }),
          });
        } catch (err: unknown) {
          throw prependErrorContext(
            `Failed to commit in environment ${id}`,
            err,
          );
        }
        if (outputJson(opts, result)) return;
        printEnvironmentGitOperationResult(result);
      }),
    );

  environment
    .command("squash-merge <id>")
    .description("Squash-merge changes in an environment")
    .requiredOption("--merge-base-branch <branch>", "Merge-base branch")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentSquashMergeCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const result: SquashMergeActionResponse =
          await sdk.environments.squashMerge({
            environmentId: id,
            mergeBaseBranch: opts.mergeBaseBranch,
          });
        if (outputJson(opts, result)) return;
        printEnvironmentGitOperationResult(result);
      }),
    );

  environment
    .command("publish-to-main <id>")
    .description("Publish a committed managed worktree branch directly to main")
    .option(
      "--preserve-target-changes",
      "Commit local main changes, merge the ingestion branch, and publish both",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string, opts: EnvironmentPublishToMainCommandOptions) => {
          const result: PublishToMainActionResponse = await createCliBbSdk(
            getUrl(),
          ).environments.publishToMain({
            environmentId: id,
            preserveTargetChanges: opts.preserveTargetChanges,
          });
          if (outputJson(opts, result)) return;
          console.log(`Published ${result.sourceBranch} to main`);
          console.log(`Commit: ${result.sourceCommitSha}`);
          console.log(`Local Vault: ${result.localTargetAfterSha}`);
        },
      ),
    );

  environment
    .command("update-from-main <id>")
    .description("Rebase a clean Git worktree onto the latest origin/main")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: { json?: boolean }) => {
        const result: UpdateFromMainActionResponse = await createCliBbSdk(
          getUrl(),
        ).environments.updateFromMain({ environmentId: id });
        if (outputJson(opts, result)) return;
        if (result.outcome === "already_current") {
          console.log(`${result.sourceBranch} already includes origin/main`);
          return;
        }
        console.log(`Updated ${result.sourceBranch} from origin/main`);
        console.log(`Commit: ${result.currentSha}`);
      }),
    );

  environment
    .command("archive-threads <id>")
    .description("Archive every active thread in an environment")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentCommitCommandOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).environments.archiveThreads({
          environmentId: id,
        });
        if (outputJson(opts, result)) return;
        console.log(
          `Archived ${result.archivedThreadIds.length} thread(s) in environment ${id}`,
        );
      }),
    );

  const pullRequest = environment
    .command("pull-request")
    .description("Inspect and manage an environment's pull request");

  pullRequest
    .command("show <id>")
    .description("Show an environment's pull request")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPullRequestCommandOptions) => {
        const result = await createCliBbSdk(getUrl()).environments.pullRequest({
          environmentId: id,
        });
        if (outputJson(opts, result)) return;
        if (result.outcome === "unavailable") {
          console.log(`Pull request lookup unavailable: ${result.message}`);
          return;
        }
        if (result.outcome === "absent") {
          console.log("No pull request found");
          return;
        }
        const pr = result.pullRequest;
        console.log(`Pull request: #${pr.number} ${pr.state} - ${pr.title}`);
        console.log(`URL: ${pr.url}`);
        console.log(`Branch: ${pr.headRefName} -> ${pr.baseRefName}`);
        console.log(`Attention: ${pr.attention}`);
        console.log(
          `Checks: ${pr.checks.state} (${pr.checks.passedCount} passed, ` +
            `${pr.checks.failedCount} failed, ${pr.checks.pendingCount} pending, ` +
            `${pr.checks.totalCount} total)`,
        );
        for (const check of pr.checks.items) {
          const result =
            check.status === "completed"
              ? (check.conclusion ?? "unknown")
              : check.status;
          console.log(
            `  - ${check.name}: ${result}${check.url ? ` (${check.url})` : ""}`,
          );
        }
        console.log(
          `Review: ${pr.review.state} (${pr.review.reviewRequestCount} requested)`,
        );
        console.log(`Merge: ${pr.mergeability.state}`);
      }),
    );

  pullRequest
    .command("suggest <id>")
    .description("Generate a pull request title and description")
    .requiredOption("--base <branch>", "Base branch")
    .requiredOption(
      "--fallback-title <title>",
      "Fallback title when generation is unavailable",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPullRequestCommandOptions) => {
        if (!opts.base || !opts.fallbackTitle) {
          throw new Error("--base and --fallback-title are required.");
        }
        const result = await createCliBbSdk(
          getUrl(),
        ).environments.generatePullRequestMetadata({
          environmentId: id,
          baseBranch: opts.base,
          fallbackTitle: opts.fallbackTitle,
        });
        if (outputJson(opts, result)) return;
        console.log(`Title: ${result.title}`);
        console.log("Description:");
        console.log(result.body || "(empty)");
      }),
    );

  pullRequest
    .command("create <id>")
    .description("Push the environment branch and create a pull request")
    .requiredOption("--base <branch>", "Base branch")
    .requiredOption("--title <title>", "Pull request title")
    .option("--body <body>", "Pull request body", "")
    .option("--draft", "Create as a draft pull request", false)
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPullRequestCommandOptions) => {
        if (!opts.base || !opts.title) {
          throw new Error("--base and --title are required.");
        }
        const result = await createCliBbSdk(
          getUrl(),
        ).environments.createPullRequest({
          environmentId: id,
          baseBranch: opts.base,
          body: opts.body ?? "",
          draft: opts.draft ?? false,
          title: opts.title,
        });
        if (outputJson(opts, result)) return;
        console.log(`${result.message}: ${result.pullRequest.url}`);
      }),
    );

  pullRequest
    .command("ready <id>")
    .description("Mark a pull request ready for review")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPullRequestCommandOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).environments.markPullRequestReady({ environmentId: id });
        if (outputJson(opts, result)) return;
        console.log(result.message);
      }),
    );

  pullRequest
    .command("draft <id>")
    .description("Convert a pull request to draft")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPullRequestCommandOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).environments.markPullRequestDraft({ environmentId: id });
        if (outputJson(opts, result)) return;
        console.log(result.message);
      }),
    );

  pullRequest
    .command("merge <id>")
    .description("Merge a pull request")
    .option(
      "--method <method>",
      "Merge method: merge, squash, or rebase",
      "merge",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPullRequestCommandOptions) => {
        if (
          opts.method !== "merge" &&
          opts.method !== "squash" &&
          opts.method !== "rebase"
        ) {
          throw new Error("--method must be merge, squash, or rebase.");
        }
        const result = await createCliBbSdk(
          getUrl(),
        ).environments.mergePullRequest({
          environmentId: id,
          method: opts.method,
        });
        if (outputJson(opts, result)) return;
        console.log(result.message);
      }),
    );

  pullRequest
    .command("rerun-checks <id>")
    .description("Re-run one failed check or all failed checks")
    .option("--check <name>", "Failed check name")
    .option("--all-failed", "Re-run all failed checks")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: EnvironmentPullRequestCommandOptions) => {
        if (Boolean(opts.check) === Boolean(opts.allFailed)) {
          throw new Error("Use exactly one of --check or --all-failed.");
        }
        const result = await createCliBbSdk(
          getUrl(),
        ).environments.rerunPullRequestChecks({
          environmentId: id,
          target: opts.allFailed
            ? { scope: "failed" }
            : { scope: "check", checkName: opts.check ?? "" },
        });
        if (outputJson(opts, result)) return;
        console.log(result.message);
      }),
    );
}

function parseDevServerPort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Port must be an integer between 1024 and 65535.");
  }
  return port;
}
