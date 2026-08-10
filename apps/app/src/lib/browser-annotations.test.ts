// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import type { BrowserAnnotation } from "@bb/server-contract";
import {
  browserAnnotationStore,
  subscribeBrowserAnnotationSelection,
} from "./browser-annotations";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      annotations: {
        clear: vi.fn(() => new Promise(() => {})),
        create: vi.fn(() => new Promise(() => {})),
        delete: vi.fn(() => new Promise(() => {})),
        list: vi.fn(() => new Promise(() => {})),
        update: vi.fn(() => new Promise(() => {})),
      },
    },
  },
}));

function serverAnnotation(
  id: string,
  threadId: string,
  tabId: string,
  overrides: Partial<BrowserAnnotation> = {},
): BrowserAnnotation {
  return {
    id,
    threadId,
    environmentId: null,
    browserTabId: tabId,
    url: "https://example.com",
    selector: "main",
    viewport: { width: 1200, height: 800 },
    rectangle: { x: 0, y: 0, width: 100, height: 40 },
    comment: "Move this section.",
    status: "open",
    revision: 1,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("browserAnnotationStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("keeps a structured optimistic draft while the server saves it", () => {
    const threadId = "thread-persistence";
    const tabId = "browser:settings";
    const draft = browserAnnotationStore.addDraft(threadId, {
      tabId,
      selector: "main > button",
      url: "http://localhost:3000/settings",
      viewport: { width: 1200, height: 800 },
      rectangle: { x: 20, y: 30, width: 160, height: 44 },
      comment: "Increase the spacing.",
    });

    const snapshot = browserAnnotationStore.getSnapshot(threadId, tabId);
    expect(snapshot.drafts).toHaveLength(1);
    expect(snapshot.selectedId).toBe(draft.id);
    expect(localStorage.length).toBe(0);
  });

  it("aggregates tabs and preserves resolved drafts for review", () => {
    const threadId = "thread-aggregate";
    const first = browserAnnotationStore.addDraft(threadId, {
      tabId: "browser:one",
      selector: "header",
      url: "http://localhost:3000",
      viewport: { width: 1200, height: 800 },
      rectangle: { x: 0, y: 0, width: 1200, height: 80 },
      comment: "Reduce this height.",
    });
    browserAnnotationStore.addDraft(threadId, {
      tabId: "browser:two",
      selector: "footer",
      url: "http://localhost:3000/about",
      viewport: { width: 1200, height: 800 },
      rectangle: { x: 0, y: 720, width: 1200, height: 80 },
      comment: "Align these links.",
    });
    browserAnnotationStore.resolveDraft(threadId, "browser:one", first.id);

    const snapshot = browserAnnotationStore.getThreadSnapshot(threadId);
    expect(snapshot.drafts).toHaveLength(2);
    expect(snapshot.drafts.find((draft) => draft.id === first.id)?.status).toBe(
      "resolved",
    );
  });

  it("reports the browser tab when a draft is selected", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBrowserAnnotationSelection(listener);

    browserAnnotationStore.selectDraft("thread-select", "browser:two", "a1");

    expect(listener).toHaveBeenCalledWith({
      tabId: "browser:two",
      threadId: "thread-select",
    });
    unsubscribe();
  });

  it("exposes annotation persistence failures", async () => {
    vi.mocked(sdk.threads.annotations.create).mockRejectedValueOnce(
      new Error("Connection lost"),
    );

    browserAnnotationStore.addDraft("thread-failure", {
      tabId: "browser:failure",
      selector: "main",
      url: "https://example.com",
      viewport: { width: 1200, height: 800 },
      rectangle: { x: 0, y: 0, width: 100, height: 40 },
      comment: "Move this section.",
    });
    await vi.waitFor(() => {
      expect(
        browserAnnotationStore.getPersistenceError("thread-failure"),
      ).toMatchObject({
        message: "Connection lost",
        operation: "create",
        tabId: "browser:failure",
      });
    });
    const snapshot = browserAnnotationStore.getSnapshot(
      "thread-failure",
      "browser:failure",
    );
    expect(snapshot.drafts).toHaveLength(1);
    expect(snapshot.drafts[0]?.id).toMatch(/^pending:/);
    expect(sdk.threads.annotations.list).not.toHaveBeenCalled();

    browserAnnotationStore.getPersistenceError("thread-failure")?.retry();
    expect(sdk.threads.annotations.create).toHaveBeenCalledTimes(2);
  });

  it("rolls back and reports a failed sent-status update", async () => {
    const threadId = "thread-status-failure";
    const tabId = "browser:status-failure";
    browserAnnotationStore.syncServerDrafts(
      threadId,
      [
        {
          id: "annotation-1",
          threadId,
          environmentId: null,
          browserTabId: tabId,
          url: "https://example.com",
          selector: "main",
          viewport: { width: 1200, height: 800 },
          rectangle: { x: 0, y: 0, width: 100, height: 40 },
          comment: "Keep this open on failure.",
          status: "open",
          revision: 1,
          createdAt: "2026-08-10T00:00:00.000Z",
          updatedAt: "2026-08-10T00:00:00.000Z",
        },
      ],
      tabId,
    );
    vi.mocked(sdk.threads.annotations.update).mockRejectedValueOnce(
      new Error("Write failed"),
    );

    const wasSaved = await browserAnnotationStore.markSent(
      threadId,
      tabId,
      "annotation-1",
    );

    expect(wasSaved).toBe(false);
    expect(
      browserAnnotationStore.getSnapshot(threadId, tabId).drafts[0]?.status,
    ).toBe("open");
    expect(browserAnnotationStore.getPersistenceError(threadId)).toMatchObject({
      draftId: "annotation-1",
      operation: "update",
    });
  });

  it("persists sent intent after a pending create completes", async () => {
    const threadId = "thread-pending-sent";
    const tabId = "browser:pending-sent";
    let resolveCreate: ((annotation: BrowserAnnotation) => void) | undefined;
    vi.mocked(sdk.threads.annotations.create).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.mocked(sdk.threads.annotations.update).mockResolvedValueOnce(
      serverAnnotation("annotation-pending", threadId, tabId, {
        status: "sent",
        revision: 2,
      }),
    );

    const pending = browserAnnotationStore.addDraft(threadId, {
      tabId,
      selector: "main",
      url: "https://example.com",
      viewport: { width: 1200, height: 800 },
      rectangle: { x: 0, y: 0, width: 100, height: 40 },
      comment: "Move this section.",
    });
    const sent = browserAnnotationStore.markSent(threadId, tabId, pending.id);
    resolveCreate?.(
      serverAnnotation("annotation-pending", threadId, tabId, {
        status: "open",
      }),
    );

    await expect(sent).resolves.toBe(true);
    expect(sdk.threads.annotations.update).toHaveBeenCalledWith({
      annotationId: "annotation-pending",
      threadId,
      expectedRevision: 1,
      status: "sent",
    });
    expect(
      browserAnnotationStore.getSnapshot(threadId, tabId).drafts[0],
    ).toMatchObject({ id: "annotation-pending", status: "sent", revision: 2 });
  });

  it("retains and retries every failed status write in one batch", async () => {
    const threadId = "thread-batch-retry";
    const tabId = "browser:batch-retry";
    browserAnnotationStore.syncServerDrafts(
      threadId,
      [
        serverAnnotation("annotation-a", threadId, tabId),
        serverAnnotation("annotation-b", threadId, tabId),
      ],
      tabId,
    );
    vi.mocked(sdk.threads.annotations.update)
      .mockRejectedValueOnce(new Error("First write failed"))
      .mockRejectedValueOnce(new Error("Second write failed"))
      .mockImplementation(async (input) =>
        serverAnnotation(input.annotationId, threadId, tabId, {
          status: input.status ?? "open",
          revision: 2,
        }),
      );

    await expect(
      Promise.all([
        browserAnnotationStore.markSent(threadId, tabId, "annotation-a"),
        browserAnnotationStore.markSent(threadId, tabId, "annotation-b"),
      ]),
    ).resolves.toEqual([false, false]);
    expect(
      browserAnnotationStore
        .getPersistenceErrors(threadId)
        .map((error) => error.draftId),
    ).toEqual(["annotation-a", "annotation-b"]);

    browserAnnotationStore.retryPersistenceErrors(threadId);
    await vi.waitFor(() => {
      expect(browserAnnotationStore.getPersistenceErrors(threadId)).toEqual([]);
    });
    expect(sdk.threads.annotations.update).toHaveBeenCalledTimes(4);
    expect(
      browserAnnotationStore
        .getSnapshot(threadId, tabId)
        .drafts.map((draft) => draft.status),
    ).toEqual(["sent", "sent"]);
  });
});
