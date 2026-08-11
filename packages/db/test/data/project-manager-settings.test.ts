import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
import {
  getProjectManagerSettings,
  upsertProjectManagerSettings,
} from "../../src/data/project-manager-settings.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "manager-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "manager-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/manager" },
  });
  return { db, project };
}

describe("project-manager-settings", () => {
  it("stores one complete manager configuration per project", () => {
    const { db, project } = setup();
    expect(getProjectManagerSettings(db, project.id)).toBeNull();

    upsertProjectManagerSettings(db, {
      projectId: project.id,
      enabled: true,
      providerId: "codex",
      model: "gpt-5.4-mini",
      reasoningLevel: "medium",
      serviceTier: "default",
      permissionMode: "auto",
    });
    upsertProjectManagerSettings(db, {
      projectId: project.id,
      enabled: false,
      providerId: "claude-code",
      model: "claude-haiku-4-5",
      reasoningLevel: "low",
      serviceTier: "default",
      permissionMode: "accept-edits",
    });

    expect(getProjectManagerSettings(db, project.id)).toEqual({
      enabled: false,
      providerId: "claude-code",
      model: "claude-haiku-4-5",
      reasoningLevel: "low",
      serviceTier: "default",
      permissionMode: "accept-edits",
    });
  });
});
