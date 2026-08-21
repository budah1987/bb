import { randomUUID } from "node:crypto";
import {
  createTerminalSession,
  disableAllTerminalSupervision,
  getAppSettings,
  getDesiredTerminalSessionBySupervisionId,
  getTerminalSession,
  getTerminalSessionForThread,
  listTerminalSessionsByEnvironment,
  listTerminalSessionsByThread,
  listDesiredTerminalSessionsByHost,
  listThreadlessTerminalSessionsByEnvironment,
  listVisibleTerminalSessions,
  listVisibleTerminalSessionsByThread,
  listVisibleThreadlessTerminalSessionsByEnvironment,
  markDaemonTerminalSessionExited,
  markDaemonTerminalSessionsDisconnected,
  markEnvironmentTerminalSessionsExited,
  markHostDisconnectedTerminalSessionsExited,
  markTerminalSessionExited,
  markTerminalSessionRunning,
  markTerminalSessionUserInputById,
  markThreadTerminalSessionsExited,
  setTerminalSupervisionDesired,
  updateTerminalSessionSizeById,
  updateTerminalSessionTitleById,
  type TerminalSessionRow,
} from "@bb/db";
import {
  isVisibleTerminalSessionStatus,
  type TerminalSessionCloseReason,
} from "@bb/domain";
import type {
  HostDaemonDaemonWsMessage,
  HostDaemonServerWsMessage,
} from "@bb/host-daemon-contract";
import type {
  CloseTerminalRequest,
  CreateTerminalRequest,
  TerminalClientMessage,
  TerminalInputRequest,
  TerminalCreateTarget,
  TerminalListQuery,
  TerminalOutputChunk,
  TerminalOutputQuery,
  TerminalOutputResponse,
  TerminalResizeRequest,
  TerminalSession,
  UpdateTerminalRequest,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps, ServerLogger } from "../../types.js";
import { assertUsableHostId } from "../hosts/primary-host.js";
import {
  requireConnectedHostSession,
  requireEnvironment,
  requirePublicThread,
  requireReadyEnvironment,
} from "../lib/entity-lookup.js";
import {
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../lib/lifecycle-api-errors.js";
import { requireWorkspaceCommandTarget } from "../environments/workspace-command-target.js";

const DEFAULT_TERMINAL_OPEN_TIMEOUT_MS = 10_000;
const DEFAULT_TERMINAL_CLOSE_TIMEOUT_MS = 5_000;
const DEFAULT_TERMINAL_START: NonNullable<CreateTerminalRequest["start"]> = {
  mode: "shell",
};
const HOST_HOME_INITIAL_CWD = "~";
const BROWSER_TERMINAL_REPLAY_MAX_BYTES = 512 * 1024;
const TERMINAL_SCROLLBACK_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_RESTORE_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
export const MAX_RETAINED_TERMINALS_PER_WORKSPACE = 12;

type TerminalOpenedMessage = Extract<
  HostDaemonDaemonWsMessage,
  { type: "terminal.opened" }
>;
type TerminalErrorMessage = Extract<
  HostDaemonDaemonWsMessage,
  { type: "terminal.error" }
>;
type TerminalReplayMessage = Extract<
  HostDaemonDaemonWsMessage,
  { type: "terminal.replay" }
>;
type TerminalOutputMessage = Extract<
  HostDaemonDaemonWsMessage,
  { type: "terminal.output" }
>;
type TerminalApiErrorStatus = ConstructorParameters<typeof ApiError>[0];
type RunningBrowserTerminalSession = TerminalSessionRow & {
  daemonSessionId: string;
  status: "running";
};

interface TerminalClientSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface PendingTerminalOpen {
  daemonSessionId: string;
  reject: (error: Error) => void;
  resolve: (message: TerminalOpenedMessage) => void;
  timeout: ReturnType<typeof setTimeout>;
  terminalId: string;
}

interface PendingTerminalClose {
  closeReason: TerminalSessionCloseReason;
  daemonSessionId: string;
  promise: Promise<TerminalSessionRow>;
  reject: (error: Error) => void;
  resolve: (session: TerminalSessionRow) => void;
  terminalId: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingTerminalAttach {
  daemonSessionId: string;
  socket: TerminalClientSocket;
  terminalId: string;
  threadId: string | null;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingTerminalOutputRead {
  daemonSessionId: string;
  reject: (error: Error) => void;
  resolve: (message: TerminalReplayMessage) => void;
  terminalId: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface WaitForTerminalOpenArgs {
  daemonSessionId: string;
  requestId: string;
  terminalId: string;
}

interface WaitForTerminalAttachArgs {
  daemonSessionId: string;
  requestId: string;
  socket: TerminalClientSocket;
  terminalId: string;
  threadId: string | null;
}

interface WaitForTerminalOutputReadArgs {
  daemonSessionId: string;
  requestId: string;
  terminalId: string;
}

interface ResolvePendingOpenArgs {
  daemonSessionId: string;
  message: TerminalOpenedMessage;
}

interface ResolvePendingAttachArgs {
  daemonSessionId: string;
  message: TerminalReplayMessage;
}

interface ResolvePendingOutputReadArgs {
  daemonSessionId: string;
  message: TerminalReplayMessage;
}

interface RejectPendingOpenArgs {
  daemonSessionId: string;
  message: TerminalErrorMessage;
}

interface RejectPendingAttachArgs {
  daemonSessionId: string;
  message: TerminalErrorMessage;
}

interface RejectPendingOutputReadsArgs {
  daemonSessionId: string;
  message: TerminalErrorMessage;
}

interface RejectPendingOpenForTerminalArgs {
  code: string;
  daemonSessionId: string;
  message: string;
  status: TerminalApiErrorStatus;
  terminalId: string;
}

interface RequestTerminalClosesArgs {
  closeReason: TerminalSessionCloseReason;
  sessions: readonly TerminalSessionRow[];
}

interface PublishLifecycleTerminalExitsArgs {
  code: string;
  message: string;
  previousSessionsById: ReadonlyMap<string, TerminalSessionRow>;
  sessions: readonly TerminalSessionRow[];
}

interface NotifyExitedTerminalSessionArgs {
  code: string;
  message: string;
  session: TerminalSessionRow;
}

interface TerminalDaemonCloseTarget {
  daemonSessionId: string;
  terminalId: string;
}

type TerminalDaemonOpenTarget = Extract<
  HostDaemonServerWsMessage,
  { type: "terminal.open" }
>["target"];
type TerminalLaunchTarget = Exclude<TerminalCreateTarget, { kind: "thread" }>;

interface ResolvedTerminalLaunchTarget {
  daemonTarget: TerminalDaemonOpenTarget;
  environmentId: string | null;
  hostId: string;
  initialCwd: string;
}

interface AttachBrowserTerminalArgs {
  socket: TerminalClientSocket;
  sinceSeq: number;
  terminalId: string;
  threadId: string | null;
}

interface DetachBrowserTerminalArgs {
  socket: TerminalClientSocket;
  terminalId: string;
}

interface HandleBrowserTerminalMessageArgs {
  message: TerminalClientMessage;
  socket: TerminalClientSocket;
  terminalId: string;
  threadId: string | null;
}

interface SendTerminalInputArgs {
  payload: TerminalInputRequest;
  terminalId: string;
}

interface ResizeTerminalArgs {
  payload: TerminalResizeRequest;
  terminalId: string;
}

interface ReadTerminalOutputArgs {
  query: TerminalOutputQuery;
  terminalId: string;
}

interface GetRunningBrowserTerminalArgs {
  socket: TerminalClientSocket;
  terminalId: string;
  threadId: string | null;
}

interface GetBrowserTerminalSessionArgs {
  reportMissing?: boolean;
  socket: TerminalClientSocket;
  terminalId: string;
  threadId: string | null;
}

interface SendTerminalSocketErrorArgs {
  code: string;
  message: string;
  socket: TerminalClientSocket;
}

interface DisconnectDaemonSessionTerminalsArgs {
  daemonSessionId: string;
}

interface RejectPendingAttachesForTerminalArgs {
  code: string;
  message: string;
  terminalId: string;
}

interface CloseStaleOpenedTerminalArgs {
  daemonSessionId: string;
  terminalId: string;
}

interface PublishLifecycleTerminalExitsForSessionsArgs {
  currentSessions: TerminalSessionRow[];
  exitedSessions: TerminalSessionRow[];
  message: string;
}

interface CloseThreadTerminalsForLifecycleArgs {
  closeReason: TerminalSessionCloseReason;
  message: string;
  threadId: string;
}

interface TerminalSessionLifecycleOptions {
  attachTimeoutMs?: number;
  closeTimeoutMs?: number;
  config: AppDeps["config"];
  db: AppDeps["db"];
  hub: AppDeps["hub"];
  logger: ServerLogger;
  openTimeoutMs?: number;
  restoreRetryDelaysMs?: readonly number[];
}

interface ListTerminalsArgs {
  query: TerminalListQuery;
}

interface CreateTerminalArgs {
  payload: CreateTerminalRequest;
}

interface GetTerminalArgs {
  terminalId: string;
}

interface TerminalCreatePayload {
  cols: number;
  devServerPort?: CreateTerminalRequest["devServerPort"];
  rows: number;
  restartPolicy?: CreateTerminalRequest["restartPolicy"];
  start?: NonNullable<CreateTerminalRequest["start"]>;
  title?: string;
}

interface CreateTerminalForTargetArgs {
  payload: TerminalCreatePayload;
  target: TerminalLaunchTarget;
  threadId: string | null;
  title: string;
  supervision?: {
    attempt: number;
    id: string;
  };
}

interface RenameTerminalArgs {
  payload: UpdateTerminalRequest;
  terminalId: string;
}

interface CloseTerminalArgs {
  payload: CloseTerminalRequest;
  terminalId: string;
}

interface RestartTerminalArgs {
  terminalId: string;
}

interface CloseTerminalSessionArgs {
  current: TerminalSessionRow;
  payload: CloseTerminalRequest;
}

interface CloseDeletedThreadTerminalsArgs {
  threadId: string;
}

interface CloseArchivedThreadTerminalsArgs {
  threadId: string;
}

interface CloseDestroyedEnvironmentTerminalsArgs {
  environmentId: string;
}

interface ExpireDisconnectedHostTerminalsArgs {
  daemonSessionId: string;
  hostId: string;
}

interface HandleDaemonTerminalMessageArgs {
  hostId: string;
  message: HostDaemonDaemonWsMessage;
  sessionId: string;
}

interface HandleDaemonSessionClosedArgs {
  sessionId: string;
}

function toTerminalOutputChunk(
  chunk: TerminalOutputMessage["chunk"],
): TerminalOutputChunk {
  return {
    seq: chunk.seq,
    dataBase64: chunk.dataBase64,
  };
}

function titleFromCommand(command: string): string {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (normalized.length <= 80) {
    return normalized;
  }
  return `${normalized.slice(0, 77)}...`;
}

function initialTitleForTerminal(
  payload: TerminalCreatePayload,
  existingSessionCount: number,
): string {
  if (payload.title !== undefined) {
    return payload.title;
  }
  if (payload.start?.mode === "command") {
    return titleFromCommand(payload.start.command);
  }
  return `Terminal ${existingSessionCount + 1}`;
}

interface BoundedTerminalOutput {
  chunks: TerminalOutputChunk[];
  truncated: boolean;
}

function applyTerminalOutputBounds(args: {
  chunks: readonly TerminalOutputChunk[];
  query: TerminalOutputQuery;
  replayNextSeq: number;
  requestedSinceSeq: number;
}): BoundedTerminalOutput {
  const { chunks, query, replayNextSeq, requestedSinceSeq } = args;
  const limitedByChunks =
    query.limitChunks === undefined ? chunks : chunks.slice(-query.limitChunks);
  let truncated =
    limitedByChunks.length < chunks.length ||
    (chunks[0]?.seq ?? replayNextSeq) > requestedSinceSeq;
  if (query.tailBytes === undefined) {
    return { chunks: [...limitedByChunks], truncated };
  }

  const bounded: TerminalOutputChunk[] = [];
  let byteLength = 0;
  for (let index = limitedByChunks.length - 1; index >= 0; index -= 1) {
    const chunk = limitedByChunks[index];
    const chunkByteLength = Buffer.byteLength(chunk.dataBase64, "base64");
    if (bounded.length > 0 && byteLength + chunkByteLength > query.tailBytes) {
      truncated = true;
      break;
    }
    bounded.unshift(chunk);
    byteLength += chunkByteLength;
    if (byteLength >= query.tailBytes) {
      truncated = truncated || index > 0;
      break;
    }
  }
  if (bounded.length < limitedByChunks.length) {
    truncated = true;
  }
  return { chunks: bounded, truncated };
}

function isRunningBrowserTerminalSession(
  row: TerminalSessionRow,
): row is RunningBrowserTerminalSession {
  return row.status === "running" && row.daemonSessionId !== null;
}

function terminalRestartTarget(row: TerminalSessionRow): TerminalCreateTarget {
  if (row.threadId !== null) {
    return { kind: "thread", threadId: row.threadId };
  }
  if (row.environmentId !== null) {
    return { kind: "environment", environmentId: row.environmentId };
  }
  return {
    kind: "host_path",
    hostId: row.hostId,
    cwd: row.initialCwd === HOST_HOME_INITIAL_CWD ? null : row.initialCwd,
  };
}

function terminalRestoreLaunchTarget(
  row: TerminalSessionRow,
): TerminalLaunchTarget {
  if (row.environmentId !== null) {
    return { kind: "environment", environmentId: row.environmentId };
  }
  return {
    kind: "host_path",
    hostId: row.hostId,
    cwd: row.initialCwd === HOST_HOME_INITIAL_CWD ? null : row.initialCwd,
  };
}

function getTerminalDaemonCloseTarget(
  row: TerminalSessionRow,
): TerminalDaemonCloseTarget | null {
  if (row.daemonSessionId === null) {
    return null;
  }
  if (row.status !== "starting" && row.status !== "running") {
    return null;
  }
  return {
    daemonSessionId: row.daemonSessionId,
    terminalId: row.id,
  };
}

export function toTerminalSession(row: TerminalSessionRow): TerminalSession {
  return {
    id: row.id,
    threadId: row.threadId,
    environmentId: row.environmentId,
    hostId: row.hostId,
    title: row.title,
    launchCommand: row.launchCommand,
    devServerPort: row.devServerPort,
    restartPolicy: row.restartPolicy,
    initialCwd: row.initialCwd,
    cols: row.cols,
    rows: row.rows,
    status: row.status,
    exitCode: row.exitCode,
    closeReason: row.closeReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUserInputAt: row.lastUserInputAt,
  };
}

export class TerminalSessionLifecycle {
  private readonly attachTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  private readonly pendingAttaches = new Map<string, PendingTerminalAttach>();
  private readonly pendingCloses = new Map<string, PendingTerminalClose>();
  private readonly pendingOutputReads = new Map<
    string,
    PendingTerminalOutputRead
  >();
  private readonly pendingOpens = new Map<string, PendingTerminalOpen>();
  private readonly pendingRestarts = new Map<
    string,
    Promise<TerminalSession>
  >();
  private readonly openTimeoutMs: number;
  private readonly restoreRetryDelaysMs: readonly number[];
  private readonly supervisedRestoreTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(private readonly options: TerminalSessionLifecycleOptions) {
    this.attachTimeoutMs =
      options.attachTimeoutMs ?? DEFAULT_TERMINAL_OPEN_TIMEOUT_MS;
    this.closeTimeoutMs =
      options.closeTimeoutMs ?? DEFAULT_TERMINAL_CLOSE_TIMEOUT_MS;
    this.openTimeoutMs =
      options.openTimeoutMs ?? DEFAULT_TERMINAL_OPEN_TIMEOUT_MS;
    this.restoreRetryDelaysMs =
      options.restoreRetryDelaysMs ?? DEFAULT_RESTORE_RETRY_DELAYS_MS;
  }

  listTerminals(args: ListTerminalsArgs): TerminalSession[] {
    const { query } = args;
    if (query.threadId !== undefined) {
      requirePublicThread(this.options.db, query.threadId);
      return listVisibleTerminalSessionsByThread(
        this.options.db,
        query.threadId,
      ).map(toTerminalSession);
    }
    if (query.environmentId !== undefined) {
      requireEnvironment(this.options.db, query.environmentId);
      return listVisibleThreadlessTerminalSessionsByEnvironment(
        this.options.db,
        query.environmentId,
      ).map(toTerminalSession);
    }
    const hostId = query.hostId;
    if (hostId === undefined) {
      return [];
    }
    assertUsableHostId(
      {
        config: this.options.config,
        db: this.options.db,
        hub: this.options.hub,
      },
      { hostId },
    );
    return listVisibleTerminalSessions(this.options.db)
      .filter(
        (session) =>
          session.threadId === null &&
          session.environmentId === null &&
          session.hostId === hostId &&
          (query.cwd === undefined || session.initialCwd === query.cwd),
      )
      .map(toTerminalSession);
  }

  getTerminal(args: GetTerminalArgs): TerminalSession {
    const session = getTerminalSession(this.options.db, {
      terminalId: args.terminalId,
    });
    if (!session) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    return toTerminalSession(session);
  }

  async createTerminal(args: CreateTerminalArgs): Promise<TerminalSession> {
    const { target } = args.payload;
    const existingSessionCount = this.countExistingSessionsForTarget(target);
    const launchTarget =
      target.kind === "thread"
        ? this.resolveThreadTerminalCreateTarget(target.threadId)
        : target;
    if (launchTarget.kind === "environment") {
      this.assertWorkspaceTerminalBudget(launchTarget.environmentId);
    }
    const restartPolicy = this.resolveTerminalRestartPolicy(args.payload);
    const supervision =
      restartPolicy === "until_stopped"
        ? { attempt: 0, id: randomUUID() }
        : undefined;
    try {
      return await this.createTerminalForTarget({
        payload: { ...args.payload, restartPolicy },
        target: launchTarget,
        threadId: target.kind === "thread" ? target.threadId : null,
        title: initialTitleForTerminal(args.payload, existingSessionCount),
        supervision,
      });
    } catch (error) {
      if (supervision !== undefined) {
        setTerminalSupervisionDesired(this.options.db, {
          desired: false,
          supervisionId: supervision.id,
        });
      }
      throw error;
    }
  }

  private resolveTerminalRestartPolicy(
    payload: TerminalCreatePayload,
  ): "never" | "until_stopped" {
    const start = payload.start ?? DEFAULT_TERMINAL_START;
    const isNamedCommand =
      start.mode === "command" && payload.title !== undefined;
    if (!isNamedCommand) return "never";
    if (payload.restartPolicy !== undefined) return payload.restartPolicy;

    // A named command commonly represents a one-off task. Only a declared
    // dev server inherits the user's restart preference; callers can opt any
    // other command into supervision explicitly.
    if (payload.devServerPort === undefined) return "never";
    return getAppSettings(this.options.db).devServerRestartPolicy;
  }

  private countExistingSessionsForTarget(target: TerminalCreateTarget): number {
    switch (target.kind) {
      case "thread": {
        const thread = requirePublicThread(this.options.db, target.threadId);
        return listTerminalSessionsByThread(this.options.db, thread.id).length;
      }
      case "environment":
        return listThreadlessTerminalSessionsByEnvironment(
          this.options.db,
          target.environmentId,
        ).length;
      case "host_path":
        return listVisibleTerminalSessions(this.options.db).filter(
          (session) =>
            session.threadId === null &&
            session.environmentId === null &&
            session.hostId === target.hostId &&
            (target.cwd === null || session.initialCwd === target.cwd),
        ).length;
    }
  }

  private assertWorkspaceTerminalBudget(environmentId: string): void {
    const retainedCount = listTerminalSessionsByEnvironment(
      this.options.db,
      environmentId,
    ).filter((session) =>
      isVisibleTerminalSessionStatus(session.status),
    ).length;
    if (retainedCount < MAX_RETAINED_TERMINALS_PER_WORKSPACE) {
      return;
    }
    throw new ApiError(
      409,
      "resource_limit",
      `Workspace terminal limit reached (${MAX_RETAINED_TERMINALS_PER_WORKSPACE})`,
    );
  }

  private resolveThreadTerminalCreateTarget(
    threadId: string,
  ): TerminalLaunchTarget {
    const thread = requirePublicThread(this.options.db, threadId);
    if (!thread.environmentId) {
      throwThreadEnvironmentUnavailable(
        threadEnvironmentUnavailableDetails("never_attached", null),
      );
    }
    return { kind: "environment", environmentId: thread.environmentId };
  }

  private async createTerminalForTarget(
    args: CreateTerminalForTargetArgs,
  ): Promise<TerminalSession> {
    const launchTarget = this.resolveTerminalLaunchTarget(args.target);
    const daemonSession = requireConnectedHostSession(
      this.options,
      launchTarget.hostId,
    );
    const start = args.payload.start ?? DEFAULT_TERMINAL_START;
    const isNamedCommand =
      start.mode === "command" && args.payload.title !== undefined;
    const restartPolicy = this.resolveTerminalRestartPolicy(args.payload);
    const startingSession = this.options.db.transaction((tx) => {
      if (args.supervision !== undefined) {
        setTerminalSupervisionDesired(tx, {
          desired: false,
          supervisionId: args.supervision.id,
        });
      }
      return createTerminalSession(tx, {
        cols: args.payload.cols,
        daemonSessionId: daemonSession.id,
        devServerPort: args.payload.devServerPort,
        environmentId: launchTarget.environmentId,
        hostId: launchTarget.hostId,
        initialCwd: launchTarget.initialCwd,
        launchCommand: isNamedCommand ? start.command : null,
        rows: args.payload.rows,
        restartPolicy,
        status: "starting",
        supervisionAttempt: args.supervision?.attempt,
        supervisionDesired: args.supervision !== undefined,
        supervisionId: args.supervision?.id,
        threadId: args.threadId,
        title: args.title,
      });
    });
    const requestId = randomUUID();
    const openMessage: HostDaemonServerWsMessage = {
      type: "terminal.open",
      requestId,
      terminalId: startingSession.id,
      ...(args.threadId !== null ? { threadId: args.threadId } : {}),
      target: launchTarget.daemonTarget,
      cols: args.payload.cols,
      rows: args.payload.rows,
      start,
    };

    const pendingOpen = this.waitForTerminalOpen({
      daemonSessionId: daemonSession.id,
      requestId,
      terminalId: startingSession.id,
    });
    const sent = this.options.hub.sendDaemonSessionMessage(
      daemonSession.id,
      openMessage,
    );
    if (!sent) {
      this.cancelPendingOpen(requestId);
      const exited = markTerminalSessionExited(this.options.db, {
        terminalId: startingSession.id,
        exitCode: null,
        closeReason: "daemon-disconnect",
      });
      if (exited) {
        this.notifyTerminalSessionChanged(exited);
      }
      throw new ApiError(
        502,
        "host_disconnected",
        `Host is not connected for terminal ${exited?.id ?? startingSession.id}`,
      );
    }

    let opened: TerminalOpenedMessage;
    try {
      opened = await pendingOpen;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.body.code === "terminal_open_timeout"
      ) {
        const exited = markTerminalSessionExited(this.options.db, {
          terminalId: startingSession.id,
          exitCode: null,
          closeReason: "open-timeout",
        });
        if (exited) {
          this.notifyTerminalSessionChanged(exited);
        }
        this.options.hub.sendDaemonSessionMessage(daemonSession.id, {
          type: "terminal.close",
          terminalId: startingSession.id,
          reason: "open-timeout",
        });
      } else if (
        !(error instanceof ApiError) ||
        error.body.code !== "host_disconnected"
      ) {
        const exited = markTerminalSessionExited(this.options.db, {
          terminalId: startingSession.id,
          exitCode: null,
          closeReason: "process-exit",
        });
        if (exited) {
          this.notifyTerminalSessionChanged(exited);
        }
      }
      throw error;
    }

    const runningSession = markTerminalSessionRunning(this.options.db, {
      cols: opened.cols,
      daemonSessionId: daemonSession.id,
      initialCwd: opened.initialCwd,
      rows: opened.rows,
      terminalId: startingSession.id,
      title: args.payload.title ?? opened.title,
    });
    if (!runningSession) {
      this.closeStaleOpenedTerminal({
        daemonSessionId: daemonSession.id,
        terminalId: startingSession.id,
      });
      throw new ApiError(
        409,
        "terminal_open_cancelled",
        "Terminal session was cancelled before it opened",
      );
    }
    this.notifyTerminalSessionChanged(runningSession);
    return toTerminalSession(runningSession);
  }

  private resolveTerminalLaunchTarget(
    target: TerminalLaunchTarget,
  ): ResolvedTerminalLaunchTarget {
    switch (target.kind) {
      case "environment": {
        const environment = requireReadyEnvironment(
          this.options.db,
          target.environmentId,
        );
        const workspaceTarget = requireWorkspaceCommandTarget(environment);
        return {
          daemonTarget: {
            kind: "workspace",
            environmentId: workspaceTarget.environmentId,
            workspaceContext: workspaceTarget.workspaceContext,
          },
          environmentId: environment.id,
          hostId: workspaceTarget.hostId,
          initialCwd: workspaceTarget.workspaceContext.workspacePath,
        };
      }
      case "host_path":
        assertUsableHostId(
          {
            config: this.options.config,
            db: this.options.db,
            hub: this.options.hub,
          },
          { hostId: target.hostId },
        );
        return {
          daemonTarget: {
            kind: "host_path",
            cwd: target.cwd,
          },
          environmentId: null,
          hostId: target.hostId,
          initialCwd: target.cwd ?? HOST_HOME_INITIAL_CWD,
        };
    }
  }

  renameTerminal(args: RenameTerminalArgs): TerminalSession {
    const renamed = updateTerminalSessionTitleById(this.options.db, {
      terminalId: args.terminalId,
      title: args.payload.title,
    });
    if (!renamed) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    this.notifyTerminalSessionChanged(renamed);
    const session = toTerminalSession(renamed);
    this.options.hub.sendTerminalClientMessage(renamed.id, {
      type: "session-updated",
      session,
    });
    return session;
  }

  async restartTerminal(args: RestartTerminalArgs): Promise<TerminalSession> {
    const existing = this.pendingRestarts.get(args.terminalId);
    if (existing) {
      return existing;
    }
    const restart = this.restartTerminalOnce(args.terminalId);
    this.pendingRestarts.set(args.terminalId, restart);
    try {
      return await restart;
    } finally {
      if (this.pendingRestarts.get(args.terminalId) === restart) {
        this.pendingRestarts.delete(args.terminalId);
      }
    }
  }

  private async restartTerminalOnce(
    terminalId: string,
  ): Promise<TerminalSession> {
    const current = getTerminalSession(this.options.db, { terminalId });
    if (!current) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }

    const replacement = await this.createTerminal({
      payload: {
        cols: current.cols,
        devServerPort:
          current.launchCommand === null
            ? undefined
            : (current.devServerPort ?? undefined),
        rows: current.rows,
        restartPolicy:
          current.launchCommand === null ? undefined : current.restartPolicy,
        target: terminalRestartTarget(current),
        start:
          current.launchCommand === null
            ? { mode: "shell" }
            : { mode: "command", command: current.launchCommand },
        title: current.title,
      },
    });
    if (current.status === "exited") {
      return replacement;
    }

    try {
      await this.closeTerminalSession({
        current,
        payload: { mode: "force", reason: "user" },
      });
    } catch (error) {
      const replacementRow = getTerminalSession(this.options.db, {
        terminalId: replacement.id,
      });
      if (replacementRow) {
        void this.closeTerminalSession({
          current: replacementRow,
          payload: { mode: "force", reason: "user" },
        }).catch((cleanupError) => {
          this.options.logger.warn(
            {
              err:
                cleanupError instanceof Error
                  ? cleanupError
                  : new Error(String(cleanupError)),
              terminalId: replacement.id,
            },
            "Failed to clean up replacement terminal after restart failure",
          );
        });
      }
      throw error;
    }
    return replacement;
  }

  async closeTerminal(args: CloseTerminalArgs): Promise<TerminalSession> {
    const current = getTerminalSession(this.options.db, {
      terminalId: args.terminalId,
    });
    if (!current) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    return this.closeTerminalSession({
      current,
      payload: args.payload,
    });
  }

  private async closeTerminalSession(
    args: CloseTerminalSessionArgs,
  ): Promise<TerminalSession> {
    const current = args.current;
    if (args.payload.reason === "user") {
      this.disarmTerminalSupervision(current);
    }
    if (current.status === "exited") {
      return toTerminalSession(current);
    }
    if (args.payload.mode === "if-clean" && current.lastUserInputAt !== null) {
      return toTerminalSession(current);
    }
    if (
      current.daemonSessionId === null ||
      (current.status !== "starting" && current.status !== "running")
    ) {
      return this.finishTerminalCloseWithoutDaemon({
        current,
        reason: args.payload.reason,
      });
    }

    const pending = this.waitForTerminalClose({
      closeReason: args.payload.reason,
      daemonSessionId: current.daemonSessionId,
      terminalId: current.id,
    });
    if (pending.created) {
      const sent = this.options.hub.sendDaemonSessionMessage(
        current.daemonSessionId,
        {
          type: "terminal.close",
          terminalId: current.id,
          reason: args.payload.reason,
        },
      );
      if (!sent) {
        this.disconnectDaemonSessionTerminals({
          daemonSessionId: current.daemonSessionId,
        });
        this.rejectPendingClose(
          current.id,
          new ApiError(502, "host_disconnected", "Host is not connected"),
        );
      }
    }
    try {
      return toTerminalSession(await pending.promise);
    } catch (error) {
      // Upstream #1353/#1357: the close timeout may already have finalized the
      // daemon-owned row. Return that converged state so clients drop the tab
      // instead of rediscovering a terminal the server has closed for good.
      const finalized = getTerminalSession(this.options.db, {
        terminalId: current.id,
      });
      if (
        finalized?.status === "exited" &&
        finalized.closeReason === args.payload.reason
      ) {
        return toTerminalSession(finalized);
      }
      throw error;
    }
  }

  private finishTerminalCloseWithoutDaemon(args: {
    current: TerminalSessionRow;
    reason: TerminalSessionCloseReason;
  }): TerminalSession {
    const closed = markTerminalSessionExited(this.options.db, {
      terminalId: args.current.id,
      exitCode: args.current.exitCode,
      closeReason: args.reason,
    });
    const session = closed ?? args.current;
    this.notifyExitedTerminalSession({
      session,
      code: "terminal_closed",
      message: "Terminal session closed",
    });
    return toTerminalSession(session);
  }

  sendTerminalInput(args: SendTerminalInputArgs): TerminalSession {
    const current = getTerminalSession(this.options.db, {
      terminalId: args.terminalId,
    });
    if (!current) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    if (!isRunningBrowserTerminalSession(current)) {
      throw new ApiError(
        409,
        "terminal_not_running",
        "Terminal session is not running",
      );
    }

    const markedInput = markTerminalSessionUserInputById(this.options.db, {
      terminalId: current.id,
    });
    const session = markedInput ?? current;
    if (markedInput) {
      this.notifyTerminalSessionChanged(markedInput);
      this.options.hub.sendTerminalClientMessage(markedInput.id, {
        type: "session-updated",
        session: toTerminalSession(markedInput),
      });
    }

    const sent = this.options.hub.sendDaemonSessionMessage(
      current.daemonSessionId,
      {
        type: "terminal.input",
        terminalId: current.id,
        dataBase64: args.payload.dataBase64,
      },
    );
    if (!sent) {
      this.disconnectDaemonSessionTerminals({
        daemonSessionId: current.daemonSessionId,
      });
      throw new ApiError(502, "host_disconnected", "Host is not connected");
    }
    return toTerminalSession(session);
  }

  resizeTerminal(args: ResizeTerminalArgs): TerminalSession {
    const current = getTerminalSession(this.options.db, {
      terminalId: args.terminalId,
    });
    if (!current) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    if (!isRunningBrowserTerminalSession(current)) {
      throw new ApiError(
        409,
        "terminal_not_running",
        "Terminal session is not running",
      );
    }

    const resized =
      current.cols === args.payload.cols && current.rows === args.payload.rows
        ? current
        : updateTerminalSessionSizeById(this.options.db, {
            cols: args.payload.cols,
            rows: args.payload.rows,
            terminalId: current.id,
          });
    const session = resized ?? current;
    if (resized && resized !== current) {
      this.notifyTerminalSessionChanged(resized);
      this.options.hub.sendTerminalClientMessage(resized.id, {
        type: "session-updated",
        session: toTerminalSession(resized),
      });
    }

    const sent = this.options.hub.sendDaemonSessionMessage(
      current.daemonSessionId,
      {
        type: "terminal.resize",
        terminalId: current.id,
        cols: args.payload.cols,
        rows: args.payload.rows,
      },
    );
    if (!sent) {
      this.disconnectDaemonSessionTerminals({
        daemonSessionId: current.daemonSessionId,
      });
      throw new ApiError(502, "host_disconnected", "Host is not connected");
    }
    return toTerminalSession(session);
  }

  async readTerminalOutput(
    args: ReadTerminalOutputArgs,
  ): Promise<TerminalOutputResponse> {
    const current = getTerminalSession(this.options.db, {
      terminalId: args.terminalId,
    });
    if (!current) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    if (!isRunningBrowserTerminalSession(current)) {
      throw new ApiError(
        409,
        "terminal_output_unavailable",
        "Terminal output is unavailable because the session is not running",
      );
    }

    const requestId = randomUUID();
    const pendingReplay = this.waitForTerminalOutputRead({
      daemonSessionId: current.daemonSessionId,
      requestId,
      terminalId: current.id,
    });
    const sent = this.options.hub.sendDaemonSessionMessage(
      current.daemonSessionId,
      {
        type: "terminal.attach",
        requestId,
        terminalId: current.id,
        sinceSeq: args.query.sinceSeq ?? 0,
        tailBytes: args.query.tailBytes ?? TERMINAL_SCROLLBACK_MAX_BYTES,
      },
    );
    if (!sent) {
      this.cancelPendingOutputRead(requestId);
      this.disconnectDaemonSessionTerminals({
        daemonSessionId: current.daemonSessionId,
      });
      throw new ApiError(502, "host_disconnected", "Host is not connected");
    }

    const requestedSinceSeq = args.query.sinceSeq ?? 0;
    const replay = await pendingReplay;
    const bounded = applyTerminalOutputBounds({
      chunks: replay.chunks.map(toTerminalOutputChunk),
      query: args.query,
      replayNextSeq: replay.nextSeq,
      requestedSinceSeq,
    });
    return {
      chunks: bounded.chunks,
      nextSeq: replay.nextSeq,
      truncated: bounded.truncated,
    };
  }

  closeDeletedThreadTerminals(args: CloseDeletedThreadTerminalsArgs): void {
    this.closeThreadTerminalsForLifecycle({
      threadId: args.threadId,
      closeReason: "thread-deleted",
      message: "Terminal session closed because the thread was deleted",
    });
  }

  closeArchivedThreadTerminals(args: CloseArchivedThreadTerminalsArgs): void {
    this.closeThreadTerminalsForLifecycle({
      threadId: args.threadId,
      closeReason: "thread-archived",
      message: "Terminal session closed because the thread was archived",
    });
  }

  closeDestroyedEnvironmentTerminals(
    args: CloseDestroyedEnvironmentTerminalsArgs,
  ): void {
    const currentSessions = listTerminalSessionsByEnvironment(
      this.options.db,
      args.environmentId,
    );
    for (const session of currentSessions) {
      this.disarmTerminalSupervision(session);
    }
    this.requestTerminalCloses({
      closeReason: "environment-destroyed",
      sessions: currentSessions,
    });
    const exitedSessions = markEnvironmentTerminalSessionsExited(
      this.options.db,
      {
        environmentId: args.environmentId,
        closeReason: "environment-destroyed",
      },
    );
    this.publishLifecycleTerminalExitsForSessions({
      currentSessions,
      exitedSessions,
      message: "Terminal session closed because the environment was destroyed",
    });
  }

  expireDisconnectedHostTerminals(
    args: ExpireDisconnectedHostTerminalsArgs,
  ): void {
    // Terminal v1 does not preserve PTYs across daemon websocket replacement.
    // Any terminal owned by the disconnected session is expired and the new
    // daemon is asked to close a stale PTY if it still exists locally.
    const exitedSessions = markHostDisconnectedTerminalSessionsExited(
      this.options.db,
      {
        hostId: args.hostId,
        closeReason: "daemon-disconnect",
      },
    );
    for (const session of exitedSessions) {
      this.options.hub.sendDaemonSessionMessage(args.daemonSessionId, {
        type: "terminal.close",
        terminalId: session.id,
        reason: "daemon-disconnect",
      });
      this.notifyExitedTerminalSession({
        session,
        code: "host_disconnected",
        message: "Host disconnected from terminal session",
      });
    }
    this.restoreDesiredDevServersForHost(args.hostId);
  }

  private restoreDesiredDevServersForHost(hostId: string): void {
    for (const session of listDesiredTerminalSessionsByHost(
      this.options.db,
      hostId,
    )) {
      if (session.status !== "starting" && session.status !== "running") {
        this.scheduleDevServerRestore(session, 0);
      }
    }
  }

  private scheduleDevServerRestore(
    session: TerminalSessionRow,
    delayMs?: number,
  ): void {
    if (
      session.supervisionId === null ||
      !session.supervisionDesired ||
      session.launchCommand === null ||
      this.supervisedRestoreTimers.has(session.supervisionId)
    ) {
      return;
    }
    const retryDelay =
      delayMs ??
      this.restoreRetryDelaysMs[
        Math.min(
          session.supervisionAttempt,
          this.restoreRetryDelaysMs.length - 1,
        )
      ] ??
      30_000;
    const timeout = setTimeout(() => {
      if (session.supervisionId === null) return;
      this.supervisedRestoreTimers.delete(session.supervisionId);
      void this.restoreDevServer(session.supervisionId);
    }, retryDelay);
    timeout.unref?.();
    this.supervisedRestoreTimers.set(session.supervisionId, timeout);
  }

  private async restoreDevServer(supervisionId: string): Promise<void> {
    const session = getDesiredTerminalSessionBySupervisionId(
      this.options.db,
      supervisionId,
    );
    if (
      session === null ||
      session.launchCommand === null ||
      session.status === "starting" ||
      session.status === "running"
    ) {
      return;
    }
    try {
      await this.createTerminalForTarget({
        payload: {
          cols: session.cols,
          devServerPort: session.devServerPort ?? undefined,
          rows: session.rows,
          restartPolicy: session.restartPolicy,
          start: { mode: "command", command: session.launchCommand },
          title: session.title,
        },
        target: terminalRestoreLaunchTarget(session),
        threadId: session.threadId,
        title: session.title,
        supervision: {
          attempt: session.supervisionAttempt + 1,
          id: supervisionId,
        },
      });
    } catch (error) {
      this.options.logger.warn(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          terminalId: session.id,
        },
        "Failed to restore supervised dev server",
      );
      const desired = getDesiredTerminalSessionBySupervisionId(
        this.options.db,
        supervisionId,
      );
      if (desired !== null) {
        this.scheduleDevServerRestore(desired);
      }
    }
  }

  private disarmTerminalSupervision(session: TerminalSessionRow): void {
    if (session.supervisionId === null) return;
    const timeout = this.supervisedRestoreTimers.get(session.supervisionId);
    if (timeout !== undefined) {
      clearTimeout(timeout);
      this.supervisedRestoreTimers.delete(session.supervisionId);
    }
    setTerminalSupervisionDesired(this.options.db, {
      desired: false,
      supervisionId: session.supervisionId,
    });
  }

  reconcileDevServerRestartPolicy(args: {
    next: "never" | "until_stopped";
    previous: "never" | "until_stopped";
  }): void {
    if (args.previous === args.next || args.next === "until_stopped") return;
    const disabled = disableAllTerminalSupervision(this.options.db);
    for (const session of disabled) {
      if (session.supervisionId === null) continue;
      const timeout = this.supervisedRestoreTimers.get(session.supervisionId);
      if (timeout !== undefined) clearTimeout(timeout);
      this.supervisedRestoreTimers.delete(session.supervisionId);
      this.notifyTerminalSessionChanged(session);
    }
  }

  dispose(): void {
    for (const timeout of this.supervisedRestoreTimers.values()) {
      clearTimeout(timeout);
    }
    this.supervisedRestoreTimers.clear();
  }

  attachBrowserTerminal(args: AttachBrowserTerminalArgs): void {
    const current = this.getBrowserTerminalSession({
      ...args,
      reportMissing: false,
    });
    if (!current) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }

    const session = toTerminalSession(current);
    if (current.status !== "running" || current.daemonSessionId === null) {
      this.options.hub.sendTerminalSocketMessage(args.socket, {
        type: "attached",
        session,
        replayStartSeq: 0,
        nextSeq: 0,
      });
      if (current.status === "exited") {
        this.options.hub.sendTerminalSocketMessage(args.socket, {
          type: "exited",
          session,
        });
      } else {
        this.sendTerminalSocketError({
          socket: args.socket,
          code: "terminal_not_running",
          message: "Terminal session is not running",
        });
      }
      return;
    }

    this.options.hub.claimTerminalResizeOwnership(current.id, args.socket);
    const requestId = randomUUID();
    this.waitForTerminalAttach({
      daemonSessionId: current.daemonSessionId,
      requestId,
      socket: args.socket,
      terminalId: current.id,
      threadId: args.threadId,
    });
    const sent = this.options.hub.sendDaemonSessionMessage(
      current.daemonSessionId,
      {
        type: "terminal.attach",
        requestId,
        terminalId: current.id,
        sinceSeq: args.sinceSeq,
        tailBytes: BROWSER_TERMINAL_REPLAY_MAX_BYTES,
      },
    );
    if (!sent) {
      this.cancelPendingAttach(requestId);
      this.sendTerminalSocketError({
        socket: args.socket,
        code: "host_disconnected",
        message: "Host is not connected",
      });
      this.disconnectDaemonSessionTerminals({
        daemonSessionId: current.daemonSessionId,
      });
    }
  }

  detachBrowserTerminal(args: DetachBrowserTerminalArgs): void {
    this.options.hub.unregisterTerminalClient(args.terminalId, args.socket);
    for (const [requestId, pending] of this.pendingAttaches) {
      if (
        pending.terminalId === args.terminalId &&
        pending.socket === args.socket
      ) {
        clearTimeout(pending.timeout);
        this.pendingAttaches.delete(requestId);
      }
    }
  }

  handleBrowserTerminalMessage(args: HandleBrowserTerminalMessageArgs): void {
    switch (args.message.type) {
      case "ping":
        this.options.hub.sendTerminalSocketMessage(args.socket, {
          type: "pong",
        });
        return;
      case "input":
        this.forwardBrowserTerminalInput(args);
        return;
      case "resize":
        this.resizeBrowserTerminal(args);
        return;
      case "close":
        const current = this.getBrowserTerminalSession(args);
        if (current) {
          void this.closeTerminalSession({
            current,
            payload: { mode: "force", reason: args.message.reason },
          }).catch((error) => {
            this.sendTerminalSocketError({
              socket: args.socket,
              code: "terminal_close_failed",
              message: error instanceof Error ? error.message : String(error),
            });
          });
        }
        return;
    }
  }

  handleDaemonTerminalMessage(args: HandleDaemonTerminalMessageArgs): void {
    switch (args.message.type) {
      case "heartbeat":
        return;
      case "terminal.opened":
        this.resolvePendingOpen({
          daemonSessionId: args.sessionId,
          message: args.message,
        });
        return;
      case "terminal.error":
        this.rejectPendingOpen({
          daemonSessionId: args.sessionId,
          message: args.message,
        });
        this.rejectPendingAttach({
          daemonSessionId: args.sessionId,
          message: args.message,
        });
        this.rejectPendingOutputReads({
          daemonSessionId: args.sessionId,
          message: args.message,
        });
        return;
      case "terminal.exited":
        const exited = markDaemonTerminalSessionExited(this.options.db, {
          terminalId: args.message.terminalId,
          daemonSessionId: args.sessionId,
          exitCode: args.message.exitCode,
          closeReason: args.message.closeReason,
        });
        if (exited) {
          this.resolvePendingClose({
            daemonSessionId: args.sessionId,
            session: exited,
          });
          this.notifyTerminalSessionChanged(exited);
          const session = toTerminalSession(exited);
          this.options.hub.sendTerminalClientMessage(exited.id, {
            type: "exited",
            session,
          });
          this.rejectPendingAttachesForTerminal({
            terminalId: exited.id,
            code: "terminal_exited",
            message: "Terminal session exited",
          });
          this.rejectPendingOutputReadsForTerminal({
            terminalId: exited.id,
            code: "terminal_exited",
            message: "Terminal session exited",
          });
          if (exited.closeReason === "user") {
            this.disarmTerminalSupervision(exited);
          } else if (exited.supervisionDesired) {
            this.scheduleDevServerRestore(exited);
          }
        }
        return;
      case "terminal.output": {
        const current = getTerminalSession(this.options.db, {
          terminalId: args.message.terminalId,
        });
        if (
          current?.status !== "running" ||
          current.daemonSessionId !== args.sessionId
        ) {
          return;
        }
        this.options.hub.sendTerminalClientMessage(args.message.terminalId, {
          type: "output",
          chunk: toTerminalOutputChunk(args.message.chunk),
        });
        return;
      }
      case "terminal.replay":
        this.resolvePendingAttach({
          daemonSessionId: args.sessionId,
          message: args.message,
        });
        this.resolvePendingOutputRead({
          daemonSessionId: args.sessionId,
          message: args.message,
        });
        return;
    }
  }

  handleDaemonSessionClosed(args: HandleDaemonSessionClosedArgs): void {
    this.disconnectDaemonSessionTerminals({ daemonSessionId: args.sessionId });
  }

  private closeThreadTerminalsForLifecycle(
    args: CloseThreadTerminalsForLifecycleArgs,
  ): void {
    const currentSessions = listTerminalSessionsByThread(
      this.options.db,
      args.threadId,
    );
    for (const session of currentSessions) {
      this.disarmTerminalSupervision(session);
    }
    this.requestTerminalCloses({
      closeReason: args.closeReason,
      sessions: currentSessions,
    });
    const exitedSessions = markThreadTerminalSessionsExited(this.options.db, {
      threadId: args.threadId,
      closeReason: args.closeReason,
    });
    this.publishLifecycleTerminalExitsForSessions({
      currentSessions,
      exitedSessions,
      message: args.message,
    });
  }

  private publishLifecycleTerminalExitsForSessions(
    args: PublishLifecycleTerminalExitsForSessionsArgs,
  ): void {
    this.publishLifecycleTerminalExits({
      code: "terminal_closed",
      message: args.message,
      previousSessionsById: new Map(
        args.currentSessions.map((session) => [session.id, session]),
      ),
      sessions: args.exitedSessions,
    });
  }

  private requestTerminalCloses(args: RequestTerminalClosesArgs): void {
    for (const session of args.sessions) {
      const target = getTerminalDaemonCloseTarget(session);
      if (!target) {
        continue;
      }
      this.options.hub.sendDaemonSessionMessage(target.daemonSessionId, {
        type: "terminal.close",
        terminalId: target.terminalId,
        reason: args.closeReason,
      });
    }
  }

  private closeStaleOpenedTerminal(args: CloseStaleOpenedTerminalArgs): void {
    const current = getTerminalSession(this.options.db, {
      terminalId: args.terminalId,
    });
    this.options.hub.sendDaemonSessionMessage(args.daemonSessionId, {
      type: "terminal.close",
      terminalId: args.terminalId,
      reason: current?.closeReason ?? "daemon-disconnect",
    });
  }

  private publishLifecycleTerminalExits(
    args: PublishLifecycleTerminalExitsArgs,
  ): void {
    for (const session of args.sessions) {
      const previousSession = args.previousSessionsById.get(session.id);
      if (previousSession?.daemonSessionId) {
        this.rejectPendingOpenForTerminal({
          daemonSessionId: previousSession.daemonSessionId,
          terminalId: session.id,
          status: 409,
          code: args.code,
          message: args.message,
        });
      }
      this.notifyExitedTerminalSession({
        session,
        code: args.code,
        message: args.message,
      });
    }
  }

  private notifyExitedTerminalSession(
    args: NotifyExitedTerminalSessionArgs,
  ): void {
    this.notifyTerminalSessionChanged(args.session);
    this.options.hub.sendTerminalClientMessage(args.session.id, {
      type: "exited",
      session: toTerminalSession(args.session),
    });
    this.rejectPendingAttachesForTerminal({
      terminalId: args.session.id,
      code: args.code,
      message: args.message,
    });
    this.rejectPendingOutputReadsForTerminal({
      terminalId: args.session.id,
      code: args.code,
      message: args.message,
    });
  }

  private forwardBrowserTerminalInput(
    args: HandleBrowserTerminalMessageArgs,
  ): void {
    if (args.message.type !== "input") {
      return;
    }
    const current = this.getRunningBrowserTerminal(args);
    if (!current) {
      return;
    }
    const markedInput = markTerminalSessionUserInputById(this.options.db, {
      terminalId: current.id,
    });
    if (markedInput) {
      const session = toTerminalSession(markedInput);
      this.notifyTerminalSessionChanged(markedInput);
      this.options.hub.sendTerminalClientMessage(markedInput.id, {
        type: "session-updated",
        session,
      });
    }
    const sent = this.options.hub.sendDaemonSessionMessage(
      current.daemonSessionId,
      {
        type: "terminal.input",
        terminalId: current.id,
        dataBase64: args.message.dataBase64,
      },
    );
    if (!sent) {
      this.sendTerminalSocketError({
        socket: args.socket,
        code: "host_disconnected",
        message: "Host is not connected",
      });
      this.disconnectDaemonSessionTerminals({
        daemonSessionId: current.daemonSessionId,
      });
    }
  }

  private resizeBrowserTerminal(args: HandleBrowserTerminalMessageArgs): void {
    if (
      args.message.type !== "resize" ||
      !this.options.hub.isTerminalResizeOwner(args.terminalId, args.socket)
    ) {
      return;
    }
    const current = this.getRunningBrowserTerminal(args);
    if (!current) {
      return;
    }
    if (
      current.cols !== args.message.cols ||
      current.rows !== args.message.rows
    ) {
      const resized = updateTerminalSessionSizeById(this.options.db, {
        cols: args.message.cols,
        rows: args.message.rows,
        terminalId: current.id,
      });
      if (resized) {
        const session = toTerminalSession(resized);
        this.notifyTerminalSessionChanged(resized);
        this.options.hub.sendTerminalClientMessage(resized.id, {
          type: "session-updated",
          session,
        });
      }
    }
    const sent = this.options.hub.sendDaemonSessionMessage(
      current.daemonSessionId,
      {
        type: "terminal.resize",
        terminalId: current.id,
        cols: args.message.cols,
        rows: args.message.rows,
      },
    );
    if (!sent) {
      this.sendTerminalSocketError({
        socket: args.socket,
        code: "host_disconnected",
        message: "Host is not connected",
      });
      this.disconnectDaemonSessionTerminals({
        daemonSessionId: current.daemonSessionId,
      });
    }
  }

  private getRunningBrowserTerminal(
    args: GetRunningBrowserTerminalArgs,
  ): RunningBrowserTerminalSession | null {
    const current = this.getBrowserTerminalSession(args);
    if (!current) {
      return null;
    }
    if (!isRunningBrowserTerminalSession(current)) {
      this.sendTerminalSocketError({
        socket: args.socket,
        code: "terminal_not_running",
        message: "Terminal session is not running",
      });
      return null;
    }
    return current;
  }

  private getBrowserTerminalSession(
    args: GetBrowserTerminalSessionArgs,
  ): TerminalSessionRow | null {
    let current: TerminalSessionRow | null;
    if (args.threadId === null) {
      current = getTerminalSession(this.options.db, {
        terminalId: args.terminalId,
      });
    } else {
      requirePublicThread(this.options.db, args.threadId);
      current = getTerminalSessionForThread(this.options.db, {
        terminalId: args.terminalId,
        threadId: args.threadId,
      });
    }
    if (!current) {
      if (args.reportMissing !== false) {
        this.sendTerminalSocketError({
          socket: args.socket,
          code: "terminal_not_found",
          message: "Terminal session not found",
        });
      }
      return null;
    }
    return current;
  }

  private disconnectDaemonSessionTerminals(
    args: DisconnectDaemonSessionTerminalsArgs,
  ): void {
    const disconnected = markDaemonTerminalSessionsDisconnected(
      this.options.db,
      {
        daemonSessionId: args.daemonSessionId,
      },
    );
    for (const session of disconnected) {
      this.rejectPendingClose(
        session.id,
        new ApiError(
          502,
          "host_disconnected",
          "Host disconnected while closing terminal session",
        ),
      );
      this.rejectPendingOpenForTerminal({
        daemonSessionId: args.daemonSessionId,
        terminalId: session.id,
        status: 502,
        code: "host_disconnected",
        message: "Host disconnected while opening terminal session",
      });
      this.rejectPendingAttachesForTerminal({
        terminalId: session.id,
        code: "host_disconnected",
        message: "Host disconnected from terminal session",
      });
      this.rejectPendingOutputReadsForTerminal({
        terminalId: session.id,
        code: "host_disconnected",
        message: "Host disconnected from terminal session",
      });
      this.options.logger.info(
        { terminalId: session.id, sessionId: args.daemonSessionId },
        "Terminal session disconnected with daemon session",
      );
      this.notifyTerminalSessionChanged(session);
      this.options.hub.sendTerminalClientMessage(session.id, {
        type: "session-updated",
        session: toTerminalSession(session),
      });
    }
  }

  // Upstream #1353: a daemon close force-kills after two seconds and the
  // server waits five for terminal.exited. If that acknowledgement never
  // arrives, leaving the row daemon-owned makes every client rediscover an
  // unclosable terminal forever, so converge server state instead.
  private finalizeTimedOutTerminalClose(args: {
    closeReason: TerminalSessionCloseReason;
    terminalId: string;
  }): void {
    const current = getTerminalSession(this.options.db, {
      terminalId: args.terminalId,
    });
    if (!current || current.status === "exited") {
      return;
    }
    const exited = markTerminalSessionExited(this.options.db, {
      terminalId: args.terminalId,
      exitCode: current.exitCode,
      closeReason: args.closeReason,
    });
    if (!exited) {
      return;
    }
    this.options.hub.sendTerminalClientMessage(exited.id, {
      type: "session-updated",
      session: toTerminalSession(exited),
    });
  }

  private waitForTerminalClose(args: {
    closeReason: TerminalSessionCloseReason;
    daemonSessionId: string;
    terminalId: string;
  }): { created: boolean; promise: Promise<TerminalSessionRow> } {
    const existing = this.pendingCloses.get(args.terminalId);
    if (existing) {
      return { created: false, promise: existing.promise };
    }

    let resolveClose: (session: TerminalSessionRow) => void = () => {
      throw new Error("Terminal close resolver was not set");
    };
    let rejectClose: (error: Error) => void = () => {
      throw new Error("Terminal close rejecter was not set");
    };
    const promise = new Promise<TerminalSessionRow>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    const timeout = setTimeout(() => {
      this.pendingCloses.delete(args.terminalId);
      this.finalizeTimedOutTerminalClose({
        closeReason: args.closeReason,
        terminalId: args.terminalId,
      });
      rejectClose(
        new ApiError(
          504,
          "terminal_close_timeout",
          "Timed out waiting for terminal process to exit",
        ),
      );
    }, this.closeTimeoutMs);
    this.pendingCloses.set(args.terminalId, {
      closeReason: args.closeReason,
      daemonSessionId: args.daemonSessionId,
      promise,
      reject: rejectClose,
      resolve: resolveClose,
      terminalId: args.terminalId,
      timeout,
    });
    return { created: true, promise };
  }

  private resolvePendingClose(args: {
    daemonSessionId: string;
    session: TerminalSessionRow;
  }): void {
    const pending = this.pendingCloses.get(args.session.id);
    if (!pending || pending.daemonSessionId !== args.daemonSessionId) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingCloses.delete(args.session.id);
    pending.resolve(args.session);
  }

  private rejectPendingClose(terminalId: string, error: Error): void {
    const pending = this.pendingCloses.get(terminalId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingCloses.delete(terminalId);
    pending.reject(error);
  }

  private waitForTerminalOpen(
    args: WaitForTerminalOpenArgs,
  ): Promise<TerminalOpenedMessage> {
    return new Promise<TerminalOpenedMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingOpens.delete(args.requestId);
        reject(
          new ApiError(
            504,
            "terminal_open_timeout",
            "Timed out opening terminal session",
          ),
        );
      }, this.openTimeoutMs);
      this.pendingOpens.set(args.requestId, {
        daemonSessionId: args.daemonSessionId,
        reject,
        resolve,
        timeout,
        terminalId: args.terminalId,
      });
    });
  }

  private waitForTerminalAttach(args: WaitForTerminalAttachArgs): void {
    const timeout = setTimeout(() => {
      this.pendingAttaches.delete(args.requestId);
      this.options.hub.unregisterTerminalClient(args.terminalId, args.socket);
      this.sendTerminalSocketError({
        socket: args.socket,
        code: "terminal_attach_timeout",
        message: "Timed out attaching terminal session",
      });
    }, this.attachTimeoutMs);
    this.pendingAttaches.set(args.requestId, {
      daemonSessionId: args.daemonSessionId,
      socket: args.socket,
      terminalId: args.terminalId,
      threadId: args.threadId,
      timeout,
    });
  }

  private waitForTerminalOutputRead(
    args: WaitForTerminalOutputReadArgs,
  ): Promise<TerminalReplayMessage> {
    return new Promise<TerminalReplayMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingOutputReads.delete(args.requestId);
        reject(
          new ApiError(
            504,
            "terminal_output_timeout",
            "Timed out reading terminal output",
          ),
        );
      }, this.attachTimeoutMs);
      this.pendingOutputReads.set(args.requestId, {
        daemonSessionId: args.daemonSessionId,
        reject,
        resolve,
        terminalId: args.terminalId,
        timeout,
      });
    });
  }

  private cancelPendingOpen(requestId: string): void {
    const pending = this.pendingOpens.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingOpens.delete(requestId);
  }

  private cancelPendingAttach(requestId: string): void {
    const pending = this.pendingAttaches.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingAttaches.delete(requestId);
    this.options.hub.unregisterTerminalClient(
      pending.terminalId,
      pending.socket,
    );
  }

  private cancelPendingOutputRead(requestId: string): void {
    const pending = this.pendingOutputReads.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingOutputReads.delete(requestId);
  }

  private resolvePendingOpen(args: ResolvePendingOpenArgs): void {
    const pending = this.pendingOpens.get(args.message.requestId);
    if (
      !pending ||
      pending.terminalId !== args.message.terminalId ||
      pending.daemonSessionId !== args.daemonSessionId
    ) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingOpens.delete(args.message.requestId);
    pending.resolve(args.message);
  }

  private resolvePendingAttach(args: ResolvePendingAttachArgs): void {
    const pending = this.pendingAttaches.get(args.message.requestId);
    if (
      !pending ||
      pending.terminalId !== args.message.terminalId ||
      pending.daemonSessionId !== args.daemonSessionId
    ) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingAttaches.delete(args.message.requestId);

    const current =
      pending.threadId === null
        ? getTerminalSession(this.options.db, {
            terminalId: pending.terminalId,
          })
        : getTerminalSessionForThread(this.options.db, {
            terminalId: pending.terminalId,
            threadId: pending.threadId,
          });
    if (!current) {
      this.options.hub.unregisterTerminalClient(
        pending.terminalId,
        pending.socket,
      );
      this.sendTerminalSocketError({
        socket: pending.socket,
        code: "terminal_not_found",
        message: "Terminal session not found",
      });
      return;
    }

    // Register only after the daemon's replay boundary has arrived. Registering
    // on socket open lets live output overtake `attached`, then the same bytes
    // arrive again in replay and are rendered twice.
    this.options.hub.registerTerminalClient(current.id, pending.socket);
    this.options.hub.sendTerminalSocketMessage(pending.socket, {
      type: "attached",
      session: toTerminalSession(current),
      replayStartSeq: args.message.replayStartSeq,
      nextSeq: args.message.nextSeq,
    });
    for (const chunk of args.message.chunks) {
      this.options.hub.sendTerminalSocketMessage(pending.socket, {
        type: "output",
        chunk: toTerminalOutputChunk(chunk),
      });
    }
  }

  private resolvePendingOutputRead(args: ResolvePendingOutputReadArgs): void {
    const pending = this.pendingOutputReads.get(args.message.requestId);
    if (
      !pending ||
      pending.terminalId !== args.message.terminalId ||
      pending.daemonSessionId !== args.daemonSessionId
    ) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingOutputReads.delete(args.message.requestId);
    pending.resolve(args.message);
  }

  private rejectPendingOpen(args: RejectPendingOpenArgs): void {
    const pending = this.pendingOpens.get(args.message.requestId);
    if (
      !pending ||
      pending.terminalId !== args.message.terminalId ||
      pending.daemonSessionId !== args.daemonSessionId
    ) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingOpens.delete(args.message.requestId);
    pending.reject(
      new ApiError(
        502,
        args.message.code,
        `Terminal failed to open: ${args.message.message}`,
      ),
    );
  }

  private rejectPendingAttach(args: RejectPendingAttachArgs): void {
    const pending = this.pendingAttaches.get(args.message.requestId);
    if (
      !pending ||
      pending.terminalId !== args.message.terminalId ||
      pending.daemonSessionId !== args.daemonSessionId
    ) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingAttaches.delete(args.message.requestId);
    this.options.hub.unregisterTerminalClient(
      pending.terminalId,
      pending.socket,
    );
    this.sendTerminalSocketError({
      socket: pending.socket,
      code: args.message.code,
      message: args.message.message,
    });
  }

  private rejectPendingOutputReads(args: RejectPendingOutputReadsArgs): void {
    const pending = this.pendingOutputReads.get(args.message.requestId);
    if (
      !pending ||
      pending.terminalId !== args.message.terminalId ||
      pending.daemonSessionId !== args.daemonSessionId
    ) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingOutputReads.delete(args.message.requestId);
    pending.reject(
      new ApiError(
        502,
        args.message.code,
        `Terminal output read failed: ${args.message.message}`,
      ),
    );
  }

  private rejectPendingOpenForTerminal(
    args: RejectPendingOpenForTerminalArgs,
  ): void {
    for (const [requestId, pending] of this.pendingOpens) {
      if (
        pending.daemonSessionId !== args.daemonSessionId ||
        pending.terminalId !== args.terminalId
      ) {
        continue;
      }
      clearTimeout(pending.timeout);
      this.pendingOpens.delete(requestId);
      pending.reject(new ApiError(args.status, args.code, args.message));
    }
  }

  private rejectPendingAttachesForTerminal(
    args: RejectPendingAttachesForTerminalArgs,
  ): void {
    for (const [requestId, pending] of this.pendingAttaches) {
      if (pending.terminalId !== args.terminalId) {
        continue;
      }
      clearTimeout(pending.timeout);
      this.pendingAttaches.delete(requestId);
      this.options.hub.unregisterTerminalClient(
        pending.terminalId,
        pending.socket,
      );
      this.sendTerminalSocketError({
        socket: pending.socket,
        code: args.code,
        message: args.message,
      });
    }
  }

  private rejectPendingOutputReadsForTerminal(
    args: RejectPendingAttachesForTerminalArgs,
  ): void {
    for (const [requestId, pending] of this.pendingOutputReads) {
      if (pending.terminalId !== args.terminalId) {
        continue;
      }
      clearTimeout(pending.timeout);
      this.pendingOutputReads.delete(requestId);
      pending.reject(new ApiError(409, args.code, args.message));
    }
  }

  private sendTerminalSocketError(args: SendTerminalSocketErrorArgs): void {
    this.options.hub.sendTerminalSocketMessage(args.socket, {
      type: "error",
      code: args.code,
      message: args.message,
    });
  }

  private notifyTerminalSessionChanged(
    session: Pick<TerminalSessionRow, "threadId">,
  ): void {
    if (session.threadId !== null) {
      this.options.hub.notifyThread(session.threadId, ["terminals-changed"]);
    }
  }
}
