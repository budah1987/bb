import type { Hono } from "hono";
import {
  createSpace,
  deleteSpace,
  listSpaces,
  moveProjectToSpace,
  updateSpace,
  type DeleteSpaceResult,
  type SpaceWithProjects,
} from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
  type SpaceResponse,
} from "@bb/server-contract";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";

function toSpaceResponse(space: SpaceWithProjects): SpaceResponse {
  return {
    id: space.id,
    name: space.name,
    icon: space.icon,
    color: space.color,
    projectIds: space.projectIds,
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
  };
}

function resolveDeleteSpaceResult(result: DeleteSpaceResult) {
  switch (result.kind) {
    case "deleted":
      return { ok: true as const, movedProjectIds: result.movedProjectIds };
    case "not_found":
      throw new ApiError(404, "not_found", "Space not found");
    case "last_space":
      throw new ApiError(
        409,
        "invalid_request",
        "The last Space cannot be deleted",
      );
    case "projects_require_destination":
      throw new ApiError(
        409,
        "invalid_request",
        "Choose a destination Space for these projects",
      );
    case "invalid_destination":
      throw new ApiError(400, "invalid_request", "Destination Space not found");
  }
}

export function registerSpaceRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.spaces;

  get(routes.list, (context) =>
    context.json(listSpaces(deps.db).map(toSpaceResponse)),
  );

  post(routes.create, (context, request) =>
    context.json(toSpaceResponse(createSpace(deps.db, deps.hub, request)), 201),
  );

  patch(routes.update, (context, request) => {
    const space = updateSpace(
      deps.db,
      deps.hub,
      context.req.param("id"),
      request,
    );
    if (!space) throw new ApiError(404, "not_found", "Space not found");
    return context.json(toSpaceResponse(space));
  });

  patch(routes.moveProject, (context) => {
    const space = moveProjectToSpace(deps.db, deps.hub, {
      projectId: context.req.param("projectId"),
      spaceId: context.req.param("id"),
    });
    if (!space) {
      throw new ApiError(404, "not_found", "Space or project not found");
    }
    return context.json(toSpaceResponse(space));
  });

  del(routes.delete, (context, request) =>
    context.json(
      resolveDeleteSpaceResult(
        deleteSpace(deps.db, deps.hub, {
          destinationSpaceId: request.destinationSpaceId,
          spaceId: context.req.param("id"),
        }),
      ),
    ),
  );
}

export function buildSpaceResponses(
  deps: Pick<AppDeps, "db">,
): SpaceResponse[] {
  return listSpaces(deps.db).map(toSpaceResponse);
}
