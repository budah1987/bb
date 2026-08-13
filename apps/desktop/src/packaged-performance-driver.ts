import { resolve } from "node:path";

export const DEFAULT_PERFORMANCE_DURATION_MS = 30 * 60 * 1_000;
export const DEFAULT_IDLE_DURATION_MS = 5 * 60 * 1_000;
export const DEFAULT_SAMPLE_INTERVAL_MS = 5_000;
export const DEFAULT_TASK_SWITCH_INTERVAL_MS = 2_000;

export interface PackagedPerformanceDriverOptions {
  durationMs: number;
  idleDurationMs: number;
  outputPath: string;
  sampleIntervalMs: number;
  taskSwitchIntervalMs: number;
}

export interface ProcessTableRow {
  command: string;
  cpuTimeSeconds: number;
  parentPid: number;
  pid: number;
  workingSetKb: number;
}

export interface RendererProcessMetrics {
  cpuPercent: number;
  cpuTimesByPid: ReadonlyMap<number, number>;
  processCount: number;
  workingSetKb: number;
}

export interface CdpTarget {
  id: string;
  type: string;
  url: string;
}

function parsePositiveInteger(name: string, rawValue: string): number {
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function parsePackagedPerformanceDriverArgs(
  argv: readonly string[],
  cwd: string,
): PackagedPerformanceDriverOptions {
  let outputPath: string | null = null;
  let durationMs = DEFAULT_PERFORMANCE_DURATION_MS;
  let idleDurationMs = DEFAULT_IDLE_DURATION_MS;
  let sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS;
  let taskSwitchIntervalMs = DEFAULT_TASK_SWITCH_INTERVAL_MS;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const readValue = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} requires a value`);
      index += 1;
      return value;
    };
    switch (argument) {
      case "--duration-ms":
        durationMs = parsePositiveInteger(argument, readValue());
        break;
      case "--idle-duration-ms":
        idleDurationMs = parsePositiveInteger(argument, readValue());
        break;
      case "--output":
        outputPath = resolve(cwd, readValue());
        break;
      case "--sample-interval-ms":
        sampleIntervalMs = parsePositiveInteger(argument, readValue());
        break;
      case "--task-switch-interval-ms":
        taskSwitchIntervalMs = parsePositiveInteger(argument, readValue());
        break;
      default:
        throw new Error(`Unknown option: ${String(argument)}`);
    }
  }

  if (outputPath === null) throw new Error("--output is required");
  if (idleDurationMs >= durationMs) {
    throw new Error("--idle-duration-ms must be less than --duration-ms");
  }
  if (sampleIntervalMs > 15_000) {
    throw new Error("--sample-interval-ms must not exceed 15000");
  }

  return {
    durationMs,
    idleDurationMs,
    outputPath,
    sampleIntervalMs,
    taskSwitchIntervalMs,
  };
}

function parseCpuTimeSeconds(value: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/u.exec(value);
  if (match === null) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

export function parseProcessTable(output: string): ProcessTableRow[] {
  const rows: ProcessTableRow[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/u.exec(line);
    if (match === null) continue;
    const cpuTimeSeconds = parseCpuTimeSeconds(match[4]!);
    if (cpuTimeSeconds === null) continue;
    rows.push({
      command: match[5]!,
      cpuTimeSeconds,
      parentPid: Number(match[2]),
      pid: Number(match[1]),
      workingSetKb: Number(match[3]),
    });
  }
  return rows;
}

function descendantPids(rows: readonly ProcessTableRow[], rootPid: number) {
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (descendants.has(row.parentPid) && !descendants.has(row.pid)) {
        descendants.add(row.pid);
        changed = true;
      }
    }
  }
  return descendants;
}

export function collectRendererProcessMetrics(args: {
  intervalMs: number;
  previousCpuTimesByPid: ReadonlyMap<number, number>;
  rootPid: number;
  rows: readonly ProcessTableRow[];
}): RendererProcessMetrics {
  const descendants = descendantPids(args.rows, args.rootPid);
  const rendererRows = args.rows.filter(
    (row) =>
      descendants.has(row.pid) && row.command.includes("--type=renderer"),
  );
  if (rendererRows.length === 0) {
    throw new Error("No packaged Electron renderer process was found");
  }

  const cpuTimesByPid = new Map<number, number>();
  let cpuDeltaSeconds = 0;
  let workingSetKb = 0;
  for (const row of rendererRows) {
    cpuTimesByPid.set(row.pid, row.cpuTimeSeconds);
    workingSetKb += row.workingSetKb;
    const previous = args.previousCpuTimesByPid.get(row.pid);
    if (previous !== undefined) {
      cpuDeltaSeconds += Math.max(0, row.cpuTimeSeconds - previous);
    }
  }

  return {
    cpuPercent:
      args.previousCpuTimesByPid.size === 0
        ? 0
        : (cpuDeltaSeconds * 100_000) / args.intervalMs,
    cpuTimesByPid,
    processCount: rendererRows.length,
    workingSetKb,
  };
}

export function performancePhase(args: {
  durationMs: number;
  elapsedMs: number;
  idleDurationMs: number;
}): "idle" | "workload" {
  return args.elapsedMs >= args.durationMs - args.idleDurationMs
    ? "idle"
    : "workload";
}

/** Counts every distinct native browser page target created during the run. */
export class BrowserAttachTracker {
  readonly #mainTargetId: string;
  readonly #seenTargetIds = new Set<string>();

  constructor(mainTargetId: string) {
    this.#mainTargetId = mainTargetId;
  }

  observe(targets: readonly CdpTarget[]): number {
    for (const target of targets) {
      if (
        target.type === "page" &&
        target.id !== this.#mainTargetId &&
        !target.url.startsWith("devtools://")
      ) {
        this.#seenTargetIds.add(target.id);
      }
    }
    return this.#seenTargetIds.size;
  }
}
