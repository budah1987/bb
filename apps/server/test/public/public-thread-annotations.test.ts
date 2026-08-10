import {
  browserAnnotationListResponseSchema,
  browserAnnotationSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function createAnnotation(
  harness: TestAppHarness,
  threadId: string,
  environmentId: string,
  browserTabId = "browser-1",
): Promise<Response> {
  return await harness.app.request(`/api/v1/threads/${threadId}/annotations`, {
    body: JSON.stringify({
      environmentId,
      browserTabId,
      url: "http://localhost:3000/settings",
      selector: "#save-button",
      viewport: { width: 1440, height: 900 },
      rectangle: { x: 100, y: 200, width: 120, height: 36 },
      comment: "Use a clearer label.",
      status: "open",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("public thread browser annotations", () => {
  it("creates and filters durable annotations by tab and status", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const createdResponse = await createAnnotation(
        harness,
        thread.id,
        environment.id,
      );
      expect(createdResponse.status).toBe(200);
      const created = browserAnnotationSchema.parse(
        await readJson(createdResponse),
      );
      expect(created).toMatchObject({
        browserTabId: "browser-1",
        revision: 1,
        status: "open",
        threadId: thread.id,
      });

      const matching = await harness.app.request(
        `/api/v1/threads/${thread.id}/annotations?browserTabId=browser-1&status=open`,
      );
      expect(
        browserAnnotationListResponseSchema.parse(await readJson(matching))
          .annotations,
      ).toEqual([created]);

      const excluded = await harness.app.request(
        `/api/v1/threads/${thread.id}/annotations?status=resolved`,
      );
      expect(
        browserAnnotationListResponseSchema.parse(await readJson(excluded))
          .annotations,
      ).toEqual([]);
    });
  });

  it("rejects a stale update without losing the winning edit", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const created = browserAnnotationSchema.parse(
        await readJson(
          await createAnnotation(harness, thread.id, environment.id),
        ),
      );
      const url = `/api/v1/threads/${thread.id}/annotations/${created.id}`;
      const winning = await harness.app.request(url, {
        body: JSON.stringify({
          comment: "The winning edit.",
          expectedRevision: 1,
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      expect(winning.status).toBe(200);
      expect(
        browserAnnotationSchema.parse(await readJson(winning)),
      ).toMatchObject({
        comment: "The winning edit.",
        revision: 2,
      });

      const stale = await harness.app.request(url, {
        body: JSON.stringify({
          status: "resolved",
          expectedRevision: 1,
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      expect(stale.status).toBe(409);

      const listed = browserAnnotationListResponseSchema.parse(
        await readJson(
          await harness.app.request(`/api/v1/threads/${thread.id}/annotations`),
        ),
      );
      expect(listed.annotations[0]).toMatchObject({
        comment: "The winning edit.",
        status: "open",
      });
    });
  });

  it("clears one browser tab without deleting another tab", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      await createAnnotation(harness, thread.id, environment.id, "browser-1");
      await createAnnotation(harness, thread.id, environment.id, "browser-2");

      const cleared = await harness.app.request(
        `/api/v1/threads/${thread.id}/annotations/clear`,
        {
          body: JSON.stringify({ browserTabId: "browser-1", ids: null }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      expect(await readJson(cleared)).toEqual({ deleted: 1 });

      const listed = browserAnnotationListResponseSchema.parse(
        await readJson(
          await harness.app.request(`/api/v1/threads/${thread.id}/annotations`),
        ),
      );
      expect(
        listed.annotations.map((annotation) => annotation.browserTabId),
      ).toEqual(["browser-2"]);
    });
  });
});
