import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelThreadPanelRequestOnOwnerUnmount,
  completeThreadPanelRequest,
  getReadyThreadPanelRequest,
  observeThreadPanelRoute,
  setThreadPanelRequestDestination,
  startThreadPanelRequest,
} from "./plugin-thread-panel-request";

const options = {
  threadId: "thread-a",
  pluginId: "pr-manager",
  actionId: "linked-pull-requests",
  params: null,
} as const;
const source = { key: "source", path: "/projects/p/threads/source" };
const target = { key: "target", path: "/projects/p/threads/thread-a" };

afterEach(() => {
  cancelThreadPanelRequestOnOwnerUnmount();
  vi.useRealTimers();
});

describe("thread panel request", () => {
  it("accepts only after target navigation and focused surface acknowledgement", async () => {
    observeThreadPanelRoute(source);
    const request = startThreadPanelRequest(options, source);
    expect(setThreadPanelRequestDestination(request.id, target.path)).toBe(
      true,
    );
    expect(getReadyThreadPanelRequest("thread-a")).toBeNull();

    observeThreadPanelRoute(target);
    expect(getReadyThreadPanelRequest("other-thread")).toBeNull();
    expect(getReadyThreadPanelRequest("thread-a")).toEqual({
      id: request.id,
      options,
    });
    completeThreadPanelRequest(request.id, "opened");
    expect(await request.result).toEqual({ outcome: "opened" });
    expect(getReadyThreadPanelRequest("thread-a")).toBeNull();
  });

  it("supersedes an earlier lookup and prevents its later writes", async () => {
    observeThreadPanelRoute(source);
    const first = startThreadPanelRequest(options, source);
    const second = startThreadPanelRequest(options, source);
    expect(await first.result).toEqual({ outcome: "superseded" });
    expect(setThreadPanelRequestDestination(first.id, target.path)).toBe(false);
    completeThreadPanelRequest(first.id, "opened");
    expect(getReadyThreadPanelRequest("thread-a")).toBeNull();
    completeThreadPanelRequest(second.id, "unknown-thread");
    expect(await second.result).toEqual({ outcome: "unknown-thread" });
  });

  it("cancels unexpected navigation and never opens on a later target mount", async () => {
    observeThreadPanelRoute(source);
    const request = startThreadPanelRequest(options, source);
    setThreadPanelRequestDestination(request.id, target.path);
    observeThreadPanelRoute({ key: "other", path: "/settings" });
    expect(await request.result).toEqual({ outcome: "no-panel-surface" });
    observeThreadPanelRoute(target);
    expect(getReadyThreadPanelRequest("thread-a")).toBeNull();
  });

  it("cancels a lookup when the caller window navigates elsewhere", async () => {
    observeThreadPanelRoute(source);
    const request = startThreadPanelRequest(options, source);
    observeThreadPanelRoute({ key: "other", path: "/settings" });
    expect(await request.result).toEqual({ outcome: "no-panel-surface" });
    expect(setThreadPanelRequestDestination(request.id, target.path)).toBe(
      false,
    );
  });

  it("cancels when the window navigation owner unmounts", async () => {
    observeThreadPanelRoute(source);
    const request = startThreadPanelRequest(options, source);
    cancelThreadPanelRequestOnOwnerUnmount();
    expect(await request.result).toEqual({ outcome: "no-panel-surface" });
  });

  it("expires a stalled request", async () => {
    vi.useFakeTimers();
    observeThreadPanelRoute(source);
    const request = startThreadPanelRequest(options, source);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await request.result).toEqual({ outcome: "no-panel-surface" });
    observeThreadPanelRoute(target);
    expect(getReadyThreadPanelRequest("thread-a")).toBeNull();
  });
});
