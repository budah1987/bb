import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public Space routes", () => {
  it("creates a Space, moves a project, and preserves membership on deletion", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-spaces" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/spaces",
      });
      const createResponse = await harness.app.request("/api/v1/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Work", icon: "target", color: "blue" }),
      });
      expect(createResponse.status).toBe(201);
      const created = (await readJson(createResponse)) as { id: string };

      const moveResponse = await harness.app.request(
        `/api/v1/spaces/${created.id}/projects/${project.id}`,
        { method: "PATCH" },
      );
      expect(moveResponse.status).toBe(200);
      await expect(readJson(moveResponse)).resolves.toMatchObject({
        id: created.id,
        projectIds: [project.id],
      });

      const blockedDeleteResponse = await harness.app.request(
        `/api/v1/spaces/${created.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ destinationSpaceId: null }),
        },
      );
      expect(blockedDeleteResponse.status).toBe(409);

      const deleteResponse = await harness.app.request(
        `/api/v1/spaces/${created.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ destinationSpaceId: "space_default" }),
        },
      );
      expect(deleteResponse.status).toBe(200);
      await expect(readJson(deleteResponse)).resolves.toEqual({
        ok: true,
        movedProjectIds: [project.id],
      });
    });
  });
});
