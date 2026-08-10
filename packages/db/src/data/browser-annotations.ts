import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "../connection.js";
import { browserAnnotations } from "../schema.js";

export type BrowserAnnotationStatus = "open" | "sent" | "resolved";

export interface StoredBrowserAnnotation {
  id: string;
  threadId: string;
  environmentId: string | null;
  browserTabId: string;
  url: string;
  selector: string;
  viewport: { width: number; height: number };
  rectangle: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  comment: string;
  status: BrowserAnnotationStatus;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateBrowserAnnotationInput {
  id: string;
  threadId: string;
  environmentId: string | null;
  browserTabId: string;
  url: string;
  selector: string;
  viewport: { width: number; height: number };
  rectangle: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  comment: string;
  status: BrowserAnnotationStatus;
}

export interface UpdateBrowserAnnotationInput {
  comment?: string;
  expectedRevision: number;
  id: string;
  status?: BrowserAnnotationStatus;
  threadId: string;
}

export type BrowserAnnotationWriteResult =
  | { outcome: "updated"; annotation: StoredBrowserAnnotation }
  | { outcome: "conflict"; revision: number }
  | { outcome: "not_found" };

function toStored(
  row: typeof browserAnnotations.$inferSelect,
): StoredBrowserAnnotation {
  return {
    id: row.id,
    threadId: row.threadId,
    environmentId: row.environmentId,
    browserTabId: row.browserTabId,
    url: row.url,
    selector: row.selector,
    viewport: { width: row.viewportWidth, height: row.viewportHeight },
    rectangle: {
      x: row.rectangleX,
      y: row.rectangleY,
      width: row.rectangleWidth,
      height: row.rectangleHeight,
    },
    comment: row.comment,
    status: row.status,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getFromConnection(
  db: DbConnection | DbTransaction,
  threadId: string,
  id: string,
): StoredBrowserAnnotation | null {
  const row = db
    .select()
    .from(browserAnnotations)
    .where(
      and(
        eq(browserAnnotations.threadId, threadId),
        eq(browserAnnotations.id, id),
      ),
    )
    .get();
  return row ? toStored(row) : null;
}

export function getBrowserAnnotation(
  db: DbConnection,
  threadId: string,
  id: string,
): StoredBrowserAnnotation | null {
  return getFromConnection(db, threadId, id);
}

export function listBrowserAnnotations(
  db: DbConnection,
  args: {
    browserTabId?: string;
    status?: BrowserAnnotationStatus;
    threadId: string;
  },
): StoredBrowserAnnotation[] {
  const conditions = [eq(browserAnnotations.threadId, args.threadId)];
  if (args.browserTabId !== undefined) {
    conditions.push(eq(browserAnnotations.browserTabId, args.browserTabId));
  }
  if (args.status !== undefined) {
    conditions.push(eq(browserAnnotations.status, args.status));
  }
  return db
    .select()
    .from(browserAnnotations)
    .where(and(...conditions))
    .orderBy(asc(browserAnnotations.createdAt), asc(browserAnnotations.id))
    .all()
    .map(toStored);
}

export function createBrowserAnnotation(
  db: DbConnection,
  input: CreateBrowserAnnotationInput,
): StoredBrowserAnnotation {
  return db.transaction((tx) => {
    const now = Date.now();
    tx.insert(browserAnnotations)
      .values({
        id: input.id,
        threadId: input.threadId,
        environmentId: input.environmentId,
        browserTabId: input.browserTabId,
        url: input.url,
        selector: input.selector,
        viewportWidth: input.viewport.width,
        viewportHeight: input.viewport.height,
        rectangleX: input.rectangle.x,
        rectangleY: input.rectangle.y,
        rectangleWidth: input.rectangle.width,
        rectangleHeight: input.rectangle.height,
        comment: input.comment,
        status: input.status,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const annotation = getFromConnection(tx, input.threadId, input.id);
    if (annotation === null) {
      throw new Error("Created browser annotation could not be read");
    }
    return annotation;
  });
}

export function updateBrowserAnnotation(
  db: DbConnection,
  input: UpdateBrowserAnnotationInput,
): BrowserAnnotationWriteResult {
  return db.transaction((tx) => {
    const current = getFromConnection(tx, input.threadId, input.id);
    if (current === null) return { outcome: "not_found" };
    if (current.revision !== input.expectedRevision) {
      return { outcome: "conflict", revision: current.revision };
    }
    tx.update(browserAnnotations)
      .set({
        ...(input.comment === undefined ? {} : { comment: input.comment }),
        ...(input.status === undefined ? {} : { status: input.status }),
        revision: current.revision + 1,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(browserAnnotations.threadId, input.threadId),
          eq(browserAnnotations.id, input.id),
          eq(browserAnnotations.revision, input.expectedRevision),
        ),
      )
      .run();
    const annotation = getFromConnection(tx, input.threadId, input.id);
    if (annotation === null) return { outcome: "not_found" };
    return { outcome: "updated", annotation };
  });
}

export function deleteBrowserAnnotation(
  db: DbConnection,
  args: { expectedRevision: number; id: string; threadId: string },
): BrowserAnnotationWriteResult | { outcome: "deleted" } {
  return db.transaction((tx) => {
    const current = getFromConnection(tx, args.threadId, args.id);
    if (current === null) return { outcome: "not_found" };
    if (current.revision !== args.expectedRevision) {
      return { outcome: "conflict", revision: current.revision };
    }
    tx.delete(browserAnnotations)
      .where(
        and(
          eq(browserAnnotations.threadId, args.threadId),
          eq(browserAnnotations.id, args.id),
          eq(browserAnnotations.revision, args.expectedRevision),
        ),
      )
      .run();
    return { outcome: "deleted" };
  });
}

export function deleteBrowserAnnotations(
  db: DbConnection,
  args: { browserTabId?: string; ids?: string[]; threadId: string },
): number {
  return db.transaction((tx) => {
    const conditions = [eq(browserAnnotations.threadId, args.threadId)];
    if (args.browserTabId !== undefined) {
      conditions.push(eq(browserAnnotations.browserTabId, args.browserTabId));
    }
    if (args.ids !== undefined) {
      if (args.ids.length === 0) return 0;
      conditions.push(inArray(browserAnnotations.id, args.ids));
    }
    return tx
      .delete(browserAnnotations)
      .where(and(...conditions))
      .run().changes;
  });
}
