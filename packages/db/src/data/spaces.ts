import { and, asc, eq, isNull } from "drizzle-orm";
import {
  DEFAULT_SPACE_ID,
  type SpaceColor,
  type SpaceIcon,
} from "@bb/domain";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { createSpaceId } from "../ids.js";
import { projects, spaceProjects, spaces } from "../schema.js";
import { createOrderKeyAfter, createOrderKeyBetween } from "./order-keys.js";

export type SpaceRow = typeof spaces.$inferSelect;

export interface SpaceWithProjects extends SpaceRow {
  projectIds: string[];
}

export interface CreateSpaceInput {
  color: SpaceColor;
  icon: SpaceIcon;
  name: string;
}

export interface UpdateSpaceInput {
  color: SpaceColor;
  icon: SpaceIcon;
  name: string;
}

export type DeleteSpaceResult =
  | { kind: "deleted"; movedProjectIds: string[] }
  | { kind: "invalid_destination" }
  | { kind: "last_space" }
  | { kind: "not_found" }
  | { kind: "projects_require_destination" };

function listOrderedSpaces(db: DbQueryConnection): SpaceRow[] {
  return db
    .select()
    .from(spaces)
    .orderBy(asc(spaces.sortKey), asc(spaces.id))
    .all();
}

export function ensureDefaultSpace(db: DbConnection): SpaceRow {
  const now = Date.now();
  db.insert(spaces)
    .values({
      id: DEFAULT_SPACE_ID,
      name: "Main",
      icon: "layers",
      color: "sage",
      sortKey: "V",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  const firstSpace = listOrderedSpaces(db)[0];
  if (!firstSpace) throw new Error("Default Space was not created");

  const unassignedProjectIds = db
    .select({ projectId: projects.id })
    .from(projects)
    .leftJoin(spaceProjects, eq(spaceProjects.projectId, projects.id))
    .where(
      and(
        eq(projects.kind, "standard"),
        isNull(projects.deletedAt),
        isNull(spaceProjects.projectId),
      ),
    )
    .all();
  if (unassignedProjectIds.length > 0) {
    db.insert(spaceProjects)
      .values(
        unassignedProjectIds.map(({ projectId }) => ({
          projectId,
          spaceId: firstSpace.id,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing()
      .run();
  }
  return firstSpace;
}

export function listSpaces(db: DbConnection): SpaceWithProjects[] {
  const orderedSpaces = listOrderedSpaces(db);
  const projectIdsBySpaceId = new Map<string, string[]>();
  const memberships = db
    .select({ projectId: spaceProjects.projectId, spaceId: spaceProjects.spaceId })
    .from(spaceProjects)
    .innerJoin(projects, eq(projects.id, spaceProjects.projectId))
    .where(and(eq(projects.kind, "standard"), isNull(projects.deletedAt)))
    .orderBy(asc(projects.sortKey), asc(projects.id))
    .all();
  for (const membership of memberships) {
    const projectIds = projectIdsBySpaceId.get(membership.spaceId) ?? [];
    projectIds.push(membership.projectId);
    projectIdsBySpaceId.set(membership.spaceId, projectIds);
  }
  return orderedSpaces.map((space) => ({
    ...space,
    projectIds: projectIdsBySpaceId.get(space.id) ?? [],
  }));
}

export function createSpace(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateSpaceInput,
): SpaceWithProjects {
  const now = Date.now();
  const previous = listOrderedSpaces(db).at(-1);
  const space = db
    .insert(spaces)
    .values({
      id: createSpaceId(),
      name: input.name,
      icon: input.icon,
      color: input.color,
      sortKey: previous
        ? createOrderKeyAfter({ previousKey: previous.sortKey })
        : createOrderKeyBetween({ previousKey: null, nextKey: null }),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  notifier.notifySystem(["spaces-changed"]);
  return { ...space, projectIds: [] };
}

export function updateSpace(
  db: DbConnection,
  notifier: DbNotifier,
  spaceId: string,
  input: UpdateSpaceInput,
): SpaceWithProjects | null {
  const updated = db
    .update(spaces)
    .set({ ...input, updatedAt: Date.now() })
    .where(eq(spaces.id, spaceId))
    .returning()
    .get();
  if (!updated) return null;
  notifier.notifySystem(["spaces-changed"]);
  return listSpaces(db).find((space) => space.id === spaceId) ?? null;
}

export function moveProjectToSpace(
  db: DbConnection,
  notifier: DbNotifier,
  args: { projectId: string; spaceId: string },
): SpaceWithProjects | null {
  const space = db.select().from(spaces).where(eq(spaces.id, args.spaceId)).get();
  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, args.projectId),
        eq(projects.kind, "standard"),
        isNull(projects.deletedAt),
      ),
    )
    .get();
  if (!space || !project) return null;
  db.insert(spaceProjects)
    .values({
      projectId: args.projectId,
      spaceId: args.spaceId,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: spaceProjects.projectId,
      set: { spaceId: args.spaceId, updatedAt: Date.now() },
    })
    .run();
  notifier.notifySystem(["spaces-changed"]);
  return listSpaces(db).find((candidate) => candidate.id === args.spaceId) ?? null;
}

export function deleteSpace(
  db: DbConnection,
  notifier: DbNotifier,
  args: { destinationSpaceId: string | null; spaceId: string },
): DeleteSpaceResult {
  const result = db.transaction((tx): DeleteSpaceResult => {
    const orderedSpaces = listOrderedSpaces(tx);
    const deletedSpace = orderedSpaces.find((space) => space.id === args.spaceId);
    if (!deletedSpace) return { kind: "not_found" };
    if (orderedSpaces.length === 1) return { kind: "last_space" };

    const movedProjectIds = tx
      .select({ projectId: spaceProjects.projectId })
      .from(spaceProjects)
      .where(eq(spaceProjects.spaceId, args.spaceId))
      .all()
      .map((membership) => membership.projectId);
    if (movedProjectIds.length > 0 && args.destinationSpaceId === null) {
      return { kind: "projects_require_destination" };
    }
    if (args.destinationSpaceId !== null) {
      const destination = orderedSpaces.find(
        (space) =>
          space.id === args.destinationSpaceId && space.id !== args.spaceId,
      );
      if (!destination) return { kind: "invalid_destination" };
      tx.update(spaceProjects)
        .set({ spaceId: destination.id, updatedAt: Date.now() })
        .where(eq(spaceProjects.spaceId, args.spaceId))
        .run();
    }
    tx.delete(spaces).where(eq(spaces.id, args.spaceId)).run();
    return { kind: "deleted", movedProjectIds };
  });
  if (result.kind === "deleted") notifier.notifySystem(["spaces-changed"]);
  return result;
}
