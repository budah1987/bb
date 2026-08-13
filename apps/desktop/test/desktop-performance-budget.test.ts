import { describe, expect, it } from "vitest";
import performanceBudgets from "../../../performance-budgets.json";
import {
  evaluateDesktopPerformanceRun,
  type DesktopPerformanceRun,
} from "../src/desktop-performance-budget.js";

const SAMPLE_INTERVAL_MS = 5_000;

function makeRun(
  update?: (
    sample: DesktopPerformanceRun["samples"][number],
    index: number,
  ) => DesktopPerformanceRun["samples"][number],
): DesktopPerformanceRun {
  const samples = Array.from({ length: 361 }, (_, index) => {
    const elapsedMs = index * SAMPLE_INTERVAL_MS;
    const sample = {
      browserAttachCount: 2,
      elapsedMs,
      phase: elapsedMs >= 1_200_000 ? ("idle" as const) : ("workload" as const),
      rendererCpuPercent: elapsedMs >= 1_200_000 ? 4 : 35,
      rendererWorkingSetKb: 700_000 + index * 20,
    };
    return update?.(sample, index) ?? sample;
  });
  return { samples, schemaVersion: 1 };
}

function violationCodes(run: DesktopPerformanceRun): string[] {
  return evaluateDesktopPerformanceRun(run, performanceBudgets).violations.map(
    (violation) => violation.code,
  );
}

describe("packaged desktop performance budgets", () => {
  it("accepts a complete stable 30-minute renderer run", () => {
    const evaluation = evaluateDesktopPerformanceRun(
      makeRun(),
      performanceBudgets,
    );

    expect(evaluation.passed).toBe(true);
    expect(evaluation.summary.durationMs).toBe(1_800_000);
    expect(evaluation.summary.sampleCount).toBe(361);
    expect(evaluation.summary.browserAttachGrowthAfterWarmup).toBe(0);
  });

  it("rejects incomplete and discontinuous samples", () => {
    const shortRun = makeRun();
    shortRun.samples = shortRun.samples.slice(0, 120);
    expect(violationCodes(shortRun)).toContain("duration");

    const gapRun = makeRun((sample, index) =>
      index >= 100
        ? { ...sample, elapsedMs: sample.elapsedMs + 20_000 }
        : sample,
    );
    expect(violationCodes(gapRun)).toContain("sample_gap");
  });

  it("rejects final-window and transient renderer memory regressions", () => {
    const finalWindowRun = makeRun((sample) =>
      sample.elapsedMs >= 1_750_000
        ? { ...sample, rendererWorkingSetKb: 1_600_000 }
        : sample,
    );
    expect(violationCodes(finalWindowRun)).toContain(
      "final_renderer_working_set",
    );

    const peakRun = makeRun((sample, index) =>
      index === 100 ? { ...sample, rendererWorkingSetKb: 2_200_000 } : sample,
    );
    expect(violationCodes(peakRun)).toContain("peak_renderer_working_set");
  });

  it("rejects sustained post-warmup growth and high idle CPU", () => {
    const run = makeRun((sample) =>
      sample.elapsedMs >= 300_000
        ? {
            ...sample,
            rendererCpuPercent: sample.phase === "idle" ? 12 : 35,
            rendererWorkingSetKb:
              700_000 + ((sample.elapsedMs - 300_000) / 60_000) * 12_000,
          }
        : sample,
    );

    const codes = violationCodes(run);
    expect(codes).toContain("post_warmup_growth");
    expect(codes).toContain("idle_renderer_cpu_p95");
  });

  it("rejects browser instances created after warmup", () => {
    const run = makeRun((sample) =>
      sample.elapsedMs >= 900_000
        ? { ...sample, browserAttachCount: 3 }
        : sample,
    );

    expect(violationCodes(run)).toContain("browser_attach_growth");
  });

  it("rejects a reset cumulative browser attachment counter", () => {
    const run = makeRun((sample) =>
      sample.elapsedMs >= 900_000
        ? { ...sample, browserAttachCount: 1 }
        : sample,
    );

    expect(violationCodes(run)).toContain("browser_attach_order");
  });
});
