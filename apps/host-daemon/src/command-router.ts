import type {
  HostDaemonCommand,
  HostDaemonOnlineRpcRequestMessage,
  HostDaemonOnlineRpcResponseMessage,
  HostDaemonOnlineRpcResultForCommand,
  HostDaemonOnlineRpcCommand,
  HostDaemonCommandResultForCommand,
  HostDaemonRpcCommand,
  HostDaemonRpcResultForCommand,
  HostDaemonCommandEnvironmentLane,
} from "@bb/host-daemon-contract";
import type { ThreadEvent } from "@bb/domain";
import { performance } from "node:perf_hooks";
import {
  hostDaemonEnvironmentLaneForCommand,
  hostDaemonOnlineRpcResponseMessageSchema,
  isHostDaemonCommand,
  parseHostDaemonCommandResultForCommand,
  parseHostDaemonOnlineRpcResultForCommand,
  shouldFlushEventsBeforeReportingCommandResult,
} from "@bb/host-daemon-contract";
import {
  dispatchCommand,
  dispatchOnlineRpcCommand,
  getErrorCode,
  type CommandDispatchOptions,
} from "./command-dispatch.js";
import { isExpectedOnlineRpcFailureError } from "./command-dispatch-support.js";
import type { HostDaemonLogger } from "./logger.js";
import { RuntimeManager } from "./runtime-manager.js";
import {
  RequestLatencyTracker,
  type RequestLatencyStage,
} from "./request-latency-tracker.js";

interface CommandRouterLogger extends Pick<HostDaemonLogger, "warn"> {
  debug?: HostDaemonLogger["debug"];
}

type EnvironmentLaneMode = HostDaemonCommandEnvironmentLane;
type WorkspaceStatusCommand = Extract<
  HostDaemonOnlineRpcCommand,
  { type: "workspace.status" }
>;
type WorkspaceStatusResult =
  HostDaemonOnlineRpcResultForCommand<WorkspaceStatusCommand>;
type ThreadStartCommand = Extract<HostDaemonCommand, { type: "thread.start" }>;
type ThreadStopCommand = Extract<HostDaemonCommand, { type: "thread.stop" }>;
type TurnSubmitCommand = Extract<HostDaemonCommand, { type: "turn.submit" }>;
type ThreadStartOrTurnSubmitCommand = ThreadStartCommand | TurnSubmitCommand;

interface ReadWriteLaneState {
  /** All admitted read and write work. Writes wait on this tail. */
  tail: Promise<void>;
  /** Last admitted write. Reads wait on this tail, then join `tail`. */
  writeTail: Promise<void>;
}

interface ReadWriteLaneArgs<T> {
  key: string;
  lanes: Map<string, ReadWriteLaneState>;
  mode: EnvironmentLaneMode;
  work: () => Promise<T>;
}

interface SerialLaneArgs<T> {
  key: string;
  lanes: Map<string, Promise<void>>;
  work: () => Promise<T>;
}

interface ReadWriteLaneIdleArgs {
  key: string;
  lanes: Map<string, ReadWriteLaneState>;
  state: ReadWriteLaneState;
  tail: Promise<void>;
}

interface ProviderExecutionLane {
  processKey: string;
  processMode: EnvironmentLaneMode;
  sessionKey: string;
}

interface ProviderProcessLaneKeyArgs {
  environmentId: string;
  providerId: string | null;
  threadId: string;
}

interface CreateProviderExecutionLaneArgs extends ProviderProcessLaneKeyArgs {
  processMode: EnvironmentLaneMode;
  sessionId: string;
}

interface ThreadProviderLaneIdentity {
  environmentId: string;
  providerId: string | null;
  providerThreadId: string | null;
  threadId: string;
}

interface ThreadProviderLaneTarget {
  environmentId: string;
  threadId: string;
}

interface InFlightThreadProviderLane {
  count: number;
  lane: ProviderExecutionLane;
}

interface WorkspaceStatusRefreshState {
  current: WorkspaceStatusRefreshTask;
  trailing: WorkspaceStatusRefreshTask | null;
}

interface WorkspaceStatusRefreshTask {
  abortController: AbortController;
  promise: Promise<WorkspaceStatusResult>;
  waiterCount: number;
}

type CommandRouterTask = Promise<HostDaemonCommandResultForCommand>;

export interface CommandRouterOptions {
  dataDir: CommandDispatchOptions["dataDir"];
  fetchProjectAttachment: CommandDispatchOptions["fetchProjectAttachment"];
  fetchSkillTree?: CommandDispatchOptions["fetchSkillTree"];
  runtimeManager: RuntimeManager;
  terminalManager?: CommandDispatchOptions["terminalManager"];
  eventSink: CommandDispatchOptions["eventSink"];
  listModels?: CommandDispatchOptions["listModels"];
  resolveInteractiveRequest?: CommandDispatchOptions["resolveInteractiveRequest"];
  caffeinateManager?: CommandDispatchOptions["caffeinateManager"];
  ensureConnectTunnelIdentity?: CommandDispatchOptions["ensureConnectTunnelIdentity"];
  simulatorManager?: CommandDispatchOptions["simulatorManager"];
  threadStorageRootPath: string;
  logger: CommandRouterLogger;
  onForegroundDispatchStateChange?: (active: boolean) => void;
}

const HOST_COMMAND_LIFECYCLE_LOG_THRESHOLD_MS = 1_000;
const CODEX_PROVIDER_ID = "codex";
const MAX_CONCURRENT_WORKSPACE_STATUS_REFRESHES = 4;
const MAX_CONCURRENT_WORKSPACE_STATUS_REFRESHES_PER_ENVIRONMENT = 1;
const FOREGROUND_LATENCY_WARNING_MS = 5_000;
const FOREGROUND_ACCEPTANCE_STALL_MS = 30_000;
const REQUEST_LATENCY_LIMITS = {
  "accept-to-first-activity": { p95Ms: 1_000, p99Ms: 3_000 },
  "request-to-accept": { p95Ms: 2_000, p99Ms: 5_000 },
} satisfies Record<RequestLatencyStage, { p95Ms: number; p99Ms: number }>;

function roundDurationMs(durationMs: number): number {
  return Math.round(durationMs * 10) / 10;
}

function elapsedMs(startedAtMs: number): number {
  return performance.now() - startedAtMs;
}

function isFirstVisibleProviderActivity(event: ThreadEvent): boolean {
  return (
    event.type === "item/started" ||
    event.type === "item/agentMessage/delta" ||
    event.type === "item/commandExecution/outputDelta" ||
    event.type === "item/fileChange/outputDelta" ||
    event.type === "item/reasoning/summaryTextDelta" ||
    event.type === "item/reasoning/textDelta" ||
    event.type === "item/plan/delta" ||
    event.type === "item/mcpToolCall/progress" ||
    event.type === "item/toolCall/progress" ||
    event.type === "provider/error" ||
    event.type === "provider/unhandled" ||
    event.type === "turn/completed"
  );
}

export class CommandRouter {
  private readonly logger;
  private readonly requestLatencyTracker = new RequestLatencyTracker();
  private readonly environmentLanes = new Map<string, ReadWriteLaneState>();
  private readonly workspaceStatusRefreshes = new Map<
    string,
    WorkspaceStatusRefreshState
  >();
  private activeWorkspaceStatusRefreshes = 0;
  private activeForegroundDispatches = 0;
  private backgroundPaused = false;
  private readonly activeWorkspaceStatusRefreshesByEnvironment = new Map<
    string,
    number
  >();
  private readonly workspaceStatusRefreshQueueByEnvironment = new Map<
    string,
    Array<() => void>
  >();
  private readonly workspaceStatusRefreshEnvironmentQueue: string[] = [];
  private readonly onlineRpcAbortControllers = new Map<
    string,
    AbortController
  >();
  // Per-thread barrier keyed by threadId. A turn submission
  // (turn.submit/thread.start) waits for an in-flight thread.unarchive of the
  // same thread so it cannot resume a still-archived provider session.
  private readonly threadUnarchiveBarriers = new Map<string, Promise<void>>();
  // Provider process lanes protect commands that share one provider process,
  // while session lanes serialize commands for one provider thread/session.
  private readonly providerProcessLanes = new Map<string, ReadWriteLaneState>();
  private readonly providerSessionLaneTails = new Map<string, Promise<void>>();
  private readonly threadTurnLaneTails = new Map<string, Promise<void>>();
  private readonly inFlightThreadProviderLanes = new Map<
    string,
    InFlightThreadProviderLane
  >();

  constructor(private readonly options: CommandRouterOptions) {
    this.logger = options.logger;
  }

  setBackgroundPaused(paused: boolean): void {
    this.backgroundPaused = paused;
    if (!paused) this.drainWorkspaceStatusRefreshQueue();
  }

  async handleOnlineRpcRequest(
    message: HostDaemonOnlineRpcRequestMessage,
  ): Promise<HostDaemonOnlineRpcResponseMessage> {
    const handlerStartedAtMs = performance.now();
    const abortController = new AbortController();
    this.onlineRpcAbortControllers.set(message.requestId, abortController);
    try {
      const result = await this.executeHostRpcCommand(
        message.command,
        abortController.signal,
      );
      this.logOnlineRpc({
        commandType: message.command.type,
        handlerMs: elapsedMs(handlerStartedAtMs),
        ok: true,
      });
      return hostDaemonOnlineRpcResponseMessageSchema.parse({
        type: "host-rpc.response",
        requestId: message.requestId,
        commandType: message.command.type,
        ok: true,
        result,
      });
    } catch (error) {
      const errorCode = getErrorCode(error);
      if (!isExpectedOnlineRpcFailureError(error)) {
        this.logger.warn(
          {
            type: message.command.type,
            err: error,
          },
          "online host RPC failed",
        );
      }
      this.logOnlineRpc({
        commandType: message.command.type,
        errorCode,
        handlerMs: elapsedMs(handlerStartedAtMs),
        ok: false,
      });
      return {
        type: "host-rpc.response",
        requestId: message.requestId,
        commandType: message.command.type,
        ok: false,
        errorCode,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (
        this.onlineRpcAbortControllers.get(message.requestId) ===
        abortController
      ) {
        this.onlineRpcAbortControllers.delete(message.requestId);
      }
    }
  }

  cancelOnlineRpcRequest(requestId: string): void {
    this.onlineRpcAbortControllers
      .get(requestId)
      ?.abort(new Error("Online host RPC request was cancelled"));
  }

  private executeHostRpcCommand(
    command: HostDaemonRpcCommand,
    signal: AbortSignal,
  ): Promise<HostDaemonRpcResultForCommand> {
    if (isHostDaemonCommand(command)) {
      return this.executeLiveDaemonCommand(command);
    }
    return this.executeOnlineRpcCommand(command, signal);
  }

  private executeOnlineRpcCommand(
    command: HostDaemonOnlineRpcCommand,
    signal: AbortSignal,
  ): Promise<HostDaemonOnlineRpcResultForCommand> {
    if (command.type === "workspace.status") {
      return this.runWorkspaceStatusRefresh(command, signal);
    }
    const environmentLaneMode = this.getEnvironmentLaneMode(command);
    const result =
      environmentLaneMode && "environmentId" in command
        ? this.runInEnvironmentLane(
            command.environmentId,
            environmentLaneMode,
            () =>
              dispatchOnlineRpcCommand(
                command,
                this.createDispatchOptions(undefined, signal),
              ),
          )
        : dispatchOnlineRpcCommand(
            command,
            this.createDispatchOptions(undefined, signal),
          );
    return result.then((value) =>
      parseHostDaemonOnlineRpcResultForCommand(command, value),
    );
  }

  private runWorkspaceStatusRefresh(
    command: WorkspaceStatusCommand,
    signal: AbortSignal,
  ): Promise<WorkspaceStatusResult> {
    const key = `${command.environmentId}\0${command.mergeBaseBranch ?? ""}`;
    const existing = this.workspaceStatusRefreshes.get(key);
    if (existing?.trailing) {
      return this.waitForWorkspaceStatusRefresh(existing.trailing, signal);
    }

    const run = (workSignal: AbortSignal) => {
      if (workSignal.aborted) {
        return Promise.reject(
          workSignal.reason instanceof Error
            ? workSignal.reason
            : new Error("Online host RPC request was cancelled"),
        );
      }
      return this.runWithWorkspaceStatusSlot(command.environmentId, () =>
        this.runInEnvironmentLane(command.environmentId, "read", () =>
          dispatchOnlineRpcCommand(
            command,
            this.createDispatchOptions(undefined, workSignal),
          ),
        ).then((value) =>
          parseHostDaemonOnlineRpcResultForCommand(command, value),
        ),
      );
    };

    if (!existing) {
      const current = this.createWorkspaceStatusRefreshTask(run);
      const state: WorkspaceStatusRefreshState = { current, trailing: null };
      this.workspaceStatusRefreshes.set(key, state);
      this.deleteWorkspaceStatusRefreshWhenIdle(key, state, current);
      return this.waitForWorkspaceStatusRefresh(current, signal);
    }

    const trailingAbortController = new AbortController();
    const trailing: WorkspaceStatusRefreshTask = {
      abortController: trailingAbortController,
      waiterCount: 0,
      promise: existing.current.promise
        .catch(() => undefined)
        .then(() => {
          existing.current = trailing;
          existing.trailing = null;
          return run(trailingAbortController.signal);
        }),
    };
    existing.trailing = trailing;
    this.deleteWorkspaceStatusRefreshWhenIdle(key, existing, trailing);
    return this.waitForWorkspaceStatusRefresh(trailing, signal);
  }

  private createWorkspaceStatusRefreshTask(
    work: (signal: AbortSignal) => Promise<WorkspaceStatusResult>,
  ): WorkspaceStatusRefreshTask {
    const abortController = new AbortController();
    return {
      abortController,
      promise: work(abortController.signal),
      waiterCount: 0,
    };
  }

  private waitForWorkspaceStatusRefresh(
    task: WorkspaceStatusRefreshTask,
    signal: AbortSignal,
  ): Promise<WorkspaceStatusResult> {
    task.waiterCount += 1;
    return new Promise<WorkspaceStatusResult>((resolve, reject) => {
      let settled = false;
      const finish = (): boolean => {
        if (settled) return false;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        task.waiterCount -= 1;
        return true;
      };
      const onAbort = () => {
        if (!finish()) return;
        if (task.waiterCount === 0) {
          task.abortController.abort(signal.reason);
        }
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Online host RPC request was cancelled"),
        );
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      void task.promise.then(
        (result) => {
          if (finish()) resolve(result);
        },
        (error: unknown) => {
          if (finish()) reject(error);
        },
      );
    });
  }

  private async runWithWorkspaceStatusSlot<T>(
    environmentId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    await this.acquireWorkspaceStatusSlot(environmentId);
    try {
      return await work();
    } finally {
      this.releaseWorkspaceStatusSlot(environmentId);
    }
  }

  private acquireWorkspaceStatusSlot(environmentId: string): Promise<void> {
    const environmentActiveCount =
      this.activeWorkspaceStatusRefreshesByEnvironment.get(environmentId) ?? 0;
    if (
      !this.backgroundPaused &&
      this.activeForegroundDispatches === 0 &&
      this.workspaceStatusRefreshEnvironmentQueue.length === 0 &&
      this.activeWorkspaceStatusRefreshes <
        MAX_CONCURRENT_WORKSPACE_STATUS_REFRESHES &&
      environmentActiveCount <
        MAX_CONCURRENT_WORKSPACE_STATUS_REFRESHES_PER_ENVIRONMENT
    ) {
      this.admitWorkspaceStatusRefresh(environmentId);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const queue =
        this.workspaceStatusRefreshQueueByEnvironment.get(environmentId) ?? [];
      if (queue.length === 0) {
        this.workspaceStatusRefreshEnvironmentQueue.push(environmentId);
      }
      queue.push(resolve);
      this.workspaceStatusRefreshQueueByEnvironment.set(environmentId, queue);
      this.drainWorkspaceStatusRefreshQueue();
    });
  }

  private admitWorkspaceStatusRefresh(environmentId: string): void {
    this.activeWorkspaceStatusRefreshes += 1;
    this.activeWorkspaceStatusRefreshesByEnvironment.set(
      environmentId,
      (this.activeWorkspaceStatusRefreshesByEnvironment.get(environmentId) ??
        0) + 1,
    );
  }

  private releaseWorkspaceStatusSlot(environmentId: string): void {
    this.activeWorkspaceStatusRefreshes -= 1;
    const environmentActiveCount =
      (this.activeWorkspaceStatusRefreshesByEnvironment.get(environmentId) ??
        1) - 1;
    if (environmentActiveCount === 0) {
      this.activeWorkspaceStatusRefreshesByEnvironment.delete(environmentId);
    } else {
      this.activeWorkspaceStatusRefreshesByEnvironment.set(
        environmentId,
        environmentActiveCount,
      );
    }
    this.drainWorkspaceStatusRefreshQueue();
  }

  private drainWorkspaceStatusRefreshQueue(): void {
    if (this.backgroundPaused || this.activeForegroundDispatches > 0) return;
    let remainingEnvironmentChecks =
      this.workspaceStatusRefreshEnvironmentQueue.length;
    while (
      this.activeWorkspaceStatusRefreshes <
        MAX_CONCURRENT_WORKSPACE_STATUS_REFRESHES &&
      remainingEnvironmentChecks > 0
    ) {
      const environmentId = this.workspaceStatusRefreshEnvironmentQueue.shift();
      if (environmentId === undefined) return;
      remainingEnvironmentChecks -= 1;
      const environmentActiveCount =
        this.activeWorkspaceStatusRefreshesByEnvironment.get(environmentId) ??
        0;
      const queue =
        this.workspaceStatusRefreshQueueByEnvironment.get(environmentId);
      if (queue === undefined || queue.length === 0) {
        this.workspaceStatusRefreshQueueByEnvironment.delete(environmentId);
        continue;
      }
      if (
        environmentActiveCount >=
        MAX_CONCURRENT_WORKSPACE_STATUS_REFRESHES_PER_ENVIRONMENT
      ) {
        this.workspaceStatusRefreshEnvironmentQueue.push(environmentId);
        continue;
      }
      const resolve = queue.shift();
      if (queue.length === 0) {
        this.workspaceStatusRefreshQueueByEnvironment.delete(environmentId);
      } else {
        this.workspaceStatusRefreshEnvironmentQueue.push(environmentId);
      }
      this.admitWorkspaceStatusRefresh(environmentId);
      resolve?.();
      remainingEnvironmentChecks =
        this.workspaceStatusRefreshEnvironmentQueue.length;
    }
  }

  private deleteWorkspaceStatusRefreshWhenIdle(
    key: string,
    state: WorkspaceStatusRefreshState,
    refresh: WorkspaceStatusRefreshTask,
  ): void {
    void refresh.promise.then(
      () => {
        if (state.current === refresh && state.trailing === null) {
          this.workspaceStatusRefreshes.delete(key);
        }
      },
      () => {
        if (state.current === refresh && state.trailing === null) {
          this.workspaceStatusRefreshes.delete(key);
        }
      },
    );
  }

  private executeLiveDaemonCommand(
    command: HostDaemonCommand,
  ): Promise<HostDaemonCommandResultForCommand> {
    const isForeground =
      command.type === "thread.start" || command.type === "turn.submit";
    if (isForeground) this.setForegroundDispatchActive(true);
    const receivedAtMs = performance.now();
    const dispatchWarning = isForeground
      ? setTimeout(() => {
          this.logger.warn(
            {
              activeWorkspaceStatusRefreshes:
                this.activeWorkspaceStatusRefreshes,
              commandType: command.type,
              queueDepth: this.workspaceStatusRefreshEnvironmentQueue.length,
              waitMs: Math.round(elapsedMs(receivedAtMs)),
            },
            "Foreground command is waiting for host dispatch",
          );
        }, FOREGROUND_LATENCY_WARNING_MS)
      : null;
    dispatchWarning?.unref();
    const environmentLaneMode = this.getEnvironmentLaneMode(command);
    const providerLane = this.resolveProviderLane(command);
    const task = this.runAfterThreadUnarchiveBarrier(command, () =>
      this.runInThreadTurnLane(command, () =>
        this.runInExecutionLanes(
          command,
          environmentLaneMode,
          providerLane,
          () => {
            if (dispatchWarning) clearTimeout(dispatchWarning);
            return this.executeLiveDaemonCommandBody(command, receivedAtMs);
          },
        ),
      ),
    );
    this.registerThreadUnarchiveBarrier(command, task);
    this.registerInFlightThreadProviderLane(command, task);
    return isForeground
      ? task.finally(() => {
          if (dispatchWarning) clearTimeout(dispatchWarning);
          this.setForegroundDispatchActive(false);
        })
      : task;
  }

  private setForegroundDispatchActive(active: boolean): void {
    this.activeForegroundDispatches += active ? 1 : -1;
    if (this.activeForegroundDispatches < 0)
      this.activeForegroundDispatches = 0;
    this.options.onForegroundDispatchStateChange?.(
      this.activeForegroundDispatches > 0,
    );
    if (this.activeForegroundDispatches === 0) {
      this.drainWorkspaceStatusRefreshQueue();
    }
  }

  private async executeLiveDaemonCommandBody(
    command: HostDaemonCommand,
    receivedAtMs: number,
  ): Promise<HostDaemonCommandResultForCommand> {
    if (command.type !== "thread.start" && command.type !== "turn.submit") {
      const result = await dispatchCommand(
        command,
        this.createDispatchOptions(),
      );
      if (shouldFlushEventsBeforeReportingCommandResult(command)) {
        await this.options.eventSink.flush();
      }
      return parseHostDaemonCommandResultForCommand(command, result);
    }
    const dispatchAtMs = performance.now();
    const providerId =
      command.type === "thread.start"
        ? command.providerId
        : command.resumeContext.providerId;
    const runtimeWasReady =
      this.options.runtimeManager.get(command.environmentId) !== undefined;
    let acceptedAtMs: number | null = null;
    let firstActivityRecorded = false;
    const logLatency = (
      message: string,
      durationMs: number,
      limitMs: number,
    ): void => {
      const fields = {
        commandType: command.type,
        durationMs: roundDurationMs(durationMs),
        providerId,
        queueDepth: this.workspaceStatusRefreshEnvironmentQueue.length,
        runtimeWasReady,
      };
      if (durationMs > limitMs) this.logger.warn(fields, message);
      else this.logger.debug?.(fields, message);
    };
    const recordLatency = (
      stage: RequestLatencyStage,
      durationMs: number,
    ): void => {
      const percentiles = this.requestLatencyTracker.record({
        durationMs,
        providerId,
        runtimeWasReady,
        stage,
      });
      if (!percentiles) return;
      const limits = REQUEST_LATENCY_LIMITS[stage];
      if (
        percentiles.p95Ms <= limits.p95Ms &&
        percentiles.p99Ms <= limits.p99Ms
      ) {
        return;
      }
      this.logger.warn(
        {
          ...percentiles,
          providerId,
          queueDepth: this.workspaceStatusRefreshEnvironmentQueue.length,
          runtimeWasReady,
          stage,
        },
        "Provider latency percentile limit exceeded",
      );
    };
    const acceptanceWarning = setTimeout(() => {
      logLatency(
        "Provider acceptance exceeded the warning limit",
        elapsedMs(receivedAtMs),
        0,
      );
    }, FOREGROUND_LATENCY_WARNING_MS);
    acceptanceWarning.unref();
    const acceptanceStall = setTimeout(() => {
      logLatency(
        "Provider acceptance remains pending; background work stays paused",
        elapsedMs(receivedAtMs),
        0,
      );
    }, FOREGROUND_ACCEPTANCE_STALL_MS);
    acceptanceStall.unref();
    const dispatchDelayMs = dispatchAtMs - receivedAtMs;
    logLatency(
      "Foreground host dispatch latency",
      dispatchDelayMs,
      FOREGROUND_LATENCY_WARNING_MS,
    );
    const onEvent = (event: { event: ThreadEvent; threadId: string }): void => {
      if (event.threadId !== command.threadId) return;
      if (
        event.event.type === "turn/input/accepted" &&
        event.event.clientRequestId === command.requestId
      ) {
        acceptedAtMs = performance.now();
        clearTimeout(acceptanceWarning);
        clearTimeout(acceptanceStall);
        logLatency(
          "Host request-to-provider-acceptance latency",
          acceptedAtMs - receivedAtMs,
          5_000,
        );
        recordLatency("request-to-accept", acceptedAtMs - receivedAtMs);
        return;
      }
      if (
        acceptedAtMs !== null &&
        !firstActivityRecorded &&
        isFirstVisibleProviderActivity(event.event)
      ) {
        firstActivityRecorded = true;
        const firstActivityMs = performance.now() - acceptedAtMs;
        logLatency(
          "Provider acceptance-to-first-activity latency",
          firstActivityMs,
          3_000,
        );
        recordLatency("accept-to-first-activity", firstActivityMs);
      }
    };
    let result: unknown;
    try {
      result = await dispatchCommand(
        command,
        this.createDispatchOptions(onEvent),
      );
    } finally {
      clearTimeout(acceptanceWarning);
      clearTimeout(acceptanceStall);
    }
    // Commands that emit thread events before completing preserve the previous
    // event-before-result ordering under live RPC.
    if (shouldFlushEventsBeforeReportingCommandResult(command)) {
      await this.options.eventSink.flush();
    }
    return parseHostDaemonCommandResultForCommand(command, result);
  }

  private runInEnvironmentLane<T>(
    environmentId: string,
    mode: EnvironmentLaneMode,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.runInReadWriteLane({
      key: environmentId,
      lanes: this.environmentLanes,
      mode,
      work,
    });
  }

  private runInExecutionLanes<T>(
    command: HostDaemonCommand,
    environmentLaneMode: EnvironmentLaneMode | null,
    providerLane: ProviderExecutionLane | null,
    work: () => Promise<T>,
  ): Promise<T> {
    const providerWork = providerLane
      ? () => this.runInProviderLane(providerLane, work)
      : work;
    if (!environmentLaneMode) {
      return providerWork();
    }
    if (!("environmentId" in command) || !command.environmentId) {
      throw new Error(`Command ${command.type} is missing environmentId`);
    }
    return this.runInEnvironmentLane(
      command.environmentId,
      environmentLaneMode,
      providerWork,
    );
  }

  private runInThreadTurnLane<T>(
    command: HostDaemonCommand,
    work: () => Promise<T>,
  ): Promise<T> {
    if (command.type !== "thread.start" && command.type !== "turn.submit") {
      return work();
    }
    return this.runInSerialLane({
      key: command.threadId,
      lanes: this.threadTurnLaneTails,
      work,
    });
  }

  private runInProviderLane<T>(
    lane: ProviderExecutionLane,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.runInProviderProcessLane(
      lane.processKey,
      lane.processMode,
      () => this.runInProviderSessionLane(lane.sessionKey, work),
    );
  }

  private createDispatchOptions(
    onEvent?: (event: { event: ThreadEvent; threadId: string }) => void,
    signal?: AbortSignal,
  ): CommandDispatchOptions {
    return {
      signal,
      fetchProjectAttachment: this.options.fetchProjectAttachment,
      fetchSkillTree: this.options.fetchSkillTree,
      runtimeManager: this.options.runtimeManager,
      terminalManager: this.options.terminalManager,
      dataDir: this.options.dataDir,
      eventSink: onEvent
        ? {
            emit: (event) => {
              onEvent(event);
              this.options.eventSink.emit(event);
            },
            flush: () => this.options.eventSink.flush(),
          }
        : this.options.eventSink,
      listModels: this.options.listModels,
      resolveInteractiveRequest: this.options.resolveInteractiveRequest,
      caffeinateManager: this.options.caffeinateManager,
      ensureConnectTunnelIdentity: this.options.ensureConnectTunnelIdentity,
      simulatorManager: this.options.simulatorManager,
      threadStorageRootPath: this.options.threadStorageRootPath,
    };
  }

  private logOnlineRpc(args: {
    commandType: HostDaemonRpcCommand["type"];
    errorCode?: string;
    handlerMs: number;
    ok: boolean;
  }): void {
    const shouldLog =
      args.handlerMs >= HOST_COMMAND_LIFECYCLE_LOG_THRESHOLD_MS || !args.ok;
    if (!shouldLog) {
      return;
    }

    this.logger.debug?.(
      {
        commandType: args.commandType,
        ...(args.errorCode ? { errorCode: args.errorCode } : {}),
        handlerMs: roundDurationMs(args.handlerMs),
        ok: args.ok,
      },
      "Online host RPC",
    );
  }

  private getOrCreateReadWriteLane(
    key: string,
    lanes: Map<string, ReadWriteLaneState>,
  ): ReadWriteLaneState {
    const existing = lanes.get(key);
    if (existing) {
      return existing;
    }
    const resolved = Promise.resolve();
    const state: ReadWriteLaneState = {
      tail: resolved,
      writeTail: resolved,
    };
    lanes.set(key, state);
    return state;
  }

  /**
   * Order a turn submission after any in-flight unarchive for the same thread.
   * thread.unarchive runs on the provider maintenance runtime while turn.submit
   * resumes the thread runtime, so the two are otherwise unordered and a turn
   * can reach the provider before the session is unarchived.
   */
  private async runAfterThreadUnarchiveBarrier<T>(
    command: HostDaemonCommand,
    work: () => Promise<T>,
  ): Promise<T> {
    if (command.type === "turn.submit" || command.type === "thread.start") {
      const barrier = this.threadUnarchiveBarriers.get(command.threadId);
      if (barrier) {
        await barrier;
      }
    }
    return work();
  }

  private registerThreadUnarchiveBarrier(
    command: HostDaemonCommand,
    task: CommandRouterTask,
  ): void {
    if (command.type !== "thread.unarchive") {
      return;
    }
    const { threadId } = command;
    const barrier = task.then(
      () => undefined,
      () => undefined,
    );
    this.threadUnarchiveBarriers.set(threadId, barrier);
    void barrier.then(() => {
      if (this.threadUnarchiveBarriers.get(threadId) === barrier) {
        this.threadUnarchiveBarriers.delete(threadId);
      }
    });
  }

  private runInProviderProcessLane<T>(
    key: string,
    mode: EnvironmentLaneMode,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.runInReadWriteLane({
      key,
      lanes: this.providerProcessLanes,
      mode,
      work,
    });
  }

  private runInProviderSessionLane<T>(
    key: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.runInSerialLane({
      key,
      lanes: this.providerSessionLaneTails,
      work,
    });
  }

  private runInSerialLane<T>({
    key,
    lanes,
    work,
  }: SerialLaneArgs<T>): Promise<T> {
    const previousTail = lanes.get(key) ?? Promise.resolve();
    const next = previousTail.catch(() => undefined).then(work);
    const done = next.then(
      () => undefined,
      () => undefined,
    );
    lanes.set(key, done);
    void done.then(() => {
      if (lanes.get(key) === done) {
        lanes.delete(key);
      }
    });
    return next;
  }

  private runInReadWriteLane<T>({
    key,
    lanes,
    mode,
    work,
  }: ReadWriteLaneArgs<T>): Promise<T> {
    const state = this.getOrCreateReadWriteLane(key, lanes);
    if (mode === "read") {
      const previousWrite = state.writeTail;
      const next = previousWrite.catch(() => undefined).then(work);
      const done = next.then(
        () => undefined,
        () => undefined,
      );
      const previousTail = state.tail;
      // Reads only wait for earlier writes, so adjacent reads can run together.
      // They still join the full tail so later writes wait for every active read.
      const tail = Promise.all([
        previousTail.catch(() => undefined),
        done,
      ]).then(() => undefined);
      state.tail = tail;
      this.deleteReadWriteLaneWhenIdle({ key, lanes, state, tail });
      return next;
    }

    const next = state.tail.catch(() => undefined).then(work);
    const done = next.then(
      () => undefined,
      () => undefined,
    );
    state.tail = done;
    state.writeTail = done;
    this.deleteReadWriteLaneWhenIdle({ key, lanes, state, tail: done });
    return next;
  }

  private deleteReadWriteLaneWhenIdle({
    key,
    lanes,
    state,
    tail,
  }: ReadWriteLaneIdleArgs): void {
    void tail.then(() => {
      if (lanes.get(key) === state && state.tail === tail) {
        lanes.delete(key);
      }
    });
  }

  private getProviderProcessLaneKey(args: ProviderProcessLaneKeyArgs): string {
    // Legacy or thread.stop paths can lack provider ownership. Bucket them
    // together per environment so unknown ownership stays conservative without
    // serializing unrelated environments.
    const providerKey = args.providerId ?? "unknown-provider";
    if (providerKey !== CODEX_PROVIDER_ID) {
      return `${args.environmentId}\0${providerKey}`;
    }
    return `${args.environmentId}\0${providerKey}\0thread:${args.threadId}`;
  }

  private getProviderSessionLaneKey(
    processKey: string,
    sessionId: string,
  ): string {
    return `${processKey}\0${sessionId}`;
  }

  private createProviderExecutionLane(
    args: CreateProviderExecutionLaneArgs,
  ): ProviderExecutionLane {
    const processKey = this.getProviderProcessLaneKey({
      environmentId: args.environmentId,
      providerId: args.providerId,
      threadId: args.threadId,
    });
    return {
      processKey,
      processMode: args.processMode,
      sessionKey: this.getProviderSessionLaneKey(processKey, args.sessionId),
    };
  }

  private getThreadProviderLaneIdentityKey(
    args: ThreadProviderLaneTarget,
  ): string {
    return `${args.environmentId}\0${args.threadId}`;
  }

  private createThreadProviderExecutionLane(
    identity: ThreadProviderLaneIdentity,
    processMode: EnvironmentLaneMode,
  ): ProviderExecutionLane {
    const sessionId =
      identity.providerThreadId === null
        ? `thread:${identity.threadId}`
        : `provider-thread:${identity.providerThreadId}`;
    return this.createProviderExecutionLane({
      environmentId: identity.environmentId,
      processMode,
      providerId: identity.providerId,
      sessionId,
      threadId: identity.threadId,
    });
  }

  private createInFlightThreadStopLane(
    command: ThreadStartOrTurnSubmitCommand,
  ): ProviderExecutionLane {
    if (command.type === "thread.start") {
      return this.createThreadProviderExecutionLane(
        {
          environmentId: command.environmentId,
          providerId: command.providerId,
          providerThreadId: null,
          threadId: command.threadId,
        },
        "write",
      );
    }

    return this.createThreadProviderExecutionLane(
      {
        environmentId: command.environmentId,
        providerId: command.resumeContext.providerId,
        providerThreadId: command.resumeContext.providerThreadId,
        threadId: command.threadId,
      },
      "write",
    );
  }

  private getInFlightThreadStopProviderLane(
    command: ThreadStopCommand,
  ): ProviderExecutionLane | null {
    const entry = this.inFlightThreadProviderLanes.get(
      this.getThreadProviderLaneIdentityKey(command),
    );
    return entry?.lane ?? null;
  }

  private registerInFlightThreadProviderLane(
    command: HostDaemonCommand,
    task: CommandRouterTask,
  ): void {
    if (command.type !== "thread.start" && command.type !== "turn.submit") {
      return;
    }

    const key = this.getThreadProviderLaneIdentityKey(command);
    const existing = this.inFlightThreadProviderLanes.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      this.inFlightThreadProviderLanes.set(key, {
        count: 1,
        lane: this.createInFlightThreadStopLane(command),
      });
    }

    void task.then(
      () => this.unregisterInFlightThreadProviderLane(key),
      () => this.unregisterInFlightThreadProviderLane(key),
    );
  }

  private unregisterInFlightThreadProviderLane(key: string): void {
    const existing = this.inFlightThreadProviderLanes.get(key);
    if (!existing) {
      return;
    }
    if (existing.count > 1) {
      existing.count -= 1;
      return;
    }
    this.inFlightThreadProviderLanes.delete(key);
  }

  private resolveProviderLane(
    command: HostDaemonCommand,
  ): ProviderExecutionLane | null {
    switch (command.type) {
      case "thread.start":
        return this.createProviderExecutionLane({
          environmentId: command.environmentId,
          processMode: "read",
          providerId: command.providerId,
          sessionId: `thread:${command.threadId}`,
          threadId: command.threadId,
        });
      case "turn.submit":
        return this.createProviderExecutionLane({
          environmentId: command.environmentId,
          processMode: "read",
          providerId: command.resumeContext.providerId,
          sessionId: `provider-thread:${command.resumeContext.providerThreadId}`,
          threadId: command.threadId,
        });
      case "thread.archive":
        return this.createProviderExecutionLane({
          environmentId: command.environmentId,
          processMode: "read",
          providerId: command.providerId,
          sessionId: `provider-thread:${command.providerThreadId}`,
          threadId: command.threadId,
        });
      case "interactive.resolve":
        return this.createProviderExecutionLane({
          environmentId: command.environmentId,
          processMode: "read",
          providerId: command.providerId,
          sessionId: `provider-thread:${command.providerThreadId}`,
          threadId: command.threadId,
        });
      case "thread.stop":
      case "thread.plan.cancel": {
        const session = this.options.runtimeManager
          .get(command.environmentId)
          ?.runtime.getProviderSession(command.threadId);
        if (session) {
          return this.createThreadProviderExecutionLane(
            {
              environmentId: command.environmentId,
              providerId: session.providerId,
              providerThreadId: session.providerThreadId,
              threadId: command.threadId,
            },
            "write",
          );
        }
        return command.type === "thread.stop"
          ? this.getInFlightThreadStopProviderLane(command)
          : null;
      }
      case "thread.goal.clear": {
        const session = this.options.runtimeManager
          .get(command.environmentId)
          ?.runtime.getProviderSession(command.threadId);
        return this.createThreadProviderExecutionLane(
          {
            environmentId: command.environmentId,
            providerId: session?.providerId ?? command.resumeContext.providerId,
            providerThreadId:
              session?.providerThreadId ??
              command.resumeContext.providerThreadId,
            threadId: command.threadId,
          },
          "write",
        );
      }
      default:
        return null;
    }
  }

  private getEnvironmentLaneMode(
    command: HostDaemonCommand | HostDaemonOnlineRpcCommand,
  ): EnvironmentLaneMode | null {
    return hostDaemonEnvironmentLaneForCommand(command);
  }
}
