import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HostDaemonLogger } from "./logger.js";
import {
  type GitScanChildMessage,
  type GitScanParentMessage,
  type GitScanRequest,
  type GitScanResult,
} from "./git-scan-contract.js";

interface PendingScan {
  request: GitScanRequest;
  resolve: (result: GitScanResult | null) => void;
  reject: (error: Error) => void;
}

export interface GitScanWorker {
  scan(request: GitScanRequest): Promise<GitScanResult | null>;
  setBackgroundPaused(paused: boolean): void;
  shutdown(): Promise<void>;
}

export interface GitScanWorkerOptions {
  logger: Pick<HostDaemonLogger, "info" | "warn">;
  onHealth?: (health: Extract<GitScanChildMessage, { kind: "health" }>) => void;
  onUnavailable?: () => void;
  spawnChild?: () => GitScanWorkerChild;
}

export interface GitScanWorkerChild {
  readonly connected: boolean;
  kill(signal: "SIGKILL"): boolean;
  onExit(listener: () => void): void;
  onMessage(listener: (message: unknown) => void): void;
  send(message: GitScanParentMessage): boolean | undefined;
}

function resolveWorkerEntry(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    "bb-git-scan-worker.mjs",
    "git-scan-worker-entry.js",
    "git-scan-worker-entry.ts",
  ]) {
    const candidatePath = join(moduleDir, candidate);
    if (existsSync(candidatePath)) return candidatePath;
  }
  throw new Error("Git scan worker entry was not found");
}

function defaultSpawnChild(): GitScanWorkerChild {
  const child = fork(resolveWorkerEntry(), [], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  return {
    get connected() {
      return child.connected;
    },
    kill: (signal) => child.kill(signal),
    onExit: (listener) => child.on("exit", listener),
    onMessage: (listener) => child.on("message", listener),
    send: (message) => child.send(message),
  };
}

export function createGitScanWorker(
  options: GitScanWorkerOptions,
): GitScanWorker {
  const pending = new Map<string, PendingScan>();
  let child: GitScanWorkerChild | null = null;
  let ready = false;
  let restartCount = 0;
  let unavailable = false;
  let backgroundPaused = false;
  let shuttingDown = false;
  let shutdownResolve: (() => void) | null = null;

  const send = (message: GitScanParentMessage): void => {
    if (child?.connected) child.send(message);
  };

  const dispatchPending = (): void => {
    if (!ready) return;
    send({ kind: "background-paused", paused: backgroundPaused });
    for (const entry of pending.values())
      send({ kind: "scan", request: entry.request });
  };

  const failPermanently = (): void => {
    unavailable = true;
    const error = new Error(
      "Git scan worker is unavailable; workspace state is stale",
    );
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    options.onUnavailable?.();
  };

  const start = (): void => {
    if (shuttingDown || unavailable) return;
    ready = false;
    const spawned = (options.spawnChild ?? defaultSpawnChild)();
    child = spawned;
    spawned.onMessage((rawMessage) => {
      if (child !== spawned) return;
      const message = rawMessage as GitScanChildMessage;
      if (message.kind === "ready") {
        ready = true;
        dispatchPending();
        return;
      }
      if (message.kind === "health") {
        options.onHealth?.(message);
        return;
      }
      const requestId =
        message.kind === "result"
          ? message.result.requestId
          : message.requestId;
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      if (message.kind === "result") entry.resolve(message.result);
      else if (message.kind === "superseded") entry.resolve(null);
      else entry.reject(new Error(message.message));
    });
    spawned.onExit(() => {
      if (child !== spawned) return;
      child = null;
      ready = false;
      if (shuttingDown) {
        shutdownResolve?.();
        return;
      }
      if (restartCount < 1) {
        restartCount += 1;
        options.logger.warn(
          { restartCount },
          "Git scan worker exited; restarting once",
        );
        start();
      } else {
        options.logger.warn(
          {},
          "Git scan worker failed twice; workspace state is stale",
        );
        failPermanently();
      }
    });
  };

  start();
  return {
    scan(request) {
      if (unavailable)
        return Promise.reject(new Error("Git scan worker is unavailable"));
      return new Promise<GitScanResult | null>((resolve, reject) => {
        pending.set(request.requestId, { request, resolve, reject });
        if (ready) send({ kind: "scan", request });
      });
    },
    setBackgroundPaused(paused) {
      backgroundPaused = paused;
      if (ready) send({ kind: "background-paused", paused });
    },
    async shutdown() {
      shuttingDown = true;
      for (const entry of pending.values()) entry.resolve(null);
      pending.clear();
      if (!child) return;
      const stopped = new Promise<void>((resolve) => {
        shutdownResolve = resolve;
      });
      send({ kind: "shutdown" });
      const timer = setTimeout(() => child?.kill("SIGKILL"), 2_000);
      timer.unref();
      await stopped;
      clearTimeout(timer);
    },
  };
}
