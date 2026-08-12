export type RequestLatencyStage =
  | "request-to-accept"
  | "accept-to-first-activity";

export interface RequestLatencySample {
  durationMs: number;
  providerId: string;
  runtimeWasReady: boolean;
  stage: RequestLatencyStage;
}

export interface RequestLatencyPercentiles {
  count: number;
  p95Ms: number;
  p99Ms: number;
}

const MAX_SAMPLES_PER_SERIES = 200;
const MIN_SAMPLES_FOR_PERCENTILES = 20;

function percentile(sorted: readonly number[], ratio: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

export class RequestLatencyTracker {
  private readonly samplesBySeries = new Map<string, number[]>();

  record(sample: RequestLatencySample): RequestLatencyPercentiles | null {
    const key = [
      sample.providerId,
      sample.runtimeWasReady ? "warm" : "cold",
      sample.stage,
    ].join(":");
    const samples = this.samplesBySeries.get(key) ?? [];
    samples.push(sample.durationMs);
    if (samples.length > MAX_SAMPLES_PER_SERIES) samples.shift();
    this.samplesBySeries.set(key, samples);
    if (samples.length < MIN_SAMPLES_FOR_PERCENTILES) return null;
    const sorted = [...samples].sort((left, right) => left - right);
    return {
      count: samples.length,
      p95Ms: percentile(sorted, 0.95),
      p99Ms: percentile(sorted, 0.99),
    };
  }
}
