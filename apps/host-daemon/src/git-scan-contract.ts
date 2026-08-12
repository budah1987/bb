export const GIT_SCAN_PROTOCOL_VERSION = 1 as const;

export type GitScanKind = "local" | "shared-refs";
export type GitScanPriority = "foreground" | "background";
export type GitScanTriggerReason =
  | "startup-recovery"
  | "watch-change"
  | "watch-ready"
  | "watch-recovery";

export interface GitScanRequest {
  version: typeof GIT_SCAN_PROTOCOL_VERSION;
  requestId: string;
  workspaceKey: string;
  repositoryKey: string;
  workspacePath: string;
  sequence: number;
  scanKinds: GitScanKind[];
  priority: GitScanPriority;
  triggerReason: GitScanTriggerReason;
}

export interface GitScanResult {
  requestId: string;
  workspaceKey: string;
  repositoryKey: string;
  sequence: number;
  localFingerprint: string | null;
  sharedRefsFingerprint: string | null;
  stale: boolean;
}

export type GitScanParentMessage =
  | { kind: "scan"; request: GitScanRequest }
  | { kind: "background-paused"; paused: boolean }
  | { kind: "shutdown" };

export type GitScanChildMessage =
  | { kind: "ready" }
  | { kind: "result"; result: GitScanResult }
  | { kind: "error"; requestId: string; message: string }
  | { kind: "superseded"; requestId: string }
  | {
      kind: "health";
      activeCount: number;
      backgroundPaused: boolean;
      queueDepth: number;
    };
