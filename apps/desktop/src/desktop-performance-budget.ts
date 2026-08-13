import { z } from "zod";

const packagedDesktopBudgetSchema = z
  .object({
    finalWindowMs: z.number().int().positive(),
    maxBrowserAttachGrowthAfterWarmup: z.number().int().nonnegative(),
    maxFinalRendererWorkingSetKb: z.number().positive(),
    maxIdleRendererCpuP95Percent: z.number().nonnegative(),
    maxPeakRendererWorkingSetKb: z.number().positive(),
    maxPostWarmupGrowthKbPerMinute: z.number().nonnegative(),
    maxSampleGapMs: z.number().int().positive(),
    minDurationMs: z.number().int().positive(),
    minIdleSamples: z.number().int().positive(),
    warmupMs: z.number().int().nonnegative(),
  })
  .strict();

const performanceBudgetsSchema = z
  .object({
    packagedDesktop: packagedDesktopBudgetSchema,
  })
  .passthrough();

const desktopPerformanceSampleSchema = z
  .object({
    browserAttachCount: z.number().int().nonnegative(),
    elapsedMs: z.number().int().nonnegative(),
    phase: z.enum(["idle", "workload"]),
    rendererCpuPercent: z.number().nonnegative(),
    rendererWorkingSetKb: z.number().nonnegative(),
  })
  .strict();

export const desktopPerformanceRunSchema = z
  .object({
    samples: z.array(desktopPerformanceSampleSchema).min(2),
    schemaVersion: z.literal(1),
  })
  .strict();

export type DesktopPerformanceRun = z.infer<typeof desktopPerformanceRunSchema>;

export type DesktopPerformanceViolationCode =
  | "browser_attach_order"
  | "browser_attach_growth"
  | "duration"
  | "final_renderer_working_set"
  | "idle_renderer_cpu_p95"
  | "idle_samples"
  | "peak_renderer_working_set"
  | "post_warmup_growth"
  | "sample_gap"
  | "sample_order";

export interface DesktopPerformanceViolation {
  actual: number;
  code: DesktopPerformanceViolationCode;
  limit: number;
}

export interface DesktopPerformanceSummary {
  browserAttachGrowthAfterWarmup: number;
  durationMs: number;
  finalWindowRendererWorkingSetKb: number;
  idleRendererCpuP95Percent: number;
  peakRendererWorkingSetKb: number;
  postWarmupGrowthKbPerMinute: number;
  sampleCount: number;
}

export interface DesktopPerformanceEvaluation {
  passed: boolean;
  summary: DesktopPerformanceSummary;
  violations: DesktopPerformanceViolation[];
}

function percentile(
  values: readonly number[],
  percentileValue: number,
): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

function linearGrowthKbPerMinute(
  samples: DesktopPerformanceRun["samples"],
): number {
  if (samples.length < 2) return 0;
  const meanElapsedMs =
    samples.reduce((total, sample) => total + sample.elapsedMs, 0) /
    samples.length;
  const meanWorkingSetKb =
    samples.reduce((total, sample) => total + sample.rendererWorkingSetKb, 0) /
    samples.length;
  let covariance = 0;
  let elapsedVariance = 0;
  for (const sample of samples) {
    const elapsedDelta = sample.elapsedMs - meanElapsedMs;
    covariance +=
      elapsedDelta * (sample.rendererWorkingSetKb - meanWorkingSetKb);
    elapsedVariance += elapsedDelta * elapsedDelta;
  }
  if (elapsedVariance === 0) return 0;
  return Math.max(0, (covariance / elapsedVariance) * 60_000);
}

function addMaximumViolation(
  violations: DesktopPerformanceViolation[],
  code: DesktopPerformanceViolationCode,
  actual: number,
  limit: number,
): void {
  if (actual > limit) violations.push({ actual, code, limit });
}

function addMinimumViolation(
  violations: DesktopPerformanceViolation[],
  code: DesktopPerformanceViolationCode,
  actual: number,
  limit: number,
): void {
  if (actual < limit) violations.push({ actual, code, limit });
}

export function evaluateDesktopPerformanceRun(
  runInput: unknown,
  budgetsInput: unknown,
): DesktopPerformanceEvaluation {
  const run = desktopPerformanceRunSchema.parse(runInput);
  const budget = performanceBudgetsSchema.parse(budgetsInput).packagedDesktop;
  const samples = run.samples;
  const firstSample = samples[0]!;
  const lastSample = samples.at(-1)!;
  const durationMs = lastSample.elapsedMs - firstSample.elapsedMs;
  const violations: DesktopPerformanceViolation[] = [];
  let largestSampleGapMs = 0;
  let ordered = true;
  let browserAttachCountOrdered = true;
  for (let index = 1; index < samples.length; index += 1) {
    const gap = samples[index]!.elapsedMs - samples[index - 1]!.elapsedMs;
    if (gap <= 0) ordered = false;
    if (
      samples[index]!.browserAttachCount <
      samples[index - 1]!.browserAttachCount
    ) {
      browserAttachCountOrdered = false;
    }
    largestSampleGapMs = Math.max(largestSampleGapMs, gap);
  }
  if (!ordered) {
    violations.push({ actual: 0, code: "sample_order", limit: 1 });
  }
  if (!browserAttachCountOrdered) {
    violations.push({ actual: 0, code: "browser_attach_order", limit: 1 });
  }
  addMinimumViolation(violations, "duration", durationMs, budget.minDurationMs);
  addMaximumViolation(
    violations,
    "sample_gap",
    largestSampleGapMs,
    budget.maxSampleGapMs,
  );

  const warmupEndsAt = firstSample.elapsedMs + budget.warmupMs;
  const postWarmupSamples = samples.filter(
    (sample) => sample.elapsedMs >= warmupEndsAt,
  );
  const idleSamples = postWarmupSamples.filter(
    (sample) => sample.phase === "idle",
  );
  addMinimumViolation(
    violations,
    "idle_samples",
    idleSamples.length,
    budget.minIdleSamples,
  );

  const finalWindowStartsAt = lastSample.elapsedMs - budget.finalWindowMs;
  const finalWindowRendererWorkingSetKb = Math.max(
    ...samples
      .filter((sample) => sample.elapsedMs >= finalWindowStartsAt)
      .map((sample) => sample.rendererWorkingSetKb),
  );
  const peakRendererWorkingSetKb = Math.max(
    ...samples.map((sample) => sample.rendererWorkingSetKb),
  );
  const idleRendererCpuP95Percent = percentile(
    idleSamples.map((sample) => sample.rendererCpuPercent),
    95,
  );
  const postWarmupGrowthKbPerMinute =
    linearGrowthKbPerMinute(postWarmupSamples);
  const warmupAttachCount = postWarmupSamples[0]?.browserAttachCount ?? 0;
  const browserAttachGrowthAfterWarmup = Math.max(
    0,
    ...postWarmupSamples.map(
      (sample) => sample.browserAttachCount - warmupAttachCount,
    ),
  );

  addMaximumViolation(
    violations,
    "final_renderer_working_set",
    finalWindowRendererWorkingSetKb,
    budget.maxFinalRendererWorkingSetKb,
  );
  addMaximumViolation(
    violations,
    "peak_renderer_working_set",
    peakRendererWorkingSetKb,
    budget.maxPeakRendererWorkingSetKb,
  );
  addMaximumViolation(
    violations,
    "idle_renderer_cpu_p95",
    idleRendererCpuP95Percent,
    budget.maxIdleRendererCpuP95Percent,
  );
  addMaximumViolation(
    violations,
    "post_warmup_growth",
    postWarmupGrowthKbPerMinute,
    budget.maxPostWarmupGrowthKbPerMinute,
  );
  addMaximumViolation(
    violations,
    "browser_attach_growth",
    browserAttachGrowthAfterWarmup,
    budget.maxBrowserAttachGrowthAfterWarmup,
  );

  return {
    passed: violations.length === 0,
    summary: {
      browserAttachGrowthAfterWarmup,
      durationMs,
      finalWindowRendererWorkingSetKb,
      idleRendererCpuP95Percent,
      peakRendererWorkingSetKb,
      postWarmupGrowthKbPerMinute,
      sampleCount: samples.length,
    },
    violations,
  };
}
