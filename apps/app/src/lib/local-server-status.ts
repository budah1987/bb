import { isVisibleTerminalSessionStatus } from "@bb/domain";
import type {
  EnvironmentDockerActivityResponse,
  EnvironmentDockerService,
  TerminalSession,
} from "@bb/server-contract";
import type { StatusTier } from "./status-tier";

/**
 * Build freshness for one container, as reported by the on-demand activity
 * query. `null` means nobody has asked yet — the UI must not read that as
 * "fresh".
 */
type DockerServiceActivity = Extract<
  EnvironmentDockerActivityResponse,
  { outcome: "available" }
>["activities"][number];
export type DockerServiceFreshness = DockerServiceActivity["freshness"];

/**
 * What a status contributes to the section header. `settled` covers both a
 * healthy server and a shared worker: neither is something to act on.
 */
export type LocalServerSeverity = "issue" | "stale" | "starting" | "settled";

export interface LocalServerStatus {
  label: string;
  /**
   * Screen-reader-only qualifier for a label whose color would otherwise
   * overstate confidence (a muted "Running" with no freshness answer).
   */
  note: string | null;
  severity: LocalServerSeverity;
  tier: StatusTier;
}

const GENERIC_TERMINAL_TITLES = new Set([
  "bash",
  "fish",
  "shell",
  "terminal",
  "zsh",
]);

export type LocalServerState =
  | "disconnected"
  | "running"
  | "starting"
  | "wrong_checkout";

export interface LocalServerDisplay {
  id: string;
  initialCwd: string;
  state: LocalServerState;
  title: string;
}

function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.length > 1 ? normalized.replace(/\/+$/u, "") : normalized;
}

export function isPathInsideEnvironment(
  path: string,
  environmentPath: string,
): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedEnvironmentPath = normalizePath(environmentPath);
  return (
    normalizedPath === normalizedEnvironmentPath ||
    normalizedPath.startsWith(`${normalizedEnvironmentPath}/`)
  );
}

export function isNamedLocalServerTerminal(session: TerminalSession): boolean {
  const normalizedTitle = session.title.trim().toLowerCase();
  return (
    isVisibleTerminalSessionStatus(session.status) &&
    session.launchCommand !== null &&
    !GENERIC_TERMINAL_TITLES.has(normalizedTitle) &&
    !/^terminal \d+$/u.test(normalizedTitle)
  );
}

export function buildLocalServerDisplay(
  session: TerminalSession,
  environmentPath: string | null | undefined,
): LocalServerDisplay {
  const state: LocalServerState =
    environmentPath &&
    !isPathInsideEnvironment(session.initialCwd, environmentPath)
      ? "wrong_checkout"
      : session.status === "exited"
        ? "disconnected"
        : session.status;

  return {
    id: session.id,
    initialCwd: session.initialCwd,
    state,
    title: session.title,
  };
}

export function resolveTerminalServerStatus(
  state: LocalServerState,
): LocalServerStatus {
  switch (state) {
    case "wrong_checkout":
      return {
        label: "Wrong checkout",
        note: null,
        severity: "issue",
        tier: "destructive",
      };
    case "disconnected":
      return {
        label: "Disconnected",
        note: null,
        severity: "issue",
        tier: "destructive",
      };
    case "starting":
      return {
        label: "Starting",
        note: null,
        severity: "starting",
        tier: "warning",
      };
    case "running":
      return {
        label: "Running",
        note: null,
        severity: "settled",
        tier: "success",
      };
  }
}

/**
 * A container the environment shares rather than owns. It runs from another
 * checkout on purpose, so it is reported as a fact and never as a failure.
 */
export function isSharedDockerService(
  service: EnvironmentDockerService,
): boolean {
  return (
    service.kind === "shared_worker" ||
    service.checkoutStatus === "declared_shared"
  );
}

/**
 * Collapse Docker's container states onto the three the rail can say. Anything
 * that is neither up nor coming up reads as "Disconnected": from the rail's
 * point of view, exited, dead and removing are the same answer.
 */
export function resolveDockerRunState(
  state: string,
): "running" | "starting" | "disconnected" {
  const normalized = state.trim().toLowerCase();
  if (normalized === "running") {
    return "running";
  }
  if (normalized === "created" || normalized === "restarting") {
    return "starting";
  }
  return "disconnected";
}

function runningLabel(publishedPorts: readonly number[]): string {
  const port = publishedPorts[0];
  return port === undefined ? "Running" : `Running :${port}`;
}

interface ResolveDockerServiceStatusArgs {
  freshness: DockerServiceFreshness | null;
  service: EnvironmentDockerService;
}

/**
 * The row label for one container. Checkout provenance is structural — a
 * server built from the wrong tree is wrong however fresh its build is — so it
 * is answered before freshness is consulted at all.
 */
export function resolveDockerServiceStatus({
  freshness,
  service,
}: ResolveDockerServiceStatusArgs): LocalServerStatus {
  if (service.checkoutStatus === "wrong_checkout") {
    return {
      label: "Wrong checkout",
      note: null,
      severity: "issue",
      tier: "destructive",
    };
  }
  if (isSharedDockerService(service)) {
    return {
      label: "Shared",
      note: null,
      severity: "settled",
      tier: "muted",
    };
  }
  if (service.checkoutStatus === "ambiguous") {
    return {
      label: "Mixed checkout",
      note: null,
      severity: "issue",
      tier: "warning",
    };
  }

  const runState = resolveDockerRunState(service.state);
  if (runState === "disconnected") {
    return {
      label: "Disconnected",
      note: null,
      severity: "issue",
      tier: "destructive",
    };
  }
  if (runState === "starting") {
    return {
      label: "Starting",
      note: null,
      severity: "starting",
      tier: "warning",
    };
  }

  switch (freshness) {
    case "missing_build":
      return {
        label: "No build",
        note: null,
        severity: "issue",
        tier: "warning",
      };
    case "stale":
      return {
        label: "Stale build",
        note: null,
        severity: "stale",
        tier: "warning",
      };
    case "fresh":
      return {
        label: runningLabel(service.publishedPorts),
        note: null,
        severity: "settled",
        tier: "success",
      };
    case "unknown":
    case null:
      return {
        label: "Running",
        note: "freshness unknown",
        severity: "settled",
        tier: "muted",
      };
  }
}

/**
 * The checkout a shared or misplaced container actually runs from. Prefers a
 * path, since "Owned by" and "Mounted from" both name a place; falls back to
 * the branch, then to a plain statement that it is elsewhere, so the line never
 * renders as "Owned by undefined".
 */
export function resolveDockerServiceOwnerLabel(
  service: EnvironmentDockerService,
): string {
  return (
    service.ownerCheckoutRoot ??
    service.mounts[0]?.checkoutRoot ??
    service.ownerBranch ??
    "another checkout"
  );
}

export interface LocalServerSummary {
  label: string;
  tier: StatusTier;
}

interface SummarizeLocalServersArgs {
  isLoading: boolean;
  statuses: readonly LocalServerStatus[];
}

function countSeverity(
  statuses: readonly LocalServerStatus[],
  severity: LocalServerSeverity,
): number {
  return statuses.filter((status) => status.severity === severity).length;
}

/** The section header reports the worst thing in the list, and only that. */
export function summarizeLocalServers({
  isLoading,
  statuses,
}: SummarizeLocalServersArgs): LocalServerSummary {
  if (isLoading) {
    return { label: "Loading", tier: "muted" };
  }
  const issueCount = countSeverity(statuses, "issue");
  if (issueCount > 0) {
    return {
      label: `${issueCount} ${issueCount === 1 ? "issue" : "issues"}`,
      tier: "destructive",
    };
  }
  const staleCount = countSeverity(statuses, "stale");
  if (staleCount > 0) {
    return { label: `${staleCount} stale`, tier: "warning" };
  }
  const startingCount = countSeverity(statuses, "starting");
  if (startingCount > 0) {
    return { label: `${startingCount} starting`, tier: "warning" };
  }
  if (statuses.length > 0) {
    return { label: `${statuses.length} running`, tier: "muted" };
  }
  return { label: "None", tier: "muted" };
}
