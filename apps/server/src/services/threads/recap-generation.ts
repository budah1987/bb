import { getEnvironment } from "@bb/db";
import type { Environment, Thread, ThreadPullRequest } from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import { THREAD_RECAP_MAX_LENGTH } from "@bb/server-contract";
import { Type } from "@earendil-works/pi-ai";
import {
  WORKSPACE_STATUS_MAX_UNTRACKED_LINE_STAT_BYTES,
  WORKSPACE_STATUS_MAX_UNTRACKED_LINE_STAT_FILES,
} from "../../constants.js";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { InferenceTimeoutError, inferenceComplete } from "../ai/inference.js";
import { assembleThreadPullRequest } from "../environments/pull-request.js";
import { requireWorkspaceCommandTarget } from "../environments/workspace-command-target.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { buildThreadConversationOutline } from "./timeline.js";

/**
 * Matches the managed thread-metadata budget: a recap is a helper generation
 * the user is waiting on, so it is better to fail fast twice than to hold a
 * request open. Two attempts because the first token of a cold model is the
 * usual cause of a timeout, not the request itself.
 */
export const RECAP_INFERENCE_TIMEOUT_MS = 2_500;
export const RECAP_INFERENCE_MAX_ATTEMPTS = 2;

/**
 * The workspace and pull-request lookups are host round trips, so they get
 * their own budget separate from inference. Exceeding it drops the fact from
 * the prompt rather than failing the recap: a conversation-only recap is worse
 * than a complete one but much better than none.
 */
const RECAP_WORKSPACE_STATE_TIMEOUT_MS = 2_000;

/**
 * How much of the conversation the recap sees. The recap answers "where does
 * this stand", which the tail of the conversation determines; older turns cost
 * tokens and pull the model towards narrating history.
 */
const RECAP_OUTLINE_TURN_COUNT = 5;

type ThreadRecapDeps = Pick<AppDeps, "db"> & LoggedWorkSessionDeps;

export interface ThreadRecapGenerationArgs {
  maxSeq: number;
  thread: Thread;
}

export type ThreadRecapGenerationReason =
  | "empty-conversation"
  | "failed"
  | "inference-unavailable"
  | "timeout";

export interface ThreadRecapGenerationOutcome {
  durationMs: number;
  reason?: ThreadRecapGenerationReason;
  recap: string | null;
}

interface ThreadRecapWorkspaceState {
  branch: string | null;
  pullRequest: ThreadPullRequest | null;
  uncommittedFileCount: number | null;
}

const recapSchema = Type.Object({
  recap: Type.String(),
});

/**
 * Collapses the model's prose to a single line and enforces the storage cap.
 * The prompt asks for one paragraph; a model that answers with headings or
 * bullets still produces something storable rather than something rejected.
 */
export function sanitizeGeneratedRecap(value: string): string | null {
  const recap = value
    .replace(/\s+/gu, " ")
    .replace(/^[-*#>\s]+/u, "")
    .trim();
  if (recap.length === 0) {
    return null;
  }
  return recap.length <= THREAD_RECAP_MAX_LENGTH
    ? recap
    : `${recap.slice(0, THREAD_RECAP_MAX_LENGTH - 3).trimEnd()}...`;
}

/**
 * Runs a best-effort host lookup under a hard deadline. The underlying promise
 * is left with a rejection handler attached so a late failure cannot surface as
 * an unhandled rejection after we have already given up on it.
 */
async function withStateBudget<T>(
  deps: Pick<AppDeps, "logger">,
  label: string,
  run: () => Promise<T>,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending = run().catch((error: unknown) => {
    deps.logger.debug(
      { err: error, label },
      "Recap workspace state lookup failed",
    );
    return null;
  });
  try {
    return await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(
          () => resolve(null),
          RECAP_WORKSPACE_STATE_TIMEOUT_MS,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function collectThreadRecapWorkspaceState(
  deps: ThreadRecapDeps,
  thread: Thread,
): Promise<ThreadRecapWorkspaceState> {
  const environment: Environment | null = thread.environmentId
    ? getEnvironment(deps.db, thread.environmentId)
    : null;
  // The recorded branch is a plain column read and is the one fact worth
  // having even when the host is offline.
  const branch = environment?.branchName ?? null;
  if (
    !environment ||
    !environment.isGitRepo ||
    environment.status !== "ready"
  ) {
    return { branch, pullRequest: null, uncommittedFileCount: null };
  }

  let target;
  try {
    target = requireWorkspaceCommandTarget(environment);
  } catch {
    return { branch, pullRequest: null, uncommittedFileCount: null };
  }

  const [status, pullRequest] = await Promise.all([
    withStateBudget(deps, "workspace.status", async () =>
      callHostOnlineRpc(deps, {
        hostId: target.hostId,
        timeoutMs: RECAP_WORKSPACE_STATE_TIMEOUT_MS,
        command: {
          type: "workspace.status",
          environmentId: target.environmentId,
          workspaceContext: target.workspaceContext,
          maxUntrackedLineStatFiles:
            WORKSPACE_STATUS_MAX_UNTRACKED_LINE_STAT_FILES,
          maxUntrackedLineStatBytes:
            WORKSPACE_STATUS_MAX_UNTRACKED_LINE_STAT_BYTES,
        },
      }),
    ),
    withStateBudget(deps, "workspace.pull_request", async () =>
      callHostOnlineRpc(deps, {
        hostId: target.hostId,
        timeoutMs: RECAP_WORKSPACE_STATE_TIMEOUT_MS,
        command: {
          type: "workspace.pull_request",
          githubAccountLogin: environment.githubAccountLogin,
          environmentId: target.environmentId,
          workspaceContext: target.workspaceContext,
        },
      }),
    ),
  ]);

  return {
    branch:
      status?.outcome === "available"
        ? (status.workspaceStatus.branch.currentBranch ?? branch)
        : branch,
    pullRequest:
      pullRequest?.outcome === "available"
        ? assembleThreadPullRequest(pullRequest.pullRequest)
        : null,
    uncommittedFileCount:
      status?.outcome === "available"
        ? status.workspaceStatus.workingTree.files.length
        : null,
  };
}

function formatPullRequestState(pullRequest: ThreadPullRequest): string {
  const attention = pullRequest.attention.replace(/_/gu, " ");
  return attention === "none"
    ? `#${pullRequest.number} ${pullRequest.state}`
    : `#${pullRequest.number} ${pullRequest.state}, ${attention}`;
}

export function formatThreadRecapWorkspaceState(
  state: ThreadRecapWorkspaceState,
): string {
  const lines: string[] = [];
  if (state.branch) {
    lines.push(`Branch: ${state.branch}`);
  }
  if (state.uncommittedFileCount !== null) {
    lines.push(
      state.uncommittedFileCount === 0
        ? "Uncommitted changes: none, the worktree is clean"
        : `Uncommitted changes: ${state.uncommittedFileCount} file(s)`,
    );
  }
  if (state.pullRequest) {
    lines.push(`Pull request: ${formatPullRequestState(state.pullRequest)}`);
  }
  return lines.length > 0 ? lines.join("\n") : "Not available.";
}

function formatRecentTurns(
  items: readonly { preview: string; role: "assistant" | "user" }[],
): string {
  return items
    .map(
      (item) => `${item.role === "user" ? "User" : "Agent"}: ${item.preview}`,
    )
    .join("\n");
}

/**
 * Generates a recap from the tail of the conversation plus the thread's live
 * workspace state. Never throws for an expected failure: the caller decides
 * what an absent recap means, and the stored recap is only replaced on success.
 */
export async function generateThreadRecap(
  deps: ThreadRecapDeps,
  args: ThreadRecapGenerationArgs,
): Promise<ThreadRecapGenerationOutcome> {
  const startedAt = Date.now();
  const complete = (
    recap: string | null,
    reason?: ThreadRecapGenerationReason,
  ): ThreadRecapGenerationOutcome => ({
    durationMs: Date.now() - startedAt,
    recap,
    ...(reason ? { reason } : {}),
  });

  // Reprojects the thread to reach its conversation rows. This is the same
  // build the conversation-outline route performs; it is bounded by the
  // thread's own event count and only runs on an explicit recap request.
  const outline = buildThreadConversationOutline(deps.db, args.thread, {
    maxSeq: args.maxSeq,
  });
  const recentTurns = outline.items.slice(-RECAP_OUTLINE_TURN_COUNT);
  if (recentTurns.length === 0) {
    return complete(null, "empty-conversation");
  }

  const workspaceState = await collectThreadRecapWorkspaceState(
    deps,
    args.thread,
  );
  const prompt = renderTemplate("generateThreadRecap", {
    recentTurns: formatRecentTurns(recentTurns),
    workspaceState: formatThreadRecapWorkspaceState(workspaceState),
  });

  for (let attempt = 1; attempt <= RECAP_INFERENCE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const parsed = await inferenceComplete(deps, {
        prompt,
        schema: recapSchema,
        timeoutMs: RECAP_INFERENCE_TIMEOUT_MS,
      });
      const recap = parsed ? sanitizeGeneratedRecap(parsed.recap) : null;
      return complete(recap, recap ? undefined : "inference-unavailable");
    } catch (error) {
      if (error instanceof InferenceTimeoutError) {
        if (attempt < RECAP_INFERENCE_MAX_ATTEMPTS) {
          continue;
        }
        deps.logger.info(
          {
            attempts: RECAP_INFERENCE_MAX_ATTEMPTS,
            threadId: args.thread.id,
            timeoutMs: error.timeoutMs,
          },
          "Thread recap inference timed out",
        );
        return complete(null, "timeout");
      }

      deps.logger.warn(
        {
          threadId: args.thread.id,
          ...runtimeErrorLogFields(deps.config, error),
        },
        "Failed to generate thread recap",
      );
      return complete(null, "failed");
    }
  }

  return complete(null, "failed");
}
