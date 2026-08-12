import { describe, expect, it, vi } from "vitest";
import {
  GIT_SCAN_PROTOCOL_VERSION,
  type GitScanChildMessage,
  type GitScanParentMessage,
  type GitScanRequest,
} from "./git-scan-contract.js";
import {
  createGitScanWorker,
  type GitScanWorkerChild,
} from "./git-scan-worker.js";

class FakeChild implements GitScanWorkerChild {
  connected = true;
  readonly sent: GitScanParentMessage[] = [];
  private readonly exitListeners: Array<() => void> = [];
  private readonly messageListeners: Array<(message: unknown) => void> = [];

  kill(): boolean {
    this.exit();
    return true;
  }

  onExit(listener: () => void): void {
    this.exitListeners.push(listener);
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListeners.push(listener);
  }

  send(message: GitScanParentMessage): boolean {
    this.sent.push(message);
    if (message.kind === "shutdown") this.exit();
    return true;
  }

  emit(message: GitScanChildMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }

  exit(): void {
    if (!this.connected) return;
    this.connected = false;
    for (const listener of this.exitListeners) listener();
  }
}

function request(): GitScanRequest {
  return {
    version: GIT_SCAN_PROTOCOL_VERSION,
    requestId: "scan-1",
    workspaceKey: "workspace-1",
    repositoryKey: "repository-1",
    workspacePath: "/tmp/workspace-1",
    sequence: 1,
    scanKinds: ["local"],
    priority: "foreground",
    triggerReason: "watch-change",
  };
}

describe("GitScanWorker", () => {
  it("restarts once and resends pending scans", async () => {
    const children: FakeChild[] = [];
    const worker = createGitScanWorker({
      logger: { info: vi.fn(), warn: vi.fn() },
      spawnChild: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
    });
    const scan = worker.scan(request());
    children[0]!.emit({ kind: "ready" });
    expect(children[0]!.sent).toContainEqual({
      kind: "scan",
      request: request(),
    });

    children[0]!.exit();
    expect(children).toHaveLength(2);
    children[1]!.emit({ kind: "ready" });
    expect(children[1]!.sent).toContainEqual({
      kind: "scan",
      request: request(),
    });
    children[1]!.emit({
      kind: "result",
      result: {
        requestId: "scan-1",
        workspaceKey: "workspace-1",
        repositoryKey: "repository-1",
        sequence: 1,
        localFingerprint: "local",
        sharedRefsFingerprint: null,
        stale: false,
      },
    });

    await expect(scan).resolves.toMatchObject({ localFingerprint: "local" });
    await worker.shutdown();
  });

  it("reports stale workspace state after the second failure", async () => {
    const children: FakeChild[] = [];
    const onUnavailable = vi.fn();
    const worker = createGitScanWorker({
      logger: { info: vi.fn(), warn: vi.fn() },
      onUnavailable,
      spawnChild: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
    });
    const scan = worker.scan(request());

    children[0]!.exit();
    children[1]!.exit();

    await expect(scan).rejects.toThrow("workspace state is stale");
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    await expect(worker.scan(request())).rejects.toThrow(
      "Git scan worker is unavailable",
    );
  });

  it("forwards background pause state", async () => {
    const child = new FakeChild();
    const worker = createGitScanWorker({
      logger: { info: vi.fn(), warn: vi.fn() },
      spawnChild: () => child,
    });
    child.emit({ kind: "ready" });

    worker.setBackgroundPaused(true);

    expect(child.sent).toContainEqual({
      kind: "background-paused",
      paused: true,
    });
    await worker.shutdown();
  });
});
