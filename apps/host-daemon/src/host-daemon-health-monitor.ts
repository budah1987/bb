import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import type { EventSinkStorageStats } from "./event-sink-storage.js";
import type { HostDaemonLogger } from "./logger.js";

/**
 * Periodically checks host-daemon resource and watch metrics so a leak or wedge
 * emits an actionable warning instead of needing a live post-mortem.
 *
 * The headline signal is the inotify instance count. `@parcel/watcher` shares a
 * single inotify backend across every watched path, so a healthy daemon needs
 * roughly one instance no matter how many paths it watches. A count that climbs
 * with uptime means dead, leaked watcher backends (each one a thread parked
 * forever in the native teardown after a `poll()` interruption), which both
 * leaks resources and means filesystem-driven updates have silently stopped.
 */

interface HostDaemonHealthMonitorTimer {
  clear(): void;
  unref(): void;
}

type HostDaemonHealthMonitorIntervalFn = (
  callback: () => void,
  intervalMs: number,
) => HostDaemonHealthMonitorTimer;

export interface HostDaemonWatchCounts {
  workspaceWatches: number;
  threadStorageTargets: number;
}

export interface HostDaemonResourceUsage {
  /** Direct child processes, or null when process inspection is unavailable. */
  childProcesses: number | null;
  rssBytes: number;
  /** Open file descriptors, or null when unavailable (e.g. no /proc). */
  openFds: number | null;
  /** Live inotify instances, or null when unavailable. */
  inotifyInstances: number | null;
  /** OS thread count, or null when unavailable. */
  threads: number | null;
  /** Direct zombie children, or null when process inspection is unavailable. */
  zombieChildren: number | null;
}

interface HostDaemonHealthMonitorOptions {
  logger: Pick<HostDaemonLogger, "warn">;
  getWatchCounts: () => HostDaemonWatchCounts;
  getEventQueueStats?: () => EventSinkStorageStats;
  readResourceUsage?: () =>
    | HostDaemonResourceUsage
    | Promise<HostDaemonResourceUsage>;
  setIntervalFn?: HostDaemonHealthMonitorIntervalFn;
  intervalMs?: number;
  inotifyInstanceWarnThreshold?: number;
  zombieChildWarnThreshold?: number;
  eventQueueBytesWarnThreshold?: number;
  eventQueueAgeWarnThresholdMs?: number;
}

interface HostDaemonHealthMonitor {
  stop(): void;
}

const DEFAULT_HEALTH_MONITOR_INTERVAL_MS = 60_000;
// Headroom above the ~1 shared backend a healthy daemon needs, so brief
// overlaps during watch-set churn do not warn but a real leak does.
const DEFAULT_INOTIFY_INSTANCE_WARN_THRESHOLD = 8;
const DEFAULT_ZOMBIE_CHILD_WARN_THRESHOLD = 0;
const DEFAULT_EVENT_QUEUE_BYTES_WARN_THRESHOLD = 256 * 1024 * 1024;
const DEFAULT_EVENT_QUEUE_AGE_WARN_THRESHOLD_MS = 5 * 60 * 1000;
const execFileAsync = promisify(execFile);

function countInotifyInstances(fds: string[]): number {
  let count = 0;
  for (const fd of fds) {
    try {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`).includes("inotify")) {
        count += 1;
      }
    } catch {
      // The fd may close between listing and reading; ignore it.
    }
  }
  return count;
}

export async function defaultReadResourceUsage(): Promise<HostDaemonResourceUsage> {
  const rssBytes = process.memoryUsage().rss;
  let openFds: number | null = null;
  let inotifyInstances: number | null = null;
  let threads: number | null = null;
  let childProcesses: number | null = null;
  let zombieChildren: number | null = null;
  try {
    const fds = fs.readdirSync("/proc/self/fd");
    openFds = fds.length;
    inotifyInstances = countInotifyInstances(fds);
  } catch {
    try {
      openFds = fs.readdirSync("/dev/fd").length;
    } catch {
      // File descriptor inspection is unavailable.
    }
  }
  try {
    threads = fs.readdirSync("/proc/self/task").length;
  } catch {
    // /proc is unavailable; leave thread count null.
  }
  try {
    const { stdout: processRows } = await execFileAsync(
      "ps",
      ["-axo", "pid=,ppid=,state=,comm="],
      {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout: 2_000,
      },
    );
    childProcesses = 0;
    zombieChildren = 0;
    for (const row of processRows.split("\n")) {
      const match = /^\s*\d+\s+(\d+)\s+(\S)\s+(.+)$/u.exec(row);
      if (Number.parseInt(match?.[1] ?? "-1", 10) !== process.pid) continue;
      if (match?.[3] === "ps") continue;
      childProcesses += 1;
      if (match?.[2] === "Z") zombieChildren += 1;
    }
  } catch {
    // Process inspection is unavailable.
  }
  return {
    childProcesses,
    inotifyInstances,
    openFds,
    rssBytes,
    threads,
    zombieChildren,
  };
}

export function startHostDaemonHealthMonitor(
  options: HostDaemonHealthMonitorOptions,
): HostDaemonHealthMonitor {
  const intervalMs = options.intervalMs ?? DEFAULT_HEALTH_MONITOR_INTERVAL_MS;
  const inotifyInstanceWarnThreshold =
    options.inotifyInstanceWarnThreshold ??
    DEFAULT_INOTIFY_INSTANCE_WARN_THRESHOLD;
  const zombieChildWarnThreshold =
    options.zombieChildWarnThreshold ?? DEFAULT_ZOMBIE_CHILD_WARN_THRESHOLD;
  const eventQueueBytesWarnThreshold =
    options.eventQueueBytesWarnThreshold ??
    DEFAULT_EVENT_QUEUE_BYTES_WARN_THRESHOLD;
  const eventQueueAgeWarnThresholdMs =
    options.eventQueueAgeWarnThresholdMs ??
    DEFAULT_EVENT_QUEUE_AGE_WARN_THRESHOLD_MS;
  const readResourceUsage =
    options.readResourceUsage ?? defaultReadResourceUsage;
  const setIntervalFn: HostDaemonHealthMonitorIntervalFn =
    options.setIntervalFn ??
    ((callback, ms) => {
      const timer = setInterval(callback, ms);
      return {
        clear: () => clearInterval(timer),
        unref: () => timer.unref(),
      };
    });

  function inspectUsage(usage: HostDaemonResourceUsage): void {
    const queueStats = options.getEventQueueStats?.();
    const queueAgeMs =
      queueStats?.oldestCreatedAtMs == null
        ? 0
        : Date.now() - queueStats.oldestCreatedAtMs;
    if (
      usage.inotifyInstances !== null &&
      usage.inotifyInstances > inotifyInstanceWarnThreshold
    ) {
      const watchCounts = options.getWatchCounts();
      options.logger.warn(
        {
          rssBytes: usage.rssBytes,
          openFds: usage.openFds,
          inotifyInstances: usage.inotifyInstances,
          threads: usage.threads,
          workspaceWatches: watchCounts.workspaceWatches,
          threadStorageTargets: watchCounts.threadStorageTargets,
          warnThreshold: inotifyInstanceWarnThreshold,
        },
        "Host daemon inotify instance count is high; filesystem watchers are likely leaking (dead backends after poll interruptions)",
      );
    }
    if (
      usage.zombieChildren !== null &&
      usage.zombieChildren > zombieChildWarnThreshold
    ) {
      options.logger.warn(
        {
          ...usage,
          warnThreshold: zombieChildWarnThreshold,
        },
        "Host daemon has zombie child processes; child cleanup is not completing",
      );
    }
    if (
      queueStats &&
      (queueStats.sizeBytes > eventQueueBytesWarnThreshold ||
        queueAgeMs > eventQueueAgeWarnThresholdMs)
    ) {
      options.logger.warn(
        {
          queueAgeMs,
          queueBytes: queueStats.sizeBytes,
          queueDepth: queueStats.count,
          ageWarnThresholdMs: eventQueueAgeWarnThresholdMs,
          bytesWarnThreshold: eventQueueBytesWarnThreshold,
        },
        "Host daemon event outbox is backing up",
      );
    }
  }

  const timer = setIntervalFn(() => {
    const usage = readResourceUsage();
    if (usage instanceof Promise) {
      void usage.then(inspectUsage).catch(() => undefined);
      return;
    }
    inspectUsage(usage);
  }, intervalMs);
  timer.unref();

  return {
    stop() {
      timer.clear();
    },
  };
}
