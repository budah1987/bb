import { randomUUID } from "node:crypto";
import { and, asc, eq, or } from "drizzle-orm";
import { projectScripts } from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type ProjectScriptInput,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import {
  requirePublicStandardProject,
  requirePublicThread,
} from "../services/lib/entity-lookup.js";

export function registerProjectScriptRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, put, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.projects;
  const scope = (projectId: string) => eq(projectScripts.projectId, projectId);
  const target = (projectId: string, scriptId: string) =>
    and(scope(projectId), eq(projectScripts.id, scriptId));
  const list = (projectId: string) =>
    deps.db
      .select()
      .from(projectScripts)
      .where(scope(projectId))
      .orderBy(asc(projectScripts.name), asc(projectScripts.id))
      .all();
  const requireScript = (projectId: string, scriptId: string) => {
    requirePublicStandardProject(deps.db, projectId);
    const script = deps.db
      .select()
      .from(projectScripts)
      .where(target(projectId, scriptId))
      .get();
    if (!script)
      throw new ApiError(
        404,
        "project_script_not_found",
        "Project script not found",
      );
    return script;
  };
  const checkConflict = (
    projectId: string,
    input: ProjectScriptInput,
    scriptId: string | null,
  ) => {
    const conflict = deps.db
      .select()
      .from(projectScripts)
      .where(
        and(
          scope(projectId),
          or(
            eq(projectScripts.name, input.name),
            input.shortcut === null
              ? undefined
              : eq(projectScripts.shortcut, input.shortcut),
          ),
        ),
      )
      .all()
      .some((script) => script.id !== scriptId);
    if (conflict)
      throw new ApiError(
        409,
        "project_script_conflict",
        "A script already uses this name or shortcut",
      );
  };
  const create = (projectId: string, input: ProjectScriptInput) => {
    checkConflict(projectId, input, null);
    return deps.db
      .insert(projectScripts)
      .values({
        ...input,
        projectId,
        id: `script_${randomUUID()}`,
      })
      .returning()
      .get();
  };

  get(routes.listScripts, (context) => {
    const projectId = context.req.param("id");
    requirePublicStandardProject(deps.db, projectId);
    return context.json({ scripts: list(projectId) });
  });
  post(routes.createScript, (context, input) => {
    const projectId = context.req.param("id");
    requirePublicStandardProject(deps.db, projectId);
    const script = create(projectId, input);
    deps.hub.notifyProject(projectId, ["project-updated"]);
    return context.json(script, 201);
  });
  put(routes.updateScript, (context, input) => {
    const { id: projectId, scriptId } = context.req.param();
    requireScript(projectId, scriptId);
    checkConflict(projectId, input, scriptId);
    const script = deps.db
      .update(projectScripts)
      .set(input)
      .where(target(projectId, scriptId))
      .returning()
      .get();
    if (!script)
      throw new ApiError(
        404,
        "project_script_not_found",
        "Project script not found",
      );
    deps.hub.notifyProject(projectId, ["project-updated"]);
    return context.json(script);
  });
  del(routes.deleteScript, (context) => {
    const { id: projectId, scriptId } = context.req.param();
    requireScript(projectId, scriptId);
    deps.db.delete(projectScripts).where(target(projectId, scriptId)).run();
    deps.hub.notifyProject(projectId, ["project-updated"]);
    return context.json({ ok: true as const });
  });
  post(routes.importScripts, (context, input) => {
    const projectId = context.req.param("id");
    requirePublicStandardProject(deps.db, projectId);
    const scripts = deps.db.transaction(() =>
      input.scripts.map((script) => create(projectId, script)),
    );
    deps.hub.notifyProject(projectId, ["project-updated"]);
    return context.json({ scripts }, 201);
  });
  post(routes.runScript, async (context, input) => {
    const { id: projectId, scriptId } = context.req.param();
    const script = requireScript(projectId, scriptId);
    const thread = requirePublicThread(deps.db, input.threadId);
    if (thread.projectId !== projectId) {
      throw new ApiError(
        409,
        "project_script_thread_mismatch",
        "Choose a thread in this project to run the script",
      );
    }
    const session = await deps.terminalSessions.createTerminal({
      payload: {
        target: { kind: "thread", threadId: thread.id },
        title: script.name,
        cols: 100,
        rows: 30,
        start: { mode: "shell" },
      },
    });
    const runningSession = deps.terminalSessions.sendTerminalInput({
      terminalId: session.id,
      payload: {
        dataBase64: Buffer.from(`${script.command}\r`, "utf8").toString(
          "base64",
        ),
      },
    });
    return context.json(runningSession, 201);
  });
}
