import { describe, expect, it, vi } from "vitest";
import { GitScanScheduler } from "./git-scan-scheduler.js";

interface Request {
  workspaceKey: string;
  sequence: number;
  priority: "foreground" | "background";
}

function request(
  workspaceKey: string,
  sequence = 1,
  priority: Request["priority"] = "background",
): Request {
  return { workspaceKey, sequence, priority };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("GitScanScheduler", () => {
  it.each([20, 50, 100])(
    "runs at most two jobs with %s workspaces",
    async (workspaceCount) => {
      let active = 0;
      let maximumActive = 0;
      const scheduler = new GitScanScheduler(async (scan: Request) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return scan.workspaceKey;
      });

      await Promise.all(
        Array.from({ length: workspaceCount }, (_, index) =>
          scheduler.enqueue(request(`workspace-${index}`)),
        ),
      );

      expect(maximumActive).toBe(2);
    },
  );

  it("replaces one pending request per workspace", async () => {
    const active = deferred<string>();
    const scheduler = new GitScanScheduler(
      (scan: Request) =>
        scan.workspaceKey === "active"
          ? active.promise
          : Promise.resolve(scan.workspaceKey),
      { concurrency: 1 },
    );

    const activeResult = scheduler.enqueue(request("active"));
    const replaced = scheduler.enqueue(request("pending", 1));
    const replacement = scheduler.enqueue(request("pending", 2));

    await expect(replaced).resolves.toBeNull();
    active.resolve("active");
    await expect(activeResult).resolves.toMatchObject({ stale: false });
    await expect(replacement).resolves.toMatchObject({
      result: "pending",
      stale: false,
    });
  });

  it("marks a running result stale when a newer sequence exists", async () => {
    const first = deferred<number>();
    const scheduler = new GitScanScheduler(
      (scan: Request) =>
        scan.sequence === 1 ? first.promise : Promise.resolve(scan.sequence),
      { concurrency: 1 },
    );

    const running = scheduler.enqueue(request("workspace", 1));
    const newer = scheduler.enqueue(request("workspace", 2));
    first.resolve(1);

    await expect(running).resolves.toMatchObject({ result: 1, stale: true });
    await expect(newer).resolves.toMatchObject({ result: 2, stale: false });
  });

  it("runs foreground work before waiting background work", async () => {
    const first = deferred<string>();
    const order: string[] = [];
    const scheduler = new GitScanScheduler(
      async (scan: Request) => {
        order.push(scan.workspaceKey);
        if (scan.workspaceKey === "active") await first.promise;
        return scan.workspaceKey;
      },
      { concurrency: 1 },
    );

    const active = scheduler.enqueue(request("active"));
    const background = scheduler.enqueue(request("background"));
    const foreground = scheduler.enqueue(
      request("foreground", 1, "foreground"),
    );
    first.resolve("done");
    await Promise.all([active, background, foreground]);

    expect(order).toEqual(["active", "foreground", "background"]);
  });

  it("runs one waiting background job after eight foreground jobs", async () => {
    const first = deferred<string>();
    const order: string[] = [];
    const scheduler = new GitScanScheduler(
      async (scan: Request) => {
        order.push(scan.workspaceKey);
        if (scan.workspaceKey === "foreground-0") await first.promise;
        return scan.workspaceKey;
      },
      { concurrency: 1 },
    );

    const work = [
      scheduler.enqueue(request("foreground-0", 1, "foreground")),
      ...Array.from({ length: 9 }, (_, index) =>
        scheduler.enqueue(request(`foreground-${index + 1}`, 1, "foreground")),
      ),
      scheduler.enqueue(request("background")),
    ];
    first.resolve("done");
    await Promise.all(work);

    expect(order.indexOf("background")).toBe(8);
  });

  it("pauses and resumes background work", async () => {
    const execute = vi.fn(async (scan: Request) => scan.workspaceKey);
    const scheduler = new GitScanScheduler(execute);
    scheduler.setBackgroundPaused(true);
    const background = scheduler.enqueue(request("background"));
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();

    scheduler.setBackgroundPaused(false);
    await expect(background).resolves.toMatchObject({ result: "background" });
  });
});
