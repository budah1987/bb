import { runGit } from "@bb/host-workspace";
import {
  GIT_SCAN_PROTOCOL_VERSION,
  type GitScanChildMessage,
  type GitScanParentMessage,
  type GitScanRequest,
  type GitScanResult,
} from "./git-scan-contract.js";
import { GitScanScheduler } from "./git-scan-scheduler.js";

const GIT_TIMEOUT_MS = 30_000;
const sharedRefsByRepository = new Map<string, Promise<string>>();

function send(message: GitScanChildMessage): void {
  process.send?.(message);
}

async function localFingerprint(workspacePath: string): Promise<string> {
  const branch = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], {
    allowFailure: true,
    cwd: workspacePath,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  const head = await runGit(["rev-parse", "--verify", "HEAD"], {
    allowFailure: true,
    cwd: workspacePath,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  const tracked = await runGit(
    ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=no"],
    { cwd: workspacePath, timeoutMs: GIT_TIMEOUT_MS },
  );
  return JSON.stringify({
    branch: branch.stdout.trim(),
    head: head.stdout.trim(),
    tracked: tracked.stdout,
  });
}

function sharedRefsFingerprint(request: GitScanRequest): Promise<string> {
  const existing = sharedRefsByRepository.get(request.repositoryKey);
  if (existing) return existing;
  const scan = runGit(
    [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)",
      "refs/heads",
      "refs/remotes",
    ],
    { cwd: request.workspacePath, timeoutMs: GIT_TIMEOUT_MS },
  )
    .then(async (refs) => {
      const remoteHead = await runGit(
        ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
        {
          allowFailure: true,
          cwd: request.workspacePath,
          timeoutMs: GIT_TIMEOUT_MS,
        },
      );
      return JSON.stringify({
        refs: refs.stdout,
        remoteHead: remoteHead.stdout.trim(),
      });
    })
    .finally(() => sharedRefsByRepository.delete(request.repositoryKey));
  sharedRefsByRepository.set(request.repositoryKey, scan);
  return scan;
}

async function execute(
  request: GitScanRequest,
): Promise<Omit<GitScanResult, "stale">> {
  const localFingerprintValue = request.scanKinds.includes("local")
    ? await localFingerprint(request.workspacePath)
    : null;
  const sharedRefsFingerprintValue = request.scanKinds.includes("shared-refs")
    ? await sharedRefsFingerprint(request)
    : null;
  return {
    requestId: request.requestId,
    workspaceKey: request.workspaceKey,
    repositoryKey: request.repositoryKey,
    sequence: request.sequence,
    localFingerprint: localFingerprintValue,
    sharedRefsFingerprint: sharedRefsFingerprintValue,
  };
}

const scheduler = new GitScanScheduler(execute, {
  onStateChange: (state) => send({ kind: "health", ...state }),
});

function enqueue(request: GitScanRequest): void {
  if (request.version !== GIT_SCAN_PROTOCOL_VERSION) {
    send({
      kind: "error",
      requestId: request.requestId,
      message: "Git scan protocol mismatch",
    });
    return;
  }
  void scheduler.enqueue(request).then(
    (scheduled) => {
      if (!scheduled) {
        send({ kind: "superseded", requestId: request.requestId });
        return;
      }
      send({
        kind: "result",
        result: { ...scheduled.result, stale: scheduled.stale },
      });
    },
    (error) => {
      send({
        kind: "error",
        requestId: request.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  );
}

process.on("message", (message: GitScanParentMessage) => {
  switch (message.kind) {
    case "scan":
      enqueue(message.request);
      break;
    case "background-paused":
      scheduler.setBackgroundPaused(message.paused);
      break;
    case "shutdown":
      void scheduler.shutdown().then(() => process.exit(0));
      break;
  }
});

process.on("disconnect", () => process.exit(0));
send({ kind: "ready" });
