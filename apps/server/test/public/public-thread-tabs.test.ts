import { archiveThread } from "@bb/db";
import { threadTabsResponseSchema, type ThreadTab } from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import { readJson } from "../helpers/json.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function getTabs(
  harness: TestAppHarness,
  threadId: string,
): Promise<Response> {
  return harness.app.request(`/api/v1/threads/${threadId}/tabs`);
}

async function putTabs(
  harness: TestAppHarness,
  threadId: string,
  body: { expectedRevision: number; tabs: readonly ThreadTab[] },
): Promise<Response> {
  return harness.app.request(`/api/v1/threads/${threadId}/tabs`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

const ALL_TAB_KINDS: readonly ThreadTab[] = [
  { id: "thread-info", kind: "thread-info" },
  { id: "git-diff", kind: "git-diff" },
  {
    actionId: "inspect",
    id: "plugin-panel",
    kind: "plugin-panel",
    paramsJson: '{"path":"src/index.ts"}',
    pluginId: "example",
    title: "Inspector",
  },
  {
    environmentId: "env_1",
    id: "workspace-file",
    kind: "workspace-file-preview",
    lineRange: { endLineNumber: 12, startLineNumber: 8 },
    path: "src/index.ts",
    projectId: "prj_1",
    source: { kind: "merge-base", ref: "main" },
    statusLabel: null,
  },
  {
    environmentId: "env_1",
    id: "host-file",
    kind: "host-file-preview",
    lineRange: null,
    path: "/tmp/output.log",
    threadId: "thr_child",
  },
  {
    environmentId: "env_1",
    id: "thread-storage-file",
    isPinned: true,
    kind: "thread-storage-file-preview",
    lineRange: null,
    path: "notes/result.md",
    threadId: "thr_child",
  },
  {
    environmentId: "env_1",
    id: "browser",
    kind: "browser",
    title: "Example",
    url: "https://example.com",
  },
  { id: "new-tab", kind: "new-tab" },
  {
    id: "side-chat",
    kind: "side-chat",
    sourceMessageText: "Investigate this part",
    sourceSeqEnd: 42,
    threadId: "thr_child",
    title: "Investigate",
  },
  { id: "terminal", kind: "terminal", terminalId: "term_1" },
];

describe("public thread tabs", () => {
  it("stores every tab kind and rejects stale writes", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const notifyThread = vi.spyOn(harness.hub, "notifyThread");

      const initialResponse = await getTabs(harness, thread.id);
      expect(initialResponse.status).toBe(200);
      expect(
        threadTabsResponseSchema.parse(await readJson(initialResponse)),
      ).toEqual({ revision: 0, tabs: [] });

      const updateResponse = await putTabs(harness, thread.id, {
        expectedRevision: 0,
        tabs: ALL_TAB_KINDS,
      });
      expect(updateResponse.status).toBe(200);
      expect(
        threadTabsResponseSchema.parse(await readJson(updateResponse)),
      ).toEqual({ revision: 1, tabs: ALL_TAB_KINDS });
      expect(notifyThread).toHaveBeenCalledWith(thread.id, ["tabs-changed"]);

      const closeResponse = await putTabs(harness, thread.id, {
        expectedRevision: 1,
        tabs: [],
      });
      expect(closeResponse.status).toBe(200);
      expect(
        threadTabsResponseSchema.parse(await readJson(closeResponse)),
      ).toEqual({ revision: 2, tabs: [] });
      expect(notifyThread).toHaveBeenCalledTimes(2);

      const staleResponse = await putTabs(harness, thread.id, {
        expectedRevision: 1,
        tabs: [],
      });
      expect(staleResponse.status).toBe(409);
      expect(await readJson(staleResponse)).toEqual({
        code: "thread_tabs_conflict",
        details: { currentRevision: 2 },
        message: "Thread tabs changed on another client",
      });
      expect(notifyThread).toHaveBeenCalledTimes(2);

      const persistedResponse = await getTabs(harness, thread.id);
      expect(
        threadTabsResponseSchema.parse(await readJson(persistedResponse)),
      ).toEqual({ revision: 2, tabs: [] });
    });
  });

  it("rejects duplicate tab ids and unknown threads", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const duplicateResponse = await putTabs(harness, thread.id, {
        expectedRevision: 0,
        tabs: [
          { id: "same", kind: "thread-info" },
          { id: "same", kind: "git-diff" },
        ],
      });
      expect(duplicateResponse.status).toBe(400);

      expect((await getTabs(harness, "thr_missing")).status).toBe(404);
    });
  });

  it("clears synced tabs when a thread is archived", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const notifyThread = vi.spyOn(harness.hub, "notifyThread");

      expect(
        (
          await putTabs(harness, thread.id, {
            expectedRevision: 0,
            tabs: ALL_TAB_KINDS,
          })
        ).status,
      ).toBe(200);
      notifyThread.mockClear();

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        { method: "POST" },
      );
      expect(archiveResponse.status).toBe(200);
      expect(notifyThread).toHaveBeenCalledWith(
        thread.id,
        ["archived-changed"],
        { projectId: thread.projectId },
      );
      expect(notifyThread).toHaveBeenCalledWith(
        thread.id,
        ["tabs-changed"],
        undefined,
      );

      const tabsResponse = await getTabs(harness, thread.id);
      expect(
        threadTabsResponseSchema.parse(await readJson(tabsResponse)),
      ).toEqual({ revision: 2, tabs: [] });

      const staleWriteResponse = await putTabs(harness, thread.id, {
        expectedRevision: 2,
        tabs: ALL_TAB_KINDS,
      });
      expect(staleWriteResponse.status).toBe(409);
      expect(await readJson(staleWriteResponse)).toMatchObject({
        code: "thread_not_writable",
        details: { reason: "archived" },
      });
    });
  });

  it("hides tabs left by older archive operations", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      expect(
        (
          await putTabs(harness, thread.id, {
            expectedRevision: 0,
            tabs: ALL_TAB_KINDS,
          })
        ).status,
      ).toBe(200);

      archiveThread(harness.db, harness.hub, thread.id);

      const tabsResponse = await getTabs(harness, thread.id);
      expect(
        threadTabsResponseSchema.parse(await readJson(tabsResponse)),
      ).toEqual({ revision: 1, tabs: [] });
    });
  });
});
