import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
import {
  createSpace,
  deleteSpace,
  ensureDefaultSpace,
  listSpaces,
  moveProjectToSpace,
} from "../../src/data/spaces.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  ensureDefaultSpace(db);
  const host = upsertHost(db, noopNotifier, {
    name: "space-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "space-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/space" },
  });
  return { db, project };
}

describe("spaces", () => {
  it("moves each project between exclusive Space memberships", () => {
    const { db, project } = setup();
    const created = createSpace(db, noopNotifier, {
      name: "Work",
      icon: "target",
      color: "blue",
    });

    expect(moveProjectToSpace(db, noopNotifier, {
      projectId: project.id,
      spaceId: created.id,
    })?.projectIds).toEqual([project.id]);
    const listed = listSpaces(db);
    expect(listed.find((space) => space.id === "space_default")?.projectIds).toEqual([]);
    expect(listed.find((space) => space.id === created.id)?.projectIds).toEqual([project.id]);
  });

  it("requires a destination before deleting a populated Space", () => {
    const { db, project } = setup();
    const created = createSpace(db, noopNotifier, {
      name: "Work",
      icon: "target",
      color: "blue",
    });
    moveProjectToSpace(db, noopNotifier, {
      projectId: project.id,
      spaceId: created.id,
    });

    expect(deleteSpace(db, noopNotifier, {
      spaceId: created.id,
      destinationSpaceId: null,
    })).toEqual({ kind: "projects_require_destination" });
    expect(deleteSpace(db, noopNotifier, {
      spaceId: created.id,
      destinationSpaceId: "space_default",
    })).toEqual({ kind: "deleted", movedProjectIds: [project.id] });
    expect(listSpaces(db)[0]?.projectIds).toEqual([project.id]);
  });
});
