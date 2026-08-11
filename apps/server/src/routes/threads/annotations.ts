import {
  createBrowserAnnotation,
  createBrowserAnnotationId,
  deleteBrowserAnnotation,
  deleteBrowserAnnotations,
  listBrowserAnnotations,
  updateBrowserAnnotation,
  type BrowserAnnotationWriteResult,
  type StoredBrowserAnnotation,
} from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type BrowserAnnotation,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import type { AppDeps } from "../../types.js";

function toResponse(row: StoredBrowserAnnotation): BrowserAnnotation {
  return {
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function requireUpdated(
  result: BrowserAnnotationWriteResult,
): BrowserAnnotation {
  if (result.outcome === "not_found") {
    throw new ApiError(404, "annotation_not_found", "Annotation not found");
  }
  if (result.outcome === "conflict") {
    throw new ApiError(
      409,
      "annotation_conflict",
      "Annotation changed on another client",
      { details: { currentRevision: result.revision } },
    );
  }
  return toResponse(result.annotation);
}

export function registerThreadAnnotationRoutes(app: Hono, deps: AppDeps): void {
  const { del, get, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.threads;

  get(routes.annotations, (context, query) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const annotations = listBrowserAnnotations(deps.db, {
      threadId: thread.id,
      ...(query.browserTabId === undefined
        ? {}
        : { browserTabId: query.browserTabId }),
      ...(query.status === undefined ? {} : { status: query.status }),
    });
    return context.json({ annotations: annotations.map(toResponse) });
  });

  post(routes.createAnnotation, (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const annotation = createBrowserAnnotation(deps.db, {
      ...payload,
      id: createBrowserAnnotationId(),
      threadId: thread.id,
    });
    deps.hub.notifyThread(thread.id, ["annotations-changed"]);
    return context.json(toResponse(annotation));
  });

  patch(routes.updateAnnotation, (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const annotation = requireUpdated(
      updateBrowserAnnotation(deps.db, {
        ...payload,
        id: context.req.param("annotationId"),
        threadId: thread.id,
      }),
    );
    deps.hub.notifyThread(thread.id, ["annotations-changed"]);
    return context.json(annotation);
  });

  del(routes.deleteAnnotation, (context, query) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const result = deleteBrowserAnnotation(deps.db, {
      expectedRevision: query.expectedRevision,
      id: context.req.param("annotationId"),
      threadId: thread.id,
    });
    if (result.outcome === "not_found") {
      throw new ApiError(404, "annotation_not_found", "Annotation not found");
    }
    if (result.outcome === "conflict") {
      throw new ApiError(
        409,
        "annotation_conflict",
        "Annotation changed on another client",
        { details: { currentRevision: result.revision } },
      );
    }
    deps.hub.notifyThread(thread.id, ["annotations-changed"]);
    return context.json({ ok: true as const });
  });

  post(routes.clearAnnotations, (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const deleted = deleteBrowserAnnotations(deps.db, {
      threadId: thread.id,
      ...(payload.browserTabId === null
        ? {}
        : { browserTabId: payload.browserTabId }),
      ...(payload.ids === null ? {} : { ids: payload.ids }),
    });
    if (deleted > 0) {
      deps.hub.notifyThread(thread.id, ["annotations-changed"]);
    }
    return context.json({ deleted });
  });
}
