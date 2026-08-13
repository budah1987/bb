import { describe, expect, it } from "vitest";
import {
  BrowserAttachTracker,
  collectRendererProcessMetrics,
  parsePackagedPerformanceDriverArgs,
  parseProcessTable,
  performancePhase,
} from "../src/packaged-performance-driver.js";

describe("packaged performance driver", () => {
  it("uses release-length defaults and resolves fixture paths", () => {
    expect(
      parsePackagedPerformanceDriverArgs(["--output", "run.json"], "/repo"),
    ).toEqual({
      durationMs: 1_800_000,
      idleDurationMs: 300_000,
      outputPath: "/repo/run.json",
      sampleIntervalMs: 5_000,
      taskSwitchIntervalMs: 2_000,
    });
  });

  it("rejects invalid sampling configurations", () => {
    expect(() =>
      parsePackagedPerformanceDriverArgs(
        ["--output", "run.json", "--sample-interval-ms", "15001"],
        "/repo",
      ),
    ).toThrow("must not exceed 15000");
    expect(() =>
      parsePackagedPerformanceDriverArgs(
        [
          "--output",
          "run.json",
          "--duration-ms",
          "1000",
          "--idle-duration-ms",
          "1000",
        ],
        "/repo",
      ),
    ).toThrow("must be less than");
  });

  it("aggregates only descendant renderer working sets and CPU", () => {
    const rows = parseProcessTable(`
      100 1 1000 0:01.00 /Applications/BBamir
      101 100 2000 0:00.20 BBamir Helper --type=gpu-process
      102 101 3000 0:03.00 BBamir Helper --type=renderer
      103 100 4000 0:02.00 BBamir Helper --type=renderer
      999 1 9000 0:09.00 Other --type=renderer
    `);
    const metrics = collectRendererProcessMetrics({
      intervalMs: 5_000,
      previousCpuTimesByPid: new Map([
        [102, 2.5],
        [103, 1.5],
      ]),
      rootPid: 100,
      rows,
    });

    expect(metrics.workingSetKb).toBe(7_000);
    expect(metrics.processCount).toBe(2);
    expect(metrics.cpuPercent).toBe(20);
  });

  it("does not invent CPU for a newly created renderer", () => {
    const rows = parseProcessTable(
      "100 1 1000 0:01.00 BBamir\n104 100 3000 0:03.00 Helper --type=renderer",
    );
    const metrics = collectRendererProcessMetrics({
      intervalMs: 5_000,
      previousCpuTimesByPid: new Map(),
      rootPid: 100,
      rows,
    });
    expect(metrics.cpuPercent).toBe(0);
  });

  it("uses the final five minutes for deterministic idle sampling", () => {
    expect(
      performancePhase({
        durationMs: 1_800_000,
        elapsedMs: 1_499_999,
        idleDurationMs: 300_000,
      }),
    ).toBe("workload");
    expect(
      performancePhase({
        durationMs: 1_800_000,
        elapsedMs: 1_500_000,
        idleDurationMs: 300_000,
      }),
    ).toBe("idle");
  });

  it("keeps a cumulative native browser target count", () => {
    const tracker = new BrowserAttachTracker("main");
    expect(
      tracker.observe([
        { id: "main", type: "page", url: "http://127.0.0.1:38886" },
        { id: "browser-a", type: "page", url: "https://example.com" },
      ]),
    ).toBe(1);
    expect(
      tracker.observe([
        { id: "main", type: "page", url: "http://127.0.0.1:38886" },
        { id: "browser-b", type: "page", url: "https://example.org" },
      ]),
    ).toBe(2);
    expect(tracker.observe([])).toBe(2);
  });
});
