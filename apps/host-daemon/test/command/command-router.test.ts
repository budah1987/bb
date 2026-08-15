import type {
  HostDaemonCommand,
  HostDaemonOnlineRpcRequestMessage,
  HostDaemonOnlineRpcResponseMessage,
} from "@bb/host-daemon-contract";
import { WorkspaceError } from "@bb/host-workspace";
import {
  encodeClientTurnRequestIdNumber,
  type ClientTurnRequestId,
  type PromptInput,
} from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import {
  CommandRouter,
  type CommandRouterOptions,
} from "../../src/command-router.js";
import { noopEventSink } from "../../src/command-dispatch-support.js";
import {
  createHarness,
  createFakeRuntime,
  createFakeWorkspace,
  unexpectedProjectAttachmentFetch,
} from "./dispatch-helpers.js";
import { RuntimeManager } from "../../src/runtime-manager.js";

type EnvironmentDestroyCommand = Extract<
  HostDaemonCommand,
  { type: "environment.destroy" }
>;
type EnvironmentProvisionCommand = Extract<
  HostDaemonCommand,
  { type: "environment.provision" }
>;
type RouterHarness = ReturnType<typeof createHarness>;
type TextPromptInput = Extract<PromptInput, { type: "text" }>;
type ThreadStartCommand = Extract<HostDaemonCommand, { type: "thread.start" }>;
type TurnSubmitCommand = Extract<HostDaemonCommand, { type: "turn.submit" }>;
type WorkspaceStatusCommand = Extract<
  HostDaemonOnlineRpcRequestMessage["command"],
  { type: "workspace.status" }
>;

interface Deferred<T> {
  promise: Promise<T>;
  reject(error: Error): void;
  resolve(value: T | PromiseLike<T>): void;
}

interface RunRouterCommandArgs {
  command: HostDaemonOnlineRpcRequestMessage["command"];
  requestId: string;
  router: CommandRouter;
}

interface CreateTurnSubmitCommandArgs {
  environmentId?: string;
  providerId?: string;
  providerThreadId?: string;
  workspacePath?: string;
  text?: string;
  threadId?: string;
}

interface CreateRouterArgs {
  logger?: CommandRouterOptions["logger"];
  runtimeManager?: RuntimeManager;
}

let nextClientRequestIdValue = 1;

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: ((value: T | PromiseLike<T>) => void) | undefined;
  let rejectDeferred: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  if (!resolveDeferred || !rejectDeferred) {
    throw new Error("Deferred promise callbacks were not initialized");
  }
  return {
    promise,
    reject: rejectDeferred,
    resolve: resolveDeferred,
  };
}

function createClientRequestId(): ClientTurnRequestId {
  const requestId = encodeClientTurnRequestIdNumber({
    value: nextClientRequestIdValue,
  });
  nextClientRequestIdValue += 1;
  return requestId;
}

function createRouter(
  harness: RouterHarness,
  args: CreateRouterArgs = {},
): CommandRouter {
  return new CommandRouter({
    dataDir: "/tmp/bb-router-test-data",
    eventSink: noopEventSink,
    fetchProjectAttachment: unexpectedProjectAttachmentFetch,
    logger: {
      debug: () => undefined,
      warn: () => undefined,
      ...args.logger,
    },
    runtimeManager: args.runtimeManager ?? harness.manager,
    threadStorageRootPath: "/tmp/bb-router-test-thread-storage",
  });
}

function createTurnSubmitCommand(
  args: CreateTurnSubmitCommandArgs = {},
): TurnSubmitCommand {
  const workspacePath = args.workspacePath ?? "/tmp/env-router";
  return {
    type: "turn.submit",
    environmentId: args.environmentId ?? "env-router",
    threadId: args.threadId ?? "thread-router",
    requestId: createClientRequestId(),
    input: [textPromptInput(args.text ?? "after destroy")],
    options: {
      model: "gpt-5",
      serviceTier: "default",
      reasoningLevel: "medium",
      workflowsEnabled: false,
      permissionMode: "full",
      permissionScope: "full",
      approvalReviewer: null,
      permissionEscalation: null,
    },
    resumeContext: {
      workspaceContext: {
        workspacePath,
        workspaceProvisionType: "unmanaged",
      },
      projectId: "project-router",
      providerId: args.providerId ?? "fake",
      providerThreadId: args.providerThreadId ?? "provider-thread-router",
      instructions: "Be a helpful coding agent.",
      dynamicTools: [],
      injectedSkillSources: [],
      instructionMode: "append",
    },
    target: { mode: "start" },
  };
}

function createThreadStartCommand(): ThreadStartCommand {
  return {
    type: "thread.start",
    environmentId: "env-router",
    threadId: "thread-router-start",
    workspaceContext: {
      workspacePath: "/tmp/env-router",
      workspaceProvisionType: "unmanaged",
    },
    projectId: "project-router",
    providerId: "fake",
    requestId: createClientRequestId(),
    input: [textPromptInput("start")],
    options: {
      model: "gpt-5",
      serviceTier: "default",
      reasoningLevel: "medium",
      workflowsEnabled: false,
      permissionMode: "full",
      permissionScope: "full",
      approvalReviewer: null,
      permissionEscalation: null,
    },
    instructions: "Be a helpful coding agent.",
    dynamicTools: [],
    injectedSkillSources: [],
    instructionMode: "append",
  };
}

function textPromptInput(text: string): TextPromptInput {
  return { type: "text", text, mentions: [] };
}

function createEnvironmentDestroyCommand(): EnvironmentDestroyCommand {
  return {
    type: "environment.destroy",
    environmentId: "env-router",
    workspaceContext: {
      workspacePath: "/tmp/env-router",
      workspaceProvisionType: "unmanaged",
    },
  };
}

function createEnvironmentProvisionCommand(): EnvironmentProvisionCommand {
  return {
    type: "environment.provision",
    environmentId: "env-router",
    initiator: null,
    workspaceProvisionType: "unmanaged",
    path: "/tmp/env-router",
  };
}

function createWorkspaceStatusCommand(
  mergeBaseBranch = "main",
  environmentId = "env-router",
): WorkspaceStatusCommand {
  return {
    type: "workspace.status",
    environmentId,
    mergeBaseBranch,
    workspaceContext: {
      workspacePath: `/tmp/${environmentId}`,
      workspaceProvisionType: "unmanaged",
    },
  };
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function runRouterCommand({
  command,
  requestId,
  router,
}: RunRouterCommandArgs): Promise<HostDaemonOnlineRpcResponseMessage> {
  const message: HostDaemonOnlineRpcRequestMessage = {
    type: "host-rpc.request",
    requestId,
    command,
  };
  return router.handleOnlineRpcRequest(message);
}

describe("CommandRouter", () => {
  it("pauses and resumes workspace status refreshes", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    await harness.manager.ensureEnvironment({
      environmentId: "env-router",
      workspacePath: "/tmp/env-router",
    });
    const router = createRouter(harness);
    router.setBackgroundPaused(true);

    const response = runRouterCommand({
      command: createWorkspaceStatusCommand(),
      requestId: "status-paused",
      router,
    });
    await flushAsyncWork();
    expect(harness.workspaceState.statusReads).toBe(0);

    router.setBackgroundPaused(false);
    await expect(response).resolves.toMatchObject({ ok: true });
    expect(harness.workspaceState.statusReads).toBe(1);
  });

  it("combines workspace status refresh bursts into one trailing read", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    await harness.manager.ensureEnvironment({
      environmentId: "env-router",
      workspacePath: "/tmp/env-router",
    });
    const firstRead = createDeferred<void>();
    const releaseFirstRead = createDeferred<void>();
    const originalGetStatus = harness.workspace.getStatus;
    harness.workspace.getStatus = async (options) => {
      firstRead.resolve();
      if (harness.workspaceState.statusReads === 0) {
        await releaseFirstRead.promise;
      }
      return originalGetStatus(options);
    };
    const router = createRouter(harness);
    const command = createWorkspaceStatusCommand();

    const first = runRouterCommand({
      command,
      requestId: "status-first",
      router,
    });
    await firstRead.promise;
    const second = runRouterCommand({
      command,
      requestId: "status-second",
      router,
    });
    const third = runRouterCommand({
      command,
      requestId: "status-third",
      router,
    });
    await flushAsyncWork();

    expect(harness.workspaceState.statusReads).toBe(0);
    releaseFirstRead.resolve();
    const responses = await Promise.all([first, second, third]);

    expect(responses.every((response) => response.ok)).toBe(true);
    expect(harness.workspaceState.statusReads).toBe(2);
  });

  it("limits concurrent workspace status refreshes across environments", async () => {
    const releaseReads = createDeferred<void>();
    const fourReadsStarted = createDeferred<void>();
    let activeReads = 0;
    let maximumActiveReads = 0;
    const workspaces = new Map(
      Array.from({ length: 5 }, (_, index) => {
        const environmentId = `env-status-${index}`;
        const fake = createFakeWorkspace(`/tmp/${environmentId}`);
        const originalGetStatus = fake.workspace.getStatus;
        fake.workspace.getStatus = async (options) => {
          activeReads += 1;
          maximumActiveReads = Math.max(maximumActiveReads, activeReads);
          if (activeReads === 4) fourReadsStarted.resolve();
          await releaseReads.promise;
          activeReads -= 1;
          return originalGetStatus(options);
        };
        return [environmentId, fake.workspace] as const;
      }),
    );
    const harness = createHarness();
    const runtimeManager = new RuntimeManager({
      createRuntime: () => harness.runtime,
      provisionWorkspace: async (options) => {
        const workspacePath =
          "path" in options ? options.path : options.targetPath;
        const workspace = [...workspaces.values()].find(
          (candidate) => candidate.path === workspacePath,
        );
        if (!workspace) throw new Error("Unexpected environment");
        return workspace;
      },
    });
    await Promise.all(
      [...workspaces.keys()].map((environmentId) =>
        runtimeManager.ensureEnvironment({
          environmentId,
          workspacePath: `/tmp/${environmentId}`,
        }),
      ),
    );
    const router = createRouter(harness, { runtimeManager });
    const requests = [...workspaces.keys()].map((environmentId, index) =>
      runRouterCommand({
        command: createWorkspaceStatusCommand("main", environmentId),
        requestId: `status-concurrent-${index}`,
        router,
      }),
    );

    await fourReadsStarted.promise;
    await flushAsyncWork();
    expect(activeReads).toBe(4);
    expect(maximumActiveReads).toBe(4);

    releaseReads.resolve();
    const responses = await Promise.all(requests);
    expect(responses.every((response) => response.ok)).toBe(true);
    expect(maximumActiveReads).toBe(4);
    await runtimeManager.shutdownAll();
  });

  it("admits another workspace before a busy workspace drains its queue", async () => {
    const releaseReads = createDeferred<void>();
    const quietWorkspaceStarted = createDeferred<void>();
    let activeNoisyReads = 0;
    const workspaces = new Map(
      ["env-noisy", "env-quiet"].map((environmentId) => {
        const fake = createFakeWorkspace(`/tmp/${environmentId}`);
        const originalGetStatus = fake.workspace.getStatus;
        fake.workspace.getStatus = async (options) => {
          if (environmentId === "env-noisy") {
            activeNoisyReads += 1;
          } else {
            quietWorkspaceStarted.resolve();
          }
          await releaseReads.promise;
          if (environmentId === "env-noisy") {
            activeNoisyReads -= 1;
          }
          return originalGetStatus(options);
        };
        return [environmentId, fake.workspace] as const;
      }),
    );
    const harness = createHarness();
    const runtimeManager = new RuntimeManager({
      createRuntime: () => harness.runtime,
      provisionWorkspace: async (options) => {
        const workspacePath =
          "path" in options ? options.path : options.targetPath;
        const workspace = [...workspaces.values()].find(
          (candidate) => candidate.path === workspacePath,
        );
        if (!workspace) throw new Error("Unexpected environment");
        return workspace;
      },
    });
    await Promise.all(
      [...workspaces.keys()].map((environmentId) =>
        runtimeManager.ensureEnvironment({
          environmentId,
          workspacePath: `/tmp/${environmentId}`,
        }),
      ),
    );
    const router = createRouter(harness, { runtimeManager });
    const noisyRequests = Array.from({ length: 4 }, (_, index) =>
      runRouterCommand({
        command: createWorkspaceStatusCommand(
          `merge-base-${index}`,
          "env-noisy",
        ),
        requestId: `status-noisy-${index}`,
        router,
      }),
    );
    const quietRequest = runRouterCommand({
      command: createWorkspaceStatusCommand("main", "env-quiet"),
      requestId: "status-quiet",
      router,
    });

    await quietWorkspaceStarted.promise;
    expect(activeNoisyReads).toBe(1);

    releaseReads.resolve();
    const responses = await Promise.all([...noisyRequests, quietRequest]);
    expect(responses.every((response) => response.ok)).toBe(true);
    await runtimeManager.shutdownAll();
  });

  it("does not warn for expected provision cancellation RPC failures", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
    };
    const runtimeManager = new RuntimeManager({
      createRuntime: () => harness.runtime,
      provisionWorkspace: async () => {
        throw new WorkspaceError(
          "provision_cancelled",
          "Workspace provisioning was cancelled",
        );
      },
    });
    const router = createRouter(harness, { logger, runtimeManager });

    const response = await runRouterCommand({
      command: createEnvironmentProvisionCommand(),
      requestId: "provision-cancelled-env-router",
      router,
    });

    expect(response).toMatchObject({
      ok: false,
      errorCode: "provision_cancelled",
      errorMessage: "Workspace provisioning was cancelled",
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("orders turn.submit after an in-flight environment destroy", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    await harness.manager.ensureEnvironment({
      environmentId: "env-router",
      workspacePath: "/tmp/env-router",
    });
    const destroyStarted = createDeferred<void>();
    const releaseDestroy = createDeferred<void>();
    harness.workspace.destroy = async () => {
      destroyStarted.resolve();
      await releaseDestroy.promise;
    };

    const router = createRouter(harness);
    const destroyTask = runRouterCommand({
      command: createEnvironmentDestroyCommand(),
      requestId: "destroy-env-router",
      router,
    });
    await destroyStarted.promise;

    const turnTask = runRouterCommand({
      command: createTurnSubmitCommand(),
      requestId: "turn-env-router",
      router,
    });
    await flushAsyncWork();

    expect(harness.runtimeState.ranTurnText).toBeUndefined();

    releaseDestroy.resolve();
    const destroyResponse = await destroyTask;
    expect(destroyResponse.ok).toBe(true);
    const turnResponse = await turnTask;
    expect(turnResponse.ok).toBe(true);
    expect(harness.runtimeState.ranTurnText).toBe("after destroy");
  });

  it("orders thread.stop after an in-flight thread.start handoff", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    await harness.manager.ensureEnvironment({
      environmentId: "env-router",
      workspacePath: "/tmp/env-router",
    });
    const startEntered = createDeferred<void>();
    const releaseStart = createDeferred<void>();
    const originalStartThread = harness.runtime.startThread;
    harness.runtime.startThread = async (args) => {
      startEntered.resolve();
      await releaseStart.promise;
      return originalStartThread(args);
    };

    const router = createRouter(harness);
    const startTask = runRouterCommand({
      command: createThreadStartCommand(),
      requestId: "start-env-router",
      router,
    });
    await startEntered.promise;

    let stopResolved = false;
    const stopTask = runRouterCommand({
      command: {
        type: "thread.stop",
        intent: "interrupt",
        environmentId: "env-router",
        threadId: "thread-router-start",
      },
      requestId: "stop-env-router",
      router,
    }).then((response) => {
      stopResolved = true;
      return response;
    });
    await flushAsyncWork();

    // The stop routes into the in-flight start's provider lane and must not
    // reach the runtime before the start handoff completes.
    expect(harness.runtimeState.stoppedThreadId).toBeUndefined();
    expect(stopResolved).toBe(false);

    releaseStart.resolve();
    const startResponse = await startTask;
    expect(startResponse.ok).toBe(true);
    const stopResponse = await stopTask;

    expect(stopResponse.ok).toBe(true);
    expect(harness.runtimeState.stoppedThreadId).toBe("thread-router-start");
    expect(harness.runtime.hasThread("thread-router-start")).toBe(false);
  });

  it("waits for an old-environment turn before resuming the moved thread", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    const oldHarness = createFakeRuntime();
    const newHarness = createFakeRuntime();
    const oldRuntime = oldHarness.runtime;
    const newRuntime = newHarness.runtime;
    const runtimes = [oldRuntime, newRuntime];
    const runtimeManager = new RuntimeManager({
      createRuntime: () => {
        const runtime = runtimes.shift();
        if (!runtime) {
          throw new Error("Unexpected runtime creation");
        }
        return runtime;
      },
      provisionWorkspace: async (options) =>
        createFakeWorkspace(
          "path" in options ? options.path : options.targetPath,
        ).workspace,
    });
    await runtimeManager.ensureEnvironment({
      environmentId: "env-router-old",
      workspacePath: "/tmp/env-router-old",
    });
    // The old environment still owns the provider session while its in-flight
    // turn settles, which is the handoff race this barrier protects.
    oldHarness.threadControls.setProviderSession("thread-moved", {
      providerId: "fake",
      providerThreadId: "provider-moved",
    });

    const oldRunEntered = createDeferred<void>();
    const releaseOldRun = createDeferred<void>();
    const originalOldRunTurn = oldRuntime.runTurn.bind(oldRuntime);
    oldRuntime.runTurn = async (args) => {
      oldRunEntered.resolve();
      await releaseOldRun.promise;
      return originalOldRunTurn(args);
    };
    const originalOldStopThread = oldRuntime.stopThread.bind(oldRuntime);
    const oldStopThread = vi.fn(originalOldStopThread);
    oldRuntime.stopThread = oldStopThread;
    const originalNewResumeThread = newRuntime.resumeThread.bind(newRuntime);
    const newResumeThread = vi.fn(originalNewResumeThread);
    newRuntime.resumeThread = newResumeThread;
    const retainEnvironment = vi.spyOn(
      runtimeManager,
      "retainEnvironmentForThreadCommand",
    );

    const router = createRouter(harness, { runtimeManager });
    const oldTask = runRouterCommand({
      command: createTurnSubmitCommand({
        environmentId: "env-router-old",
        providerThreadId: "provider-moved",
        threadId: "thread-moved",
        workspacePath: "/tmp/env-router-old",
        text: "old turn",
      }),
      requestId: "old-moved-turn",
      router,
    });
    await oldRunEntered.promise;

    const newTask = runRouterCommand({
      command: createTurnSubmitCommand({
        environmentId: "env-router-new",
        providerThreadId: "provider-moved",
        threadId: "thread-moved",
        workspacePath: "/tmp/env-router-new",
        text: "new turn",
      }),
      requestId: "new-moved-turn",
      router,
    });
    await flushAsyncWork();

    expect(retainEnvironment).toHaveBeenCalledTimes(1);
    expect(newResumeThread).not.toHaveBeenCalled();
    releaseOldRun.resolve();
    const [oldResponse, newResponse] = await Promise.all([oldTask, newTask]);

    expect(oldResponse.ok).toBe(true);
    expect(newResponse.ok).toBe(true);
    expect(retainEnvironment).toHaveBeenNthCalledWith(
      2,
      "env-router-new",
      "thread-moved",
    );
    expect(oldStopThread).toHaveBeenCalledWith({
      threadId: "thread-moved",
    });
    expect(newResumeThread).toHaveBeenCalledWith(
      expect.objectContaining({
        providerThreadId: "provider-moved",
        threadId: "thread-moved",
      }),
    );
    expect(oldStopThread.mock.invocationCallOrder[0]).toBeLessThan(
      newResumeThread.mock.invocationCallOrder[0],
    );
    await runtimeManager.shutdownAll();
  });

  it("does not route separate codex threads through one provider process lane", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    await harness.manager.ensureEnvironment({
      environmentId: "env-router",
      workspacePath: "/tmp/env-router",
    });
    harness.threadControls.setProviderSession("thread-codex-stop", {
      providerId: "codex",
      providerThreadId: "provider-codex-stop",
    });
    harness.threadControls.setProviderSession("thread-codex-turn", {
      providerId: "codex",
      providerThreadId: "provider-codex-turn",
    });

    const stopEntered = createDeferred<void>();
    const releaseStop = createDeferred<void>();
    const originalStopThread = harness.runtime.stopThread;
    harness.runtime.stopThread = async (args) => {
      stopEntered.resolve();
      await releaseStop.promise;
      return originalStopThread(args);
    };

    const router = createRouter(harness);
    const stopTask = runRouterCommand({
      command: {
        type: "thread.stop",
        intent: "interrupt",
        environmentId: "env-router",
        threadId: "thread-codex-stop",
      },
      requestId: "stop-codex-thread",
      router,
    });
    await stopEntered.promise;

    const turnTask = runRouterCommand({
      command: createTurnSubmitCommand({
        providerId: "codex",
        providerThreadId: "provider-codex-turn",
        text: "codex other thread",
        threadId: "thread-codex-turn",
      }),
      requestId: "turn-codex-other-thread",
      router,
    });
    await flushAsyncWork();

    expect(harness.runtimeState.ranTurnText).toBe("codex other thread");
    const turnResponse = await turnTask;
    expect(turnResponse.ok).toBe(true);

    releaseStop.resolve();
    const stopResponse = await stopTask;
    expect(stopResponse.ok).toBe(true);
  });
});
