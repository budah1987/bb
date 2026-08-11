import { getThread } from "@bb/db";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public project manager routes", () => {
  it("shows settings, enforces disabled runs, and attributes briefing threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-project-manager",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-manager",
      });
      const managerPath = `/api/v1/projects/${project.id}/manager`;

      const showResponse = await harness.app.request(managerPath);
      expect(showResponse.status).toBe(200);
      await expect(readJson(showResponse)).resolves.toEqual({
        enabled: true,
        providerId: "codex",
        model: "gpt-5.4-mini",
        reasoningLevel: "medium",
        serviceTier: "default",
        permissionMode: "auto",
      });

      const normalizedSettingsResponse = await harness.app.request(
        `${managerPath}/settings`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            providerId: "  codex  ",
            model: "  gpt-5.4-mini  ",
          }),
        },
      );
      expect(normalizedSettingsResponse.status).toBe(200);
      await expect(readJson(normalizedSettingsResponse)).resolves.toMatchObject(
        {
          providerId: "codex",
          model: "gpt-5.4-mini",
        },
      );

      const blankSettingsResponse = await harness.app.request(
        `${managerPath}/settings`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "   " }),
        },
      );
      expect(blankSettingsResponse.status).toBe(400);
      await expect(readJson(blankSettingsResponse)).resolves.toMatchObject({
        code: "invalid_request",
      });

      const disableResponse = await harness.app.request(
        `${managerPath}/settings`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        },
      );
      expect(disableResponse.status).toBe(200);
      await expect(readJson(disableResponse)).resolves.toMatchObject({
        enabled: false,
      });

      const disabledRunResponse = await harness.app.request(
        `${managerPath}/run`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(disabledRunResponse.status).toBe(409);
      await expect(readJson(disabledRunResponse)).resolves.toMatchObject({
        code: "invalid_request",
        message: "The repository manager is disabled for this project",
      });

      const enableResponse = await harness.app.request(
        `${managerPath}/settings`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        },
      );
      expect(enableResponse.status).toBe(200);

      const runResponse = await harness.app.request(`${managerPath}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Focus on release risk." }),
      });
      expect(runResponse.status).toBe(201);
      const runBody = (await readJson(runResponse)) as {
        id: string;
        originPluginId: string | null;
      };
      expect(runBody).toMatchObject({
        originPluginId: "conductor-workspaces",
      });
      expect(getThread(harness.db, runBody.id)).toMatchObject({
        originPluginId: "conductor-workspaces",
        projectId: project.id,
        title: `${project.name} manager briefing`,
      });
    });
  });
});
