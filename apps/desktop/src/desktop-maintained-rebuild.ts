import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type {
  BbDesktopMaintainedRebuild,
  BbDesktopVersionFeedPlatform,
} from "@bb/desktop-contract";
import { createBbDesktopVersionFeedFileName } from "@bb/desktop-contract";

// bb+ rebuilds itself from upstream Nightly. The desktop app only detects a
// newer upstream build and asks the local maintained tooling to start a
// rebuild; the tooling owns the rebuild thread and its state file.
const UPSTREAM_NIGHTLY_RELEASE_BASE_URL =
  "https://github.com/get-bb/bb/releases/download/desktop-nightly/";
const UPSTREAM_CHECK_TIMEOUT_MS = 10_000;
const REQUEST_REBUILD_TIMEOUT_MS = 60_000;
const STATE_POLL_INTERVAL_MS = 60_000;
export const MAINTAINED_REBUILD_STALE_MS = 6 * 60 * 60 * 1000;

const UPSTREAM_VERSION = /^\d+\.\d+\.\d+-nightly\.(\d+)\.\d+$/u;
const MAINTAINED_VERSION = /^\d+\.\d+\.\d+-bbamir\.(\d+)\.\d+\.\d+$/u;

const rebuildStateSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(["building", "failed", "promoted"]),
  upstreamVersion: z.string().min(1),
  threadId: z.string().min(1).nullable(),
  startedAt: z.iso.datetime(),
  message: z.string().min(1).nullable(),
});
export type MaintainedRebuildState = z.infer<typeof rebuildStateSchema>;

const upstreamFeedSchema = z.object({ version: z.string().min(1) });

function readRunId(version: string, pattern: RegExp): bigint | null {
  const match = pattern.exec(version);
  return match === null ? null : BigInt(match[1]);
}

// GitHub run ids increase over time, so a larger upstream run id is a newer
// upstream Nightly than the one the installed bb+ was built from.
export function isUpstreamNewer(
  installedVersion: string,
  upstreamVersion: string,
): boolean {
  const installedRunId = readRunId(installedVersion, MAINTAINED_VERSION);
  const upstreamRunId = readRunId(upstreamVersion, UPSTREAM_VERSION);
  if (installedRunId === null || upstreamRunId === null) {
    return false;
  }
  return upstreamRunId > installedRunId;
}

interface ResolveMaintainedRebuildArgs {
  installedVersion: string;
  now: number;
  state: MaintainedRebuildState | null;
  upstreamVersion: string | null;
}

export function resolveMaintainedRebuild(
  args: ResolveMaintainedRebuildArgs,
): BbDesktopMaintainedRebuild {
  const newerUpstream =
    args.upstreamVersion !== null &&
    isUpstreamNewer(args.installedVersion, args.upstreamVersion)
      ? args.upstreamVersion
      : null;
  const idle: BbDesktopMaintainedRebuild = {
    message: null,
    status: "idle",
    threadId: null,
    upstreamVersion: newerUpstream,
  };
  const state = args.state;
  if (
    state === null ||
    !isUpstreamNewer(args.installedVersion, state.upstreamVersion)
  ) {
    return idle;
  }
  if (state.status === "promoted") {
    // The native updater now offers the promoted build. Offer another rebuild
    // only when upstream moved past the promoted version.
    const promotedRunId = readRunId(state.upstreamVersion, UPSTREAM_VERSION);
    const upstreamRunId =
      newerUpstream === null ? null : readRunId(newerUpstream, UPSTREAM_VERSION);
    return {
      ...idle,
      upstreamVersion:
        promotedRunId !== null &&
        upstreamRunId !== null &&
        upstreamRunId > promotedRunId
          ? newerUpstream
          : null,
    };
  }
  if (state.status === "failed") {
    return {
      message: state.message,
      status: "failed",
      threadId: state.threadId,
      upstreamVersion: newerUpstream ?? state.upstreamVersion,
    };
  }
  if (args.now - Date.parse(state.startedAt) > MAINTAINED_REBUILD_STALE_MS) {
    return {
      message: "The rebuild did not report a result within 6 hours.",
      status: "failed",
      threadId: state.threadId,
      upstreamVersion: newerUpstream ?? state.upstreamVersion,
    };
  }
  return {
    message: null,
    status: "building",
    threadId: state.threadId,
    upstreamVersion: state.upstreamVersion,
  };
}

interface MaintainedRebuildLogger {
  warn(message: string): void;
}

interface CreateMaintainedRebuildServiceArgs {
  fetchImpl?: typeof fetch;
  homeDir: string;
  installedVersion: string;
  logger: MaintainedRebuildLogger;
  // Called once when the rebuild promotes a newer build to the local feed, so
  // the native updater can pick it up without waiting for its hourly check.
  onPromoted: () => void;
  platform: BbDesktopVersionFeedPlatform;
}

export interface MaintainedRebuildService {
  checkUpstream(): Promise<void>;
  getInfo(): BbDesktopMaintainedRebuild;
  start(): void;
  startRebuild(): Promise<void>;
  stop(): void;
  subscribe(listener: () => void): () => void;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createMaintainedRebuildService(
  args: CreateMaintainedRebuildServiceArgs,
): MaintainedRebuildService {
  const fetchImpl = args.fetchImpl ?? fetch;
  const rebuildRoot = join(
    args.homeDir,
    ".local",
    "share",
    "bb-maintained-nightly",
    "rebuild",
  );
  const statePath = join(rebuildRoot, "state.json");
  const requestScriptPath = join(rebuildRoot, "bin", "request-rebuild");
  const upstreamFeedUrl = `${UPSTREAM_NIGHTLY_RELEASE_BASE_URL}${createBbDesktopVersionFeedFileName(args.platform)}`;
  const listeners = new Set<() => void>();
  let upstreamVersion: string | null = null;
  let state: MaintainedRebuildState | null = null;
  let requestFailure: string | null = null;
  let info = compute();
  let pollHandle: ReturnType<typeof setInterval> | null = null;

  function compute(): BbDesktopMaintainedRebuild {
    const resolved = resolveMaintainedRebuild({
      installedVersion: args.installedVersion,
      now: Date.now(),
      state,
      upstreamVersion,
    });
    if (requestFailure !== null && resolved.status === "idle") {
      return { ...resolved, message: requestFailure, status: "failed" };
    }
    return resolved;
  }

  let promotedNotified: string | null = null;

  function refresh(): void {
    if (
      state?.status === "promoted" &&
      promotedNotified !== state.upstreamVersion &&
      isUpstreamNewer(args.installedVersion, state.upstreamVersion)
    ) {
      promotedNotified = state.upstreamVersion;
      args.onPromoted();
    }
    const next = compute();
    if (JSON.stringify(next) === JSON.stringify(info)) {
      return;
    }
    info = next;
    for (const listener of listeners) {
      listener();
    }
  }

  async function readState(): Promise<void> {
    let text: string;
    try {
      text = await readFile(statePath, "utf8");
    } catch (error) {
      const missing =
        error instanceof Error && "code" in error && error.code === "ENOENT";
      if (!missing) {
        args.logger.warn(
          `bb+ rebuild state unreadable: ${formatErrorMessage(error)}`,
        );
      }
      state = null;
      return;
    }
    try {
      state = rebuildStateSchema.parse(JSON.parse(text));
    } catch (error) {
      args.logger.warn(`bb+ rebuild state invalid: ${formatErrorMessage(error)}`);
      state = null;
    }
  }

  async function checkUpstream(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      UPSTREAM_CHECK_TIMEOUT_MS,
    );
    try {
      const response = await fetchImpl(upstreamFeedUrl, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      upstreamVersion = upstreamFeedSchema.parse(await response.json()).version;
    } catch (error) {
      args.logger.warn(
        `bb+ upstream Nightly check failed; keeping the last known version: ${formatErrorMessage(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
    await readState();
    refresh();
  }

  async function startRebuild(): Promise<void> {
    await readState();
    const current = compute();
    if (current.status === "building" || current.upstreamVersion === null) {
      refresh();
      return;
    }
    const version = current.upstreamVersion;
    requestFailure = null;
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          requestScriptPath,
          ["--upstream-version", version],
          { timeout: REQUEST_REBUILD_TIMEOUT_MS },
          (error, _stdout, stderr) => {
            if (error === null) {
              resolve();
              return;
            }
            const detail = stderr.trim().split("\n").at(-1) ?? "";
            reject(new Error(detail.length > 0 ? detail : error.message));
          },
        );
      });
    } catch (error) {
      requestFailure = `Could not start the rebuild: ${formatErrorMessage(error)}`;
      args.logger.warn(`bb+ ${requestFailure}`);
    }
    await readState();
    refresh();
  }

  return {
    checkUpstream,
    getInfo: () => info,
    start(): void {
      if (pollHandle !== null) {
        return;
      }
      void checkUpstream();
      // The rebuild thread reports through the state file; poll it cheaply.
      pollHandle = setInterval(() => {
        void readState().then(refresh);
      }, STATE_POLL_INTERVAL_MS);
    },
    startRebuild,
    stop(): void {
      if (pollHandle !== null) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
