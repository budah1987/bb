import { describe, expect, it } from "vitest";
import {
  projectScriptSchema,
  projectScriptsResponseSchema,
  terminalSessionSchema,
} from "@bb/server-contract";
import { hostDaemonServerWsMessageSchema } from "@bb/host-daemon-contract";
import { withTestHarness } from "../helpers/test-app.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";

const headers = { "content-type": "application/json" };
const definition = {
  name: "Test",
  command: "printf 'hello world\\n'",
  shortcut: 1,
};

describe("project scripts", () => {
  it("keeps edits and shortcuts project-scoped and rolls back conflicting imports", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const first = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/scripts-first",
      }).project;
      const second = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/scripts-second",
      }).project;
      const path = `/api/v1/projects/${first.id}/scripts`;
      const created = await harness.app.request(path, {
        method: "POST",
        headers,
        body: JSON.stringify(definition),
      });
      expect(created.status).toBe(201);
      const script = projectScriptSchema.parse(await created.json());
      const other = await harness.app.request(
        `/api/v1/projects/${second.id}/scripts`,
        { method: "POST", headers, body: JSON.stringify(definition) },
      );
      expect(other.status).toBe(201);
      for (const input of [
        { ...definition, shortcut: null },
        { ...definition, name: "Other" },
      ]) {
        const conflict = await harness.app.request(path, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        });
        expect(conflict.status).toBe(409);
      }
      const crossProject = await harness.app.request(
        `/api/v1/projects/${second.id}/scripts/${script.id}`,
        { method: "DELETE" },
      );
      expect(crossProject.status).toBe(404);
      const imported = await harness.app.request(`${path}/import`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          scripts: [
            { name: "New", command: "echo new", shortcut: null },
            { ...definition, shortcut: null },
          ],
        }),
      });
      expect(imported.status).toBe(409);
      let listed = projectScriptsResponseSchema.parse(
        await (await harness.app.request(path)).json(),
      );
      expect(listed.scripts).toHaveLength(1);
      const updated = await harness.app.request(`${path}/${script.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          ...definition,
          name: "Renamed",
          shortcut: null,
        }),
      });
      expect(updated.status).toBe(200);
      expect(projectScriptSchema.parse(await updated.json())).toMatchObject({
        id: script.id,
        name: "Renamed",
        shortcut: null,
      });
      const validImport = await harness.app.request(`${path}/import`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          scripts: [{ name: "New", command: "echo new", shortcut: null }],
        }),
      });
      expect(validImport.status).toBe(201);
      expect(
        (
          await harness.app.request(`${path}/${script.id}`, {
            method: "DELETE",
          })
        ).status,
      ).toBe(200);
      listed = projectScriptsResponseSchema.parse(
        await (await harness.app.request(path)).json(),
      );
      expect(listed.scripts.map((item) => item.name)).toEqual(["New"]);
    });
  });

  it("validates commands and rejects a run against another project's thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const first = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/scripts-owner",
      }).project;
      const second = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/scripts-other",
      }).project;
      const thread = seedThread(harness.deps, { projectId: second.id });
      const path = `/api/v1/projects/${first.id}/scripts`;
      for (const input of [
        { ...definition, command: " " },
        { ...definition, name: " " },
        { ...definition, shortcut: 0 },
        { ...definition, shortcut: 10 },
        { ...definition, runOnWorktreeCreate: true },
      ]) {
        expect(
          (
            await harness.app.request(path, {
              method: "POST",
              headers,
              body: JSON.stringify(input),
            })
          ).status,
        ).toBe(400);
      }
      const created = projectScriptSchema.parse(
        await (
          await harness.app.request(path, {
            method: "POST",
            headers,
            body: JSON.stringify(definition),
          })
        ).json(),
      );
      const response = await harness.app.request(`${path}/${created.id}/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ threadId: thread.id }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "project_script_thread_mismatch",
      });
    });
  });

  it("runs the saved command through a terminal in the selected thread's workspace", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/scripts-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const sent: string[] = [];
      harness.hub.registerDaemon(session.id, host.id, {
        close() {},
        send(data: string) {
          sent.push(data);
        },
      });
      const path = `/api/v1/projects/${project.id}/scripts`;
      const script = projectScriptSchema.parse(
        await (
          await harness.app.request(path, {
            method: "POST",
            headers,
            body: JSON.stringify(definition),
          })
        ).json(),
      );
      const pending = Promise.resolve(
        harness.app.request(`${path}/${script.id}/run`, {
          method: "POST",
          headers,
          body: JSON.stringify({ threadId: thread.id }),
        }),
      );
      await expect
        .poll(() =>
          sent
            .map((data) =>
              hostDaemonServerWsMessageSchema.parse(JSON.parse(data)),
            )
            .find((message) => message.type === "terminal.open"),
        )
        .toBeDefined();
      const open = sent
        .map((data) => hostDaemonServerWsMessageSchema.parse(JSON.parse(data)))
        .find((message) => message.type === "terminal.open");
      if (!open || open.type !== "terminal.open")
        throw new Error("Terminal was not opened");
      expect(open.start).toEqual({ mode: "shell" });
      expect(open.threadId).toBe(thread.id);
      expect(open.target).toMatchObject({ environmentId: environment.id });
      harness.deps.terminalSessions.handleDaemonTerminalMessage({
        hostId: host.id,
        sessionId: session.id,
        message: {
          type: "terminal.opened",
          requestId: open.requestId,
          terminalId: open.terminalId,
          shell: "/bin/zsh",
          title: script.name,
          initialCwd: "/tmp/scripts-worktree",
          cols: 100,
          rows: 30,
        },
      });
      const response = await pending;
      expect(response.status).toBe(201);
      const input = sent
        .map((data) => hostDaemonServerWsMessageSchema.parse(JSON.parse(data)))
        .find((message) => message.type === "terminal.input");
      if (!input || input.type !== "terminal.input")
        throw new Error("Script was not sent to the shell");
      expect(Buffer.from(input.dataBase64, "base64").toString("utf8")).toBe(
        `${definition.command}\r`,
      );

      expect(terminalSessionSchema.parse(await response.json())).toMatchObject({
        threadId: thread.id,
        environmentId: environment.id,
        initialCwd: "/tmp/scripts-worktree",
      });
    });
  });
});
