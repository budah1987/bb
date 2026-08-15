import path from "node:path";
import {
  hasBusyThreadInEnvironment,
  recordEnvironmentWorkspaceRename,
  updateEnvironmentMetadata,
} from "@bb/db";
import {
  type GitBranchRefClassification,
  resolveEnvironmentWorkspaceDisplayKind,
  type Environment,
  type ThreadPullRequest,
} from "@bb/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type DiffPatchEntry,
  type EnvironmentDiffFileQuery,
  type EnvironmentDiffQuery,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import {
  COMMAND_TIMEOUT_MS,
  DIFF_FILE_PATCH_MAX_BYTES,
  WORKSPACE_DIFF_MAX_FILES,
  WORKSPACE_DIFF_MAX_DIFF_BYTES,
  WORKSPACE_DIFF_MAX_FILE_LIST_BYTES,
} from "../constants.js";

import { ApiError } from "../errors.js";
import {
  requireEnvironment,
  requirePublicThread,
  requireReadyEnvironment,
} from "../services/lib/entity-lookup.js";
import { runLiveCommandAndWait } from "../services/hosts/live-command-wait.js";
import {
  callHostOnlineRpc,
  callHostRetryableOnlineRpc,
} from "../services/hosts/online-rpc.js";
import { generateCommitMessage } from "../services/ai/commit-message.js";
import { generatePullRequestMetadata } from "../services/ai/pull-request-metadata.js";
import { archiveEnvironmentThreads } from "../services/threads/thread-archive.js";
import {
  normalizeBranchQuery,
  parseBranchListLimit,
} from "./branch-list-query.js";
import { parseFileListLimit } from "./file-list-query.js";
import { parsePathKindInclusion } from "./path-list-inclusion.js";

const PULL_REQUEST_CREATE_TIMEOUT_MS = 3 * 60_000;
import { requireWorkspaceCommandTarget } from "../services/environments/workspace-command-target.js";
import { callEnvironmentWorkspaceStatus } from "../services/environments/workspace-status.js";
import {
  getEnvironmentDockerActivity,
  getEnvironmentDockerProvenance,
} from "../services/environments/docker-provenance.js";
import {
  buildVercelProtectionBypassUrl,
  getEnvironmentPreviews,
} from "../services/environments/previews.js";
import { assembleThreadPullRequest } from "../services/environments/pull-request.js";
import { getGithubAccounts } from "../services/system/github-repositories.js";
import {
  requireAvailableWorkspaceDiff,
  requireAvailableWorkspaceStatus,
} from "../services/environments/workspace-rpc-results.js";
import {
  rawDiffFileStatToEntry,
  selectInitialPatchPaths,
} from "./diff-tiering.js";

const COMMIT_FALLBACK_MESSAGE = "bb: automated commit";
const SQUASH_MERGE_FALLBACK_MESSAGE = "bb: squash merge";
const SIMULATOR_RPC_TIMEOUT_MS = 2 * 60_000;

/** Caps for diffs sent to the inference model for commit message generation. */
const AI_MAX_DIFF_BYTES = 32_000;
const AI_MAX_FILE_LIST_BYTES = 4_000;

interface AssertSquashMergeTargetIsLocalArgs {
  selectedBranch: GitBranchRefClassification | null;
  targetBranch: string;
}

/**
 * Maps the daemon's typed `no_changes` failure (nothing to commit / nothing to
 * merge — e.g. a concurrent commit already captured the changes, or the branch
 * has no committed work) to a clean 409, instead of letting it surface as a
 * generic 502 git_command_failed.
 */
async function mapWorkspaceMutationTo409<TResult>(
  conflictMessage: string,
  run: () => Promise<TResult>,
): Promise<TResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "no_changes") {
      throw new ApiError(409, "no_changes", conflictMessage);
    }
    if (error instanceof ApiError && error.body.code === "stale_selection") {
      throw new ApiError(409, "stale_selection", error.body.message, {
        details: { kind: "commit_selection_stale" },
      });
    }
    throw error;
  }
}

async function mapPullRequestActionFailureTo409<TResult>(
  run: () => Promise<TResult>,
): Promise<TResult> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.body.code === "git_host_command_failed" ||
        error.body.code === "git_host_cli_unavailable" ||
        error.body.code === "invalid_request")
    ) {
      throw new ApiError(409, "pull_request_action_failed", error.body.message);
    }
    throw error;
  }
}

function assertSquashMergeTargetIsLocal({
  selectedBranch,
  targetBranch,
}: AssertSquashMergeTargetIsLocalArgs): void {
  if (selectedBranch?.kind === "local") {
    return;
  }

  if (selectedBranch?.kind === "remote") {
    throw new ApiError(
      409,
      "invalid_request",
      `Cannot squash merge into remote branch ${targetBranch}; select a local branch`,
    );
  }

  throw new ApiError(
    409,
    "invalid_request",
    `Target branch does not exist: ${targetBranch}`,
  );
}

function toWorkspaceDiffTarget(query: EnvironmentDiffQuery) {
  switch (query.target) {
    case "uncommitted":
      return { type: "uncommitted" as const };
    case "branch_committed":
      return {
        type: "branch_committed" as const,
        mergeBaseBranch: query.mergeBaseBranch,
      };
    case "all":
      return {
        type: "all" as const,
        mergeBaseBranch: query.mergeBaseBranch,
      };
    case "commit":
      return {
        type: "commit" as const,
        sha: query.sha,
      };
    default: {
      const _exhaustive: never = query;
      return _exhaustive;
    }
  }
}

function isWorktreeEnvironment(environment: Environment): boolean {
  return resolveEnvironmentWorkspaceDisplayKind({ environment }) !== "other";
}

/**
 * PR lookup for action preconditions (ready/draft/merge). Both "absent" and
 * "unavailable" resolve to `null` here: either way there is no PR the action
 * can operate on, and the action's own 409 carries the user-facing message.
 */
async function getPullRequestForWorkspaceTarget(
  deps: AppDeps,
  target: ReturnType<typeof requireWorkspaceCommandTarget>,
  githubAccountLogin: string | null,
): Promise<ThreadPullRequest | null> {
  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: target.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "workspace.pull_request",
      githubAccountLogin,
      environmentId: target.environmentId,
      workspaceContext: target.workspaceContext,
    },
  });
  return result.outcome === "available"
    ? assembleThreadPullRequest(result.pullRequest)
    : null;
}

function assertCanMarkPullRequestReady(
  pullRequest: ThreadPullRequest | null,
): void {
  if (!pullRequest) {
    throw new ApiError(
      409,
      "pull_request_unavailable",
      "No pull request found",
    );
  }
  if (pullRequest.state !== "draft") {
    throw new ApiError(409, "invalid_request", "Pull request is not a draft");
  }
}

function assertCanConvertPullRequestToDraft(
  pullRequest: ThreadPullRequest | null,
): void {
  if (!pullRequest) {
    throw new ApiError(
      409,
      "pull_request_unavailable",
      "No pull request found",
    );
  }
  if (pullRequest.state !== "open") {
    throw new ApiError(409, "invalid_request", "Pull request is not open");
  }
}

function assertCanMergePullRequest(
  pullRequest: ThreadPullRequest | null,
): void {
  if (!pullRequest) {
    throw new ApiError(
      409,
      "pull_request_unavailable",
      "No pull request found",
    );
  }
  if (
    pullRequest.state !== "open" ||
    pullRequest.mergeability.state !== "mergeable"
  ) {
    throw new ApiError(
      409,
      "pull_request_not_mergeable",
      "Pull request is not currently mergeable",
    );
  }
}

function assertCanRerunPullRequestChecks(
  pullRequest: ThreadPullRequest | null,
  target: { scope: "failed" } | { scope: "check"; checkName: string },
): void {
  if (!pullRequest) {
    throw new ApiError(
      409,
      "pull_request_unavailable",
      "No pull request found",
    );
  }
  const failedChecks = pullRequest.checks.items.filter(
    (check) =>
      check.status === "completed" &&
      check.conclusion !== null &&
      [
        "failure",
        "cancelled",
        "timed_out",
        "action_required",
        "startup_failure",
        "stale",
      ].includes(check.conclusion),
  );
  if (target.scope === "failed") {
    if (failedChecks.length === 0) {
      throw new ApiError(409, "invalid_request", "No failed checks found");
    }
    return;
  }
  if (!failedChecks.some((check) => check.name === target.checkName)) {
    throw new ApiError(
      409,
      "invalid_request",
      `Failed check not found: ${target.checkName}`,
    );
  }
}

/**
 * Pick the git ref to read for the requested side of a diff. Returns
 * `undefined` when the side should be read from the working tree (no ref —
 * `host.read_file` falls back to its disk-read path).
 *
 * Only `uncommitted` and `all` have a working-tree side; the others read
 * from refs on both sides. `branch_committed` and `all` use the merge-base
 * SHA the diff was computed against as their old side (passed in by the
 * client from `workspace.diff`'s response — reading from the branch tip
 * instead would diverge from the diff's hunk coordinates whenever the
 * branch has moved past the merge-base). `commit` uses the parent commit
 * (`<sha>^`); on a root commit that ref is missing, but the daemon's
 * `git cat-file` fallback already returns empty content for missing
 * objects, so we don't special-case the root-commit edge here.
 */
function resolveDiffFileRef(
  query: EnvironmentDiffFileQuery,
): string | undefined {
  switch (query.target) {
    case "uncommitted":
      return query.side === "old" ? "HEAD" : undefined;
    case "branch_committed":
      return query.side === "old" ? query.mergeBaseRef : "HEAD";
    case "all":
      return query.side === "old" ? query.mergeBaseRef : undefined;
    case "commit":
      return query.side === "old" ? `${query.sha}^` : query.sha;
    default: {
      const _exhaustive: never = query;
      return _exhaustive;
    }
  }
}

/** Shared `not_applicable` body for the diff routes on non-git environments. */
const NON_GIT_DIFF_NOT_APPLICABLE = {
  outcome: "not_applicable",
  reason: "non_git_environment",
  message: "Workspace diff is not available for non-git environments",
} as const;

/**
 * Resolve the workspace command target for a diff route, or `null` when the
 * environment is non-git (callers return {@link NON_GIT_DIFF_NOT_APPLICABLE}).
 */
function resolveGitDiffWorkspaceTarget(deps: AppDeps, environmentId: string) {
  const environment = requireReadyEnvironment(deps.db, environmentId);
  if (!environment.isGitRepo) {
    return null;
  }
  return requireWorkspaceCommandTarget(environment);
}

function simulatorSharedPortOwner(environmentId: string): string {
  return `core:simulator:${environmentId}`;
}

function previewSharedPortOwner(environmentId: string, port: number): string {
  return `core:preview:${environmentId}:${port}`;
}

function defaultDevServerPort(environmentId: string): number {
  let hash = 2166136261;
  for (const character of environmentId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 3000 + ((hash >>> 0) % 2000);
}

async function simulatorStreamConnection(
  deps: AppDeps,
  args: {
    environmentId: string;
    hostId: string;
    gatewayPort: number;
    token: string;
    expiresAt: number;
  },
) {
  try {
    deps.sharedPorts.declareSharedPorts({
      ownerId: simulatorSharedPortOwner(args.environmentId),
      hostId: args.hostId,
      ports: [args.gatewayPort],
    });
    const identity = await deps.sharedPorts.ensureTunnelIdentity(
      args.hostId,
      () =>
        callHostRetryableOnlineRpc(deps, {
          command: { type: "connect-tunnel.ensure-identity" },
          hostId: args.hostId,
          timeoutMs: 30_000,
        }),
    );
    return {
      url: `https://${identity.label}--${args.gatewayPort}.${identity.baseDomain}/stream.mjpeg`,
      token: args.token,
      expiresAt: args.expiresAt,
      transport: "tunnel" as const,
    };
  } catch {
    deps.sharedPorts.clearDeclarationsForOwner(
      simulatorSharedPortOwner(args.environmentId),
    );
    return {
      url: `http://127.0.0.1:${args.gatewayPort}/stream.mjpeg`,
      token: args.token,
      expiresAt: args.expiresAt,
      transport: "loopback" as const,
    };
  }
}

export function registerEnvironmentRoutes(app: Hono, deps: AppDeps): void {
  const { get, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.environments;

  get(routes.get, (context) =>
    context.json(requireEnvironment(deps.db, context.req.param("id"))),
  );

  post(routes.startDevServer, async (context, payload) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    const thread = requirePublicThread(deps.db, payload.threadId);
    if (thread.environmentId !== environment.id) {
      throw new ApiError(
        409,
        "invalid_request",
        "The thread does not use this environment",
      );
    }
    const target = requireWorkspaceCommandTarget(environment);
    const { port } = await callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.find_available_port",
        candidateCount: 20,
        environmentId: target.environmentId,
        preferredPort:
          payload.preferredPort ?? defaultDevServerPort(environment.id),
        workspaceContext: target.workspaceContext,
      },
    });
    return context.json(
      await deps.terminalSessions.createTerminal({
        payload: {
          cols: 120,
          devServerPort: port,
          restartPolicy: "until_stopped",
          rows: 32,
          start: {
            mode: "command",
            command: payload.command.replaceAll("{port}", String(port)),
          },
          target: { kind: "thread", threadId: thread.id },
          title: payload.title,
        },
      }),
      201,
    );
  });

  post(routes.dockerControl, async (context, payload) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    const target = requireWorkspaceCommandTarget(environment);
    return context.json(
      await callHostOnlineRpc(deps, {
        hostId: target.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "workspace.docker_control",
          action: payload.action,
          containerId: payload.containerId,
          environmentId: target.environmentId,
          workspaceContext: target.workspaceContext,
        },
      }),
    );
  });

  post(routes.sharePreviewPort, async (context, payload) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    const target = requireWorkspaceCommandTarget(environment);
    const ownerId = previewSharedPortOwner(environment.id, payload.port);
    deps.sharedPorts.declareSharedPorts({
      ownerId,
      hostId: target.hostId,
      ports: [payload.port],
    });
    try {
      const identity = await deps.sharedPorts.ensureTunnelIdentity(
        target.hostId,
        () =>
          callHostRetryableOnlineRpc(deps, {
            command: { type: "connect-tunnel.ensure-identity" },
            hostId: target.hostId,
            timeoutMs: 30_000,
          }),
      );
      return context.json({
        port: payload.port,
        url: `https://${identity.label}--${payload.port}.${identity.baseDomain}`,
      });
    } catch (error) {
      deps.sharedPorts.clearDeclarationsForOwner(ownerId);
      throw error;
    }
  });

  post(routes.unsharePreviewPort, async (context, payload) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    deps.sharedPorts.clearDeclarationsForOwner(
      previewSharedPortOwner(environment.id, payload.port),
    );
    return context.json({ port: payload.port, shared: false as const });
  });

  post(routes.bypassPreviewProtection, async (context, payload) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    const previews = await getEnvironmentPreviews(deps, {
      target: requireWorkspaceCommandTarget(environment),
    });
    const provider = previews.providers.find(
      (candidate) => candidate.id === payload.providerId,
    );
    if (provider?.source !== "github" || provider.url === null) {
      throw new ApiError(
        409,
        "invalid_request",
        "This preview does not support Vercel protection bypass",
      );
    }
    const url = buildVercelProtectionBypassUrl(provider.url, payload.secret);
    if (url === null) {
      throw new ApiError(
        409,
        "invalid_request",
        "This preview is not hosted by Vercel",
      );
    }
    return context.json({ url });
  });

  get(routes.simulatorStatus, async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    return context.json(
      await callHostRetryableOnlineRpc(deps, {
        hostId: environment.hostId,
        timeoutMs: SIMULATOR_RPC_TIMEOUT_MS,
        command: {
          type: "simulator.status",
          environmentId: environment.id,
        },
      }),
    );
  });

  post(routes.simulatorAttach, async (context, payload) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    const status = await callHostRetryableOnlineRpc(deps, {
      hostId: environment.hostId,
      timeoutMs: SIMULATOR_RPC_TIMEOUT_MS,
      command: { type: "simulator.status", environmentId: environment.id },
    });
    if (!status.supported) {
      throw new ApiError(
        409,
        "simulator_unsupported",
        status.message ?? "iOS Simulator is unavailable on this host.",
      );
    }
    const deviceUdid = payload.deviceUdid ?? status.devices[0]?.udid;
    if (!deviceUdid) {
      throw new ApiError(
        409,
        "simulator_device_not_found",
        status.message ?? "No iOS Simulator runtimes are installed.",
      );
    }
    const result = await callHostOnlineRpc(deps, {
      hostId: environment.hostId,
      timeoutMs: SIMULATOR_RPC_TIMEOUT_MS,
      command: {
        type: "simulator.attach",
        environmentId: environment.id,
        deviceUdid,
      },
    });
    return context.json({
      session: result.session,
      stream: await simulatorStreamConnection(deps, {
        environmentId: environment.id,
        hostId: environment.hostId,
        ...result.lease,
      }),
    });
  });

  post(routes.simulatorLease, async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    const lease = await callHostOnlineRpc(deps, {
      hostId: environment.hostId,
      timeoutMs: SIMULATOR_RPC_TIMEOUT_MS,
      command: { type: "simulator.lease", environmentId: environment.id },
    });
    return context.json(
      await simulatorStreamConnection(deps, {
        environmentId: environment.id,
        hostId: environment.hostId,
        ...lease,
      }),
    );
  });

  post(routes.simulatorControl, async (context, payload) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    return context.json(
      await callHostOnlineRpc(deps, {
        hostId: environment.hostId,
        timeoutMs: SIMULATOR_RPC_TIMEOUT_MS,
        command: {
          type: "simulator.control",
          environmentId: environment.id,
          action: payload.action,
        },
      }),
    );
  });

  post(routes.simulatorStop, async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    const result = await callHostOnlineRpc(deps, {
      hostId: environment.hostId,
      timeoutMs: SIMULATOR_RPC_TIMEOUT_MS,
      command: { type: "simulator.stop", environmentId: environment.id },
    });
    deps.sharedPorts.clearDeclarationsForOwner(
      simulatorSharedPortOwner(environment.id),
    );
    return context.json(result);
  });

  get(routes.simulatorAccessibility, async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    return context.json(
      await callHostRetryableOnlineRpc(deps, {
        hostId: environment.hostId,
        timeoutMs: SIMULATOR_RPC_TIMEOUT_MS,
        command: {
          type: "simulator.accessibility",
          environmentId: environment.id,
        },
      }),
    );
  });

  get(routes.simulatorScreenshot, async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    return context.json(
      await callHostRetryableOnlineRpc(deps, {
        hostId: environment.hostId,
        timeoutMs: SIMULATOR_RPC_TIMEOUT_MS,
        command: {
          type: "simulator.screenshot",
          environmentId: environment.id,
        },
      }),
    );
  });

  patch(routes.update, async (context, payload) => {
    const environment = requireEnvironment(deps.db, context.req.param("id"));
    let metadata = payload;
    if (
      payload.githubAccountLogin !== undefined &&
      payload.githubAccountLogin !== null
    ) {
      const catalog = await getGithubAccounts(deps, {
        hostId: environment.hostId,
      });
      const account = catalog.accounts.find(
        (candidate) =>
          candidate.login.toLocaleLowerCase() ===
          payload.githubAccountLogin?.toLocaleLowerCase(),
      );
      if (!account) {
        throw new ApiError(
          400,
          "invalid_request",
          `GitHub account @${payload.githubAccountLogin} is not authenticated on this machine`,
        );
      }
      metadata = { ...payload, githubAccountLogin: account.login };
    }
    const updated = updateEnvironmentMetadata(
      deps.db,
      deps.hub,
      environment.id,
      metadata,
    );
    if (!updated) {
      throw new ApiError(404, "environment_not_found", "Environment not found");
    }
    return context.json(updated);
  });

  post(routes.rename, async (context, payload) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    if (!isWorktreeEnvironment(environment) || !environment.isGitRepo) {
      throw new ApiError(
        409,
        "invalid_request",
        "Only Git worktree environments can be renamed",
      );
    }
    const target = requireWorkspaceCommandTarget(environment);
    let result;
    try {
      result = await runLiveCommandAndWait(deps, {
        hostId: target.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "workspace.rename",
          environmentId: target.environmentId,
          workspaceContext: target.workspaceContext,
          target: payload.target,
          value: payload.value,
        },
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        ["environment_busy", "detached_head", "git_command_failed"].includes(
          error.body.code,
        )
      ) {
        throw new ApiError(409, error.body.code, error.body.message);
      }
      throw error;
    }
    const updated = recordEnvironmentWorkspaceRename(
      deps.db,
      deps.hub,
      environment.id,
      result.target === "branch"
        ? { target: "branch", branchName: result.branchName }
        : { target: "folder", path: result.path },
    );
    if (!updated) {
      throw new ApiError(404, "environment_not_found", "Environment not found");
    }
    return context.json(updated);
  });

  post(routes.archiveThreads, (context) => {
    const environment = requireEnvironment(deps.db, context.req.param("id"));
    const archivedThreadIds = archiveEnvironmentThreads(deps, { environment });
    return context.json({
      ok: true,
      archivedThreadIds,
    });
  });

  get(routes.status, async (context, query) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    if (!environment.isGitRepo) {
      return context.json({
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "Workspace status is not available for non-git environments",
      });
    }
    const target = requireWorkspaceCommandTarget(environment);
    const result = await callEnvironmentWorkspaceStatus(deps, {
      environment,
      target,
      ...(query.mergeBaseBranch
        ? { mergeBaseBranch: query.mergeBaseBranch }
        : {}),
    });
    if (result.outcome === "unavailable") {
      return context.json({
        outcome: "unavailable",
        failure: result.failure,
      });
    }
    return context.json({
      outcome: "available",
      workspace: result.workspaceStatus,
    });
  });

  get(routes.dockerProvenance, async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    const target = requireWorkspaceCommandTarget(environment);
    return context.json(await getEnvironmentDockerProvenance(deps, { target }));
  });

  get(routes.dockerActivity, async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    const target = requireWorkspaceCommandTarget(environment);
    return context.json(await getEnvironmentDockerActivity(deps, { target }));
  });

  get(routes.previews, async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    const target = requireWorkspaceCommandTarget(environment);
    return context.json(await getEnvironmentPreviews(deps, { target }));
  });

  get(routes.pullRequest, async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    // A non-git environment has no branch and therefore no PR; skip the daemon.
    if (!environment.isGitRepo) {
      return context.json({ outcome: "absent" });
    }
    const target = requireWorkspaceCommandTarget(environment);
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.pull_request",
        githubAccountLogin: environment.githubAccountLogin,
        environmentId: target.environmentId,
        workspaceContext: target.workspaceContext,
      },
    });
    if (result.outcome === "available") {
      return context.json({
        outcome: "available",
        pullRequest: assembleThreadPullRequest(result.pullRequest),
      });
    }
    if (result.outcome === "unavailable") {
      return context.json({ outcome: "unavailable", message: result.message });
    }
    return context.json({ outcome: "absent" });
  });

  get(routes.diff, async (context, query) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    if (!environment.isGitRepo) {
      return context.json({
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "Workspace diff is not available for non-git environments",
      });
    }
    const target = requireWorkspaceCommandTarget(environment);
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.diff",
        environmentId: target.environmentId,
        workspaceContext: target.workspaceContext,
        target: toWorkspaceDiffTarget(query),
        maxDiffBytes: WORKSPACE_DIFF_MAX_DIFF_BYTES,
        maxFileListBytes: WORKSPACE_DIFF_MAX_FILE_LIST_BYTES,
        maxUntrackedFiles: WORKSPACE_DIFF_MAX_FILES,
      },
    });
    if (result.outcome === "unavailable") {
      return context.json({
        outcome: "unavailable",
        failure: result.failure,
      });
    }
    return context.json({
      outcome: "available",
      diff: result.diff,
    });
  });

  get(routes.diffFiles, async (context, query) => {
    const target = resolveGitDiffWorkspaceTarget(deps, context.req.param("id"));
    if (target === null) {
      return context.json(NON_GIT_DIFF_NOT_APPLICABLE);
    }
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.diffFiles",
        environmentId: target.environmentId,
        workspaceContext: target.workspaceContext,
        target: toWorkspaceDiffTarget(query),
        maxFiles: WORKSPACE_DIFF_MAX_FILES,
      },
    });
    if (result.outcome === "unavailable") {
      return context.json({
        outcome: "unavailable",
        failure: result.failure,
      });
    }
    const files = result.files.map(rawDiffFileStatToEntry);
    // Ship a small diff's `auto`-tier patches with the TOC so initial content
    // paints in one round-trip (empty for large diffs — see
    // selectInitialPatchPaths). A failed/unavailable patch fetch degrades to an
    // empty list; the client then loads the first screen on demand.
    const initialPatchPaths = selectInitialPatchPaths(files);
    let initialPatches: DiffPatchEntry[] = [];
    if (initialPatchPaths.length > 0) {
      const patchResult = await callHostRetryableOnlineRpc(deps, {
        hostId: target.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "workspace.diffPatch",
          environmentId: target.environmentId,
          workspaceContext: target.workspaceContext,
          target: toWorkspaceDiffTarget(query),
          paths: initialPatchPaths,
          maxBytesPerFile: DIFF_FILE_PATCH_MAX_BYTES,
        },
      });
      if (patchResult.outcome === "available") {
        initialPatches = patchResult.patches;
      }
    }
    return context.json({
      outcome: "available",
      files,
      shortstat: result.shortstat,
      mergeBaseRef: result.mergeBaseRef,
      initialPatches,
      truncated: result.truncated,
    });
  });

  post(routes.diffPatch, async (context, payload) => {
    const target = resolveGitDiffWorkspaceTarget(deps, context.req.param("id"));
    if (target === null) {
      return context.json(NON_GIT_DIFF_NOT_APPLICABLE);
    }
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.diffPatch",
        environmentId: target.environmentId,
        workspaceContext: target.workspaceContext,
        target: payload.target,
        paths: payload.paths,
        maxBytesPerFile: DIFF_FILE_PATCH_MAX_BYTES,
      },
    });
    if (result.outcome === "unavailable") {
      return context.json({
        outcome: "unavailable",
        failure: result.failure,
      });
    }
    return context.json({
      outcome: "available",
      patches: result.patches,
    });
  });

  get(routes.diffFile, async (context, query) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    const repoRelativePath = query.path.replace(/^\/+/u, "");
    if (
      repoRelativePath.length === 0 ||
      repoRelativePath.split("/").includes("..")
    ) {
      throw new ApiError(400, "invalid_request", "Invalid path");
    }
    const absolutePath = path.join(environment.path, repoRelativePath);
    const ref = resolveDiffFileRef(query);
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: environment.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.read_file",
        path: absolutePath,
        rootPath: environment.path,
        ...(ref !== undefined ? { ref } : {}),
      },
    });
    return context.json({
      path: result.path,
      content: result.content,
      contentEncoding: result.contentEncoding,
      ...(result.mimeType ? { mimeType: result.mimeType } : {}),
      sizeBytes: result.sizeBytes,
    });
  });

  get(routes.diffBranches, async (context, query) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    const branchQuery = normalizeBranchQuery(query.query);
    const selectedBranch = normalizeBranchQuery(query.selectedBranch);
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: environment.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.list_branches",
        path: environment.path,
        ...(branchQuery ? { query: branchQuery } : {}),
        ...(selectedBranch ? { selectedBranch } : {}),
        limit: parseBranchListLimit(query.limit),
      },
    });
    return context.json({
      branches: result.branches,
      branchesTruncated: result.branchesTruncated,
      remoteBranches: result.remoteBranches,
      remoteBranchesTruncated: result.remoteBranchesTruncated,
      selectedBranch: result.selectedBranch,
    });
  });

  get(routes.paths, async (context, query) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    const limit = parseFileListLimit(query.limit);
    const inclusion = parsePathKindInclusion({
      includeFiles: query.includeFiles,
      includeDirectories: query.includeDirectories,
    });

    try {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId: environment.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.list_paths",
          path: environment.path,
          ...(query.query ? { query: query.query } : {}),
          limit,
          includeFiles: inclusion.includeFiles,
          includeDirectories: inclusion.includeDirectories,
        },
      });
      return context.json({
        paths: result.paths,
        truncated: result.truncated,
      });
    } catch (error) {
      if (error instanceof ApiError && error.body.code === "ENOENT") {
        return context.json({ paths: [], truncated: false });
      }
      throw error;
    }
  });

  post(routes.actions, async (context, payload) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );

    switch (payload.action) {
      case "commit": {
        const target = requireWorkspaceCommandTarget(environment);
        const { workspaceContext } = target;
        const selectedPaths = payload.options?.paths;

        const [statusResult, diffResult] = await Promise.all([
          callEnvironmentWorkspaceStatus(deps, {
            environment,
            target,
          }),
          callHostRetryableOnlineRpc(deps, {
            hostId: target.hostId,
            timeoutMs: COMMAND_TIMEOUT_MS,
            command: {
              type: "workspace.diff",
              environmentId: target.environmentId,
              workspaceContext,
              target: { type: "uncommitted" },
              paths: selectedPaths,
              maxDiffBytes: AI_MAX_DIFF_BYTES,
              maxFileListBytes: AI_MAX_FILE_LIST_BYTES,
              maxUntrackedFiles: WORKSPACE_DIFF_MAX_FILES,
            },
          }),
        ]);
        const workspaceStatus = requireAvailableWorkspaceStatus(statusResult);
        const workspaceDiff = requireAvailableWorkspaceDiff(diffResult);
        if (!workspaceStatus.workingTree.hasUncommittedChanges) {
          throw new ApiError(
            409,
            "no_changes",
            "No uncommitted changes to commit",
          );
        }

        const aiMessage = await generateCommitMessage(deps, {
          diffDescription: "uncommitted changes",
          shortstat: workspaceDiff.shortstat,
          files: workspaceDiff.files,
          patch: workspaceDiff.diff,
        });
        const commitMessage = aiMessage ?? COMMIT_FALLBACK_MESSAGE;

        const result = await mapWorkspaceMutationTo409(
          "No uncommitted changes to commit",
          () =>
            runLiveCommandAndWait(deps, {
              hostId: target.hostId,
              timeoutMs: COMMAND_TIMEOUT_MS,
              command: {
                type: "workspace.commit",
                environmentId: target.environmentId,
                workspaceContext,
                message: commitMessage,
                paths: selectedPaths,
              },
            }),
        );
        return context.json({
          ok: true,
          action: "commit",
          message: `Created commit ${result.commitSha}`,
          commitSha: result.commitSha,
          commitSubject: result.commitSubject,
        });
      }
      case "squash_merge": {
        const target = requireWorkspaceCommandTarget(environment);
        const { workspaceContext } = target;
        const targetBranch = payload.options.mergeBaseBranch;

        const statusResult = await callEnvironmentWorkspaceStatus(deps, {
          environment,
          target,
        });
        const workspaceStatus = requireAvailableWorkspaceStatus(statusResult);

        const currentBranch = workspaceStatus.branch.currentBranch;
        if (!currentBranch) {
          throw new ApiError(
            409,
            "invalid_request",
            "Cannot squash merge from a detached workspace",
          );
        }

        if (workspaceStatus.workingTree.hasUncommittedChanges) {
          throw new ApiError(
            409,
            "dirty_worktree",
            "Commit changes in this worktree before squash merging",
            { details: { kind: "squash_merge_dirty_worktree" } },
          );
        }

        const targetBranchResult = await callHostRetryableOnlineRpc(deps, {
          hostId: environment.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "host.list_branches",
            path: environment.path,
            selectedBranch: targetBranch,
            limit: 1,
          },
        });
        assertSquashMergeTargetIsLocal({
          selectedBranch: targetBranchResult.selectedBranch,
          targetBranch,
        });

        const diffResult = await callHostRetryableOnlineRpc(deps, {
          hostId: target.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "workspace.diff",
            environmentId: target.environmentId,
            workspaceContext,
            target: {
              type: "branch_committed",
              mergeBaseBranch: targetBranch,
            },
            maxDiffBytes: AI_MAX_DIFF_BYTES,
            maxFileListBytes: AI_MAX_FILE_LIST_BYTES,
            maxUntrackedFiles: WORKSPACE_DIFF_MAX_FILES,
          },
        });
        const workspaceDiff = requireAvailableWorkspaceDiff(diffResult);

        const aiMessage = await generateCommitMessage(deps, {
          diffDescription: `squash merge of ${currentBranch} into ${targetBranch}`,
          shortstat: workspaceDiff.shortstat,
          files: workspaceDiff.files,
          patch: workspaceDiff.diff,
        });
        const commitMessage = aiMessage ?? SQUASH_MERGE_FALLBACK_MESSAGE;

        const result = await mapWorkspaceMutationTo409(
          `No changes to merge into ${targetBranch}`,
          () =>
            runLiveCommandAndWait(deps, {
              hostId: target.hostId,
              timeoutMs: COMMAND_TIMEOUT_MS,
              command: {
                type: "workspace.squash_merge",
                environmentId: target.environmentId,
                workspaceContext,
                targetBranch,
                commitMessage,
              },
            }),
        );
        return context.json({
          ok: true,
          action: "squash_merge",
          merged: result.merged,
          message: "Squash merge completed",
          commitSha: result.commitSha,
          commitSubject: result.commitSubject,
        });
      }
      case "publish_to_main": {
        if (
          !environment.isGitRepo ||
          environment.workspaceProvisionType !== "managed-worktree"
        ) {
          throw new ApiError(
            409,
            "invalid_request",
            "Publishing to main requires a managed Git worktree",
          );
        }

        const target = requireWorkspaceCommandTarget(environment);
        const result = await runLiveCommandAndWait(deps, {
          hostId: target.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "workspace.publish_committed_branch",
            environmentId: target.environmentId,
            workspaceContext: target.workspaceContext,
            targetBranch: "main",
            preserveTargetChanges: payload.options.preserveTargetChanges,
          },
        });

        if (result.outcome === "blocked") {
          throw new ApiError(
            409,
            "publish_to_main_blocked",
            `Cannot publish to main: ${result.reason.replaceAll("_", " ")}`,
            {
              details: {
                kind: "publish_to_main_blocked",
                reason: result.reason,
                sourceBranch: result.sourceBranch,
                targetBranch: "main",
                sourceCommitSha: result.sourceCommitSha,
                remoteTargetSha: result.remoteTargetSha,
                localTargetSha: result.localTargetSha,
                conflictFiles: result.conflictFiles,
              },
            },
          );
        }

        return context.json({
          ok: true,
          action: "publish_to_main",
          message: "Published branch to main and synchronized the local Vault",
          sourceBranch: result.sourceBranch,
          targetBranch: "main",
          sourceCommitSha: result.sourceCommitSha,
          remoteTargetBeforeSha: result.remoteTargetBeforeSha,
          remoteTargetAfterSha: result.remoteTargetAfterSha,
          localTargetBeforeSha: result.localTargetBeforeSha,
          localTargetAfterSha: result.localTargetAfterSha,
          preservedTargetChangesCommitSha:
            result.preservedTargetChangesCommitSha,
        });
      }
      case "update_from_main": {
        if (!environment.isGitRepo || !environment.isWorktree) {
          throw new ApiError(
            409,
            "invalid_request",
            "Updating from main requires a Git worktree",
          );
        }

        if (
          hasBusyThreadInEnvironment(deps.db, {
            environmentId: environment.id,
          })
        ) {
          throw new ApiError(
            409,
            "environment_busy",
            "Stop active conversations in this workspace before updating from main",
            {
              details: {
                kind: "workspace_busy",
                action: "update_from_main",
                reason: "active_threads",
              },
            },
          );
        }

        const target = requireWorkspaceCommandTarget(environment);
        const result = await runLiveCommandAndWait(deps, {
          hostId: target.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "workspace.update_from_target",
            environmentId: target.environmentId,
            workspaceContext: target.workspaceContext,
            targetBranch: "main",
          },
        });

        if (result.outcome === "blocked") {
          throw new ApiError(
            409,
            "update_from_main_blocked",
            `Cannot update from main: ${result.reason.replaceAll("_", " ")}`,
            {
              details: {
                kind: "update_from_main_blocked",
                reason: result.reason,
                sourceBranch: result.sourceBranch,
                targetBranch: "main",
                previousSha: result.previousSha,
                targetSha: result.targetSha,
                conflictFiles: result.conflictFiles,
              },
            },
          );
        }

        return context.json({
          ok: true,
          action: "update_from_main",
          message:
            result.outcome === "already_current"
              ? "Workspace already includes the latest main changes"
              : "Rebased workspace onto the latest main changes",
          outcome: result.outcome,
          sourceBranch: result.sourceBranch,
          targetBranch: "main",
          previousSha: result.previousSha,
          currentSha: result.currentSha,
          targetSha: result.targetSha,
          rebasedCommitCount: result.rebasedCommitCount,
        });
      }
      case "pull_request_ready": {
        if (!environment.isGitRepo) {
          throw new ApiError(
            409,
            "invalid_request",
            "Pull request actions require a git environment",
          );
        }
        const target = requireWorkspaceCommandTarget(environment);
        const pullRequest = await getPullRequestForWorkspaceTarget(
          deps,
          target,
          environment.githubAccountLogin,
        );
        assertCanMarkPullRequestReady(pullRequest);

        await mapPullRequestActionFailureTo409(() =>
          runLiveCommandAndWait(deps, {
            hostId: target.hostId,
            timeoutMs: COMMAND_TIMEOUT_MS,
            command: {
              type: "workspace.pull_request_action",
              githubAccountLogin: environment.githubAccountLogin,
              operation: "ready",
              environmentId: target.environmentId,
              workspaceContext: target.workspaceContext,
            },
          }),
        );
        return context.json({
          ok: true,
          action: "pull_request_ready",
          message: "Pull request marked ready",
        });
      }
      case "pull_request_metadata": {
        if (!environment.isGitRepo) {
          throw new ApiError(
            409,
            "invalid_request",
            "Pull request metadata requires a git environment",
          );
        }
        const target = requireWorkspaceCommandTarget(environment);
        const diffResult = await callHostRetryableOnlineRpc(deps, {
          hostId: target.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "workspace.diff",
            environmentId: target.environmentId,
            workspaceContext: target.workspaceContext,
            target: {
              type: "branch_committed",
              mergeBaseBranch: payload.options.baseBranch,
            },
            maxDiffBytes: AI_MAX_DIFF_BYTES,
            maxFileListBytes: AI_MAX_FILE_LIST_BYTES,
          },
        });
        const workspaceDiff = requireAvailableWorkspaceDiff(diffResult);
        const metadata = await generatePullRequestMetadata(deps, {
          baseBranch: payload.options.baseBranch,
          fallbackTitle: payload.options.fallbackTitle,
          shortstat: workspaceDiff.shortstat,
          files: workspaceDiff.files,
          patch: workspaceDiff.diff,
        });
        return context.json({
          ok: true,
          action: "pull_request_metadata",
          title: metadata?.title ?? payload.options.fallbackTitle,
          body: metadata?.body ?? "",
          generated: metadata !== null,
        });
      }
      case "pull_request_create": {
        if (!environment.isGitRepo) {
          throw new ApiError(
            409,
            "invalid_request",
            "Pull request creation requires a git environment",
          );
        }
        const target = requireWorkspaceCommandTarget(environment);
        const existingPullRequest = await getPullRequestForWorkspaceTarget(
          deps,
          target,
          environment.githubAccountLogin,
        );
        if (existingPullRequest) {
          throw new ApiError(
            409,
            "invalid_request",
            `Pull request #${existingPullRequest.number} already exists for this branch`,
          );
        }

        const result = await mapPullRequestActionFailureTo409(() =>
          runLiveCommandAndWait(deps, {
            hostId: target.hostId,
            timeoutMs: PULL_REQUEST_CREATE_TIMEOUT_MS,
            command: {
              type: "workspace.pull_request_create",
              githubAccountLogin: environment.githubAccountLogin,
              environmentId: target.environmentId,
              workspaceContext: target.workspaceContext,
              baseBranch: payload.options.baseBranch,
              body: payload.options.body,
              draft: payload.options.draft,
              title: payload.options.title,
            },
          }),
        );
        const pullRequest = assembleThreadPullRequest(result.pullRequest);
        return context.json({
          ok: true,
          action: "pull_request_create",
          message: `Pull request #${pullRequest.number} created`,
          pullRequest,
        });
      }
      case "pull_request_draft": {
        if (!environment.isGitRepo) {
          throw new ApiError(
            409,
            "invalid_request",
            "Pull request actions require a git environment",
          );
        }
        const target = requireWorkspaceCommandTarget(environment);
        const pullRequest = await getPullRequestForWorkspaceTarget(
          deps,
          target,
          environment.githubAccountLogin,
        );
        assertCanConvertPullRequestToDraft(pullRequest);

        await mapPullRequestActionFailureTo409(() =>
          runLiveCommandAndWait(deps, {
            hostId: target.hostId,
            timeoutMs: COMMAND_TIMEOUT_MS,
            command: {
              type: "workspace.pull_request_action",
              githubAccountLogin: environment.githubAccountLogin,
              operation: "draft",
              environmentId: target.environmentId,
              workspaceContext: target.workspaceContext,
            },
          }),
        );
        return context.json({
          ok: true,
          action: "pull_request_draft",
          message: "Pull request converted to draft",
        });
      }
      case "pull_request_merge": {
        if (!environment.isGitRepo) {
          throw new ApiError(
            409,
            "invalid_request",
            "Pull request actions require a git environment",
          );
        }
        const target = requireWorkspaceCommandTarget(environment);
        const pullRequest = await getPullRequestForWorkspaceTarget(
          deps,
          target,
          environment.githubAccountLogin,
        );
        assertCanMergePullRequest(pullRequest);

        await mapPullRequestActionFailureTo409(() =>
          runLiveCommandAndWait(deps, {
            hostId: target.hostId,
            timeoutMs: COMMAND_TIMEOUT_MS,
            command: {
              type: "workspace.pull_request_action",
              githubAccountLogin: environment.githubAccountLogin,
              operation: "merge",
              method: payload.options.method,
              environmentId: target.environmentId,
              workspaceContext: target.workspaceContext,
            },
          }),
        );
        return context.json({
          ok: true,
          action: "pull_request_merge",
          method: payload.options.method,
          message: "Pull request merge started",
        });
      }
      case "pull_request_checks_rerun": {
        if (!environment.isGitRepo) {
          throw new ApiError(
            409,
            "invalid_request",
            "Pull request checks require a git environment",
          );
        }
        const target = requireWorkspaceCommandTarget(environment);
        const pullRequest = await getPullRequestForWorkspaceTarget(
          deps,
          target,
          environment.githubAccountLogin,
        );
        assertCanRerunPullRequestChecks(pullRequest, payload.options);
        const result = await mapPullRequestActionFailureTo409(() =>
          runLiveCommandAndWait(deps, {
            hostId: target.hostId,
            timeoutMs: COMMAND_TIMEOUT_MS,
            command: {
              type: "workspace.pull_request_checks_rerun",
              githubAccountLogin: environment.githubAccountLogin,
              target: payload.options,
              environmentId: target.environmentId,
              workspaceContext: target.workspaceContext,
            },
          }),
        );
        return context.json({
          ok: true,
          action: "pull_request_checks_rerun",
          message:
            payload.options.scope === "failed"
              ? "Failed checks queued to re-run"
              : `${payload.options.checkName} queued to re-run`,
          rerunCount: result.rerunCount,
        });
      }
      default: {
        const _exhaustive: never = payload;
        throw new Error(`Unhandled environment action: ${_exhaustive}`);
      }
    }
  });
}
