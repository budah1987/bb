import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import type { PluginService } from "../../services/plugins/plugin-service.js";
import { registerThreadActionRoutes } from "./actions.js";
import { registerThreadBaseRoutes } from "./base.js";
import { registerThreadDataRoutes } from "./data.js";
import { registerThreadInteractionRoutes } from "./interactions.js";
import { registerThreadNotesRoutes } from "./notes.js";
import { registerThreadTabRoutes } from "./tabs.js";
import { registerThreadAnnotationRoutes } from "./annotations.js";

export function registerThreadRoutes(
  app: Hono,
  deps: AppDeps,
  plugins: PluginService,
): void {
  registerThreadBaseRoutes(app, deps);
  registerThreadActionRoutes(app, deps);
  registerThreadDataRoutes(app, deps, plugins);
  registerThreadInteractionRoutes(app, deps);
  registerThreadTabRoutes(app, deps);
  registerThreadAnnotationRoutes(app, deps);
  registerThreadNotesRoutes(app, deps);
}
