import { describe, expect, it, vi } from "vitest";
import {
  startHostDaemonHealthMonitor,
  type HostDaemonResourceUsage,
} from "./host-daemon-health-monitor.js";
import type { EventSinkStorageStats } from "./event-sink-storage.js";

interface CapturedTimer {
  callback: () => void;
  cleared: boolean;
  unrefed: boolean;
}

function createMonitorHarness(
  usage: Omit<HostDaemonResourceUsage, "childProcesses" | "zombieChildren"> &
    Partial<Pick<HostDaemonResourceUsage, "childProcesses" | "zombieChildren">>,
  options: {
    eventQueueAgeWarnThresholdMs?: number;
    eventQueueBytesWarnThreshold?: number;
    inotifyInstanceWarnThreshold?: number;
    queueStats?: EventSinkStorageStats;
    zombieChildWarnThreshold?: number;
  } = {},
) {
  const warn = vi.fn();
  const timer: CapturedTimer = {
    callback: () => undefined,
    cleared: false,
    unrefed: false,
  };
  const monitor = startHostDaemonHealthMonitor({
    logger: { warn },
    getWatchCounts: () => ({ workspaceWatches: 3, threadStorageTargets: 5 }),
    readResourceUsage: () => ({
      childProcesses: null,
      zombieChildren: null,
      ...usage,
    }),
    ...(options.queueStats
      ? { getEventQueueStats: () => options.queueStats! }
      : {}),
    eventQueueAgeWarnThresholdMs: options.eventQueueAgeWarnThresholdMs,
    eventQueueBytesWarnThreshold: options.eventQueueBytesWarnThreshold,
    inotifyInstanceWarnThreshold: options.inotifyInstanceWarnThreshold,
    zombieChildWarnThreshold: options.zombieChildWarnThreshold,
    setIntervalFn: (callback) => {
      timer.callback = callback;
      return {
        clear: () => {
          timer.cleared = true;
        },
        unref: () => {
          timer.unrefed = true;
        },
      };
    },
  });
  return { warn, timer, monitor };
}

describe("startHostDaemonHealthMonitor", () => {
  it("warns with resource and watch metrics when inotify count is high", () => {
    const { warn, timer } = createMonitorHarness(
      {
        rssBytes: 123,
        openFds: 42,
        inotifyInstances: 17,
        threads: 11,
      },
      { inotifyInstanceWarnThreshold: 8 },
    );

    timer.callback();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      {
        rssBytes: 123,
        openFds: 42,
        inotifyInstances: 17,
        threads: 11,
        workspaceWatches: 3,
        threadStorageTargets: 5,
        warnThreshold: 8,
      },
      "Host daemon inotify instance count is high; filesystem watchers are likely leaking (dead backends after poll interruptions)",
    );
  });

  it("does not warn when the inotify count is healthy or unavailable", () => {
    const healthy = createMonitorHarness(
      { rssBytes: 1, openFds: 30, inotifyInstances: 2, threads: 11 },
      { inotifyInstanceWarnThreshold: 8 },
    );
    healthy.timer.callback();
    expect(healthy.warn).not.toHaveBeenCalled();

    const unavailable = createMonitorHarness({
      rssBytes: 123,
      openFds: null,
      inotifyInstances: null,
      threads: null,
    });
    unavailable.timer.callback();
    expect(unavailable.warn).not.toHaveBeenCalled();
  });

  it("warns when direct child processes become zombies", () => {
    const { warn, timer } = createMonitorHarness(
      {
        childProcesses: 7,
        inotifyInstances: null,
        openFds: 30,
        rssBytes: 123,
        threads: null,
        zombieChildren: 2,
      },
      { zombieChildWarnThreshold: 0 },
    );

    timer.callback();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ childProcesses: 7, zombieChildren: 2 }),
      expect.stringContaining("zombie child processes"),
    );
  });

  it("warns when the durable event outbox stays large", () => {
    const { warn, timer } = createMonitorHarness(
      { rssBytes: 1, openFds: 1, inotifyInstances: 1, threads: 1 },
      {
        eventQueueBytesWarnThreshold: 100,
        queueStats: {
          count: 3,
          oldestCreatedAtMs: Date.now(),
          sizeBytes: 101,
        },
      },
    );

    timer.callback();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ queueBytes: 101, queueDepth: 3 }),
      "Host daemon event outbox is backing up",
    );
  });

  it("stops the interval timer on stop()", () => {
    const { monitor, timer } = createMonitorHarness({
      rssBytes: 1,
      openFds: 1,
      inotifyInstances: 1,
      threads: 1,
    });
    expect(timer.unrefed).toBe(true);
    monitor.stop();
    expect(timer.cleared).toBe(true);
  });
});
