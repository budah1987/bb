export interface GitScanScheduleRequest {
  workspaceKey: string;
  sequence: number;
  priority: "foreground" | "background";
}

export interface GitScanScheduleResult<Result> {
  result: Result;
  stale: boolean;
}

export interface GitScanSchedulerState {
  activeCount: number;
  backgroundPaused: boolean;
  queueDepth: number;
}

interface PendingEntry<Request, Result> {
  request: Request;
  resolve: (result: GitScanScheduleResult<Result> | null) => void;
  reject: (error: unknown) => void;
}

export class GitScanScheduler<Request extends GitScanScheduleRequest, Result> {
  private readonly pendingByWorkspace = new Map<
    string,
    PendingEntry<Request, Result>
  >();
  private readonly latestSequenceByWorkspace = new Map<string, number>();
  private activeCount = 0;
  private backgroundPaused = false;
  private foregroundBurst = 0;
  private shuttingDown = false;
  private shutdownResolve: (() => void) | null = null;

  constructor(
    private readonly execute: (request: Request) => Promise<Result>,
    private readonly options: {
      concurrency?: number;
      foregroundBurstLimit?: number;
      onStateChange?: (state: GitScanSchedulerState) => void;
    } = {},
  ) {}

  enqueue(request: Request): Promise<GitScanScheduleResult<Result> | null> {
    if (this.shuttingDown) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const previous = this.pendingByWorkspace.get(request.workspaceKey);
      previous?.resolve(null);
      this.latestSequenceByWorkspace.set(
        request.workspaceKey,
        request.sequence,
      );
      this.pendingByWorkspace.set(request.workspaceKey, {
        request,
        resolve,
        reject,
      });
      this.drain();
    });
  }

  setBackgroundPaused(paused: boolean): void {
    this.backgroundPaused = paused;
    this.drain();
  }

  state(): GitScanSchedulerState {
    return {
      activeCount: this.activeCount,
      backgroundPaused: this.backgroundPaused,
      queueDepth: this.pendingByWorkspace.size,
    };
  }

  shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const entry of this.pendingByWorkspace.values()) entry.resolve(null);
    this.pendingByWorkspace.clear();
    this.notifyStateChange();
    if (this.activeCount === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.shutdownResolve = resolve;
    });
  }

  private nextEntry(): PendingEntry<Request, Result> | null {
    const entries = [...this.pendingByWorkspace.values()];
    const foreground = entries.find(
      (entry) => entry.request.priority === "foreground",
    );
    const background = this.backgroundPaused
      ? undefined
      : entries.find((entry) => entry.request.priority === "background");
    const burstLimit = this.options.foregroundBurstLimit ?? 8;
    const selected =
      foreground && (this.foregroundBurst < burstLimit || !background)
        ? foreground
        : (background ?? foreground);
    if (!selected) return null;
    this.pendingByWorkspace.delete(selected.request.workspaceKey);
    if (selected.request.priority === "foreground") this.foregroundBurst += 1;
    else this.foregroundBurst = 0;
    return selected;
  }

  private drain(): void {
    const concurrency = this.options.concurrency ?? 2;
    while (!this.shuttingDown && this.activeCount < concurrency) {
      const entry = this.nextEntry();
      if (!entry) break;
      this.activeCount += 1;
      void this.run(entry);
    }
    this.notifyStateChange();
    if (this.shuttingDown && this.activeCount === 0) {
      this.shutdownResolve?.();
      this.shutdownResolve = null;
    }
  }

  private async run(entry: PendingEntry<Request, Result>): Promise<void> {
    try {
      const result = await this.execute(entry.request);
      entry.resolve({
        result,
        stale:
          (this.latestSequenceByWorkspace.get(entry.request.workspaceKey) ??
            entry.request.sequence) > entry.request.sequence,
      });
    } catch (error) {
      entry.reject(error);
    } finally {
      this.activeCount -= 1;
      this.drain();
    }
  }

  private notifyStateChange(): void {
    this.options.onStateChange?.(this.state());
  }
}
