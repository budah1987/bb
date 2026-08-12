import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import performanceBudgets from "../../../../performance-budgets.json" with {
  type: "json",
};
import { createConnection } from "../../src/connection.js";
import { createEnvironment } from "../../src/data/environments.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  createThread,
  listInitialSidebarThreadsWithPendingInteractionStateForProjects,
} from "../../src/data/threads.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";

describe("sidebar performance budgets", () => {
  it("loads 20 workspaces from 5,000 tasks within query and payload budgets", () => {
    vi.useFakeTimers();
    try {
      const db = createConnection(":memory:");
      migrate(db);
      const host = upsertHost(db, noopNotifier, {
        name: "stress-host",
        type: "persistent",
      });
      const projectIds: string[] = [];
      for (let projectIndex = 0; projectIndex < 20; projectIndex += 1) {
        const { project } = createProject(db, noopNotifier, {
          name: `stress-project-${projectIndex}`,
          source: {
            hostId: host.id,
            path: `/tmp/stress-project-${projectIndex}`,
            type: "local_path",
          },
        });
        projectIds.push(project.id);
        const environment = createEnvironment(db, noopNotifier, {
          hostId: host.id,
          path: `/tmp/stress-project-${projectIndex}`,
          projectId: project.id,
          workspaceProvisionType: "unmanaged",
        });
        for (let threadIndex = 0; threadIndex < 250; threadIndex += 1) {
          vi.setSystemTime(projectIndex * 250 + threadIndex + 1);
          createThread(db, noopNotifier, {
            environmentId: environment.id,
            projectId: project.id,
            providerId: "codex",
            status: "idle",
          });
        }
      }

      const startedAt = performance.now();
      const result =
        listInitialSidebarThreadsWithPendingInteractionStateForProjects(db, {
          limitPerProject: 50,
          projectIds,
        });
      const queryMs = performance.now() - startedAt;
      const payloadBytes = Buffer.byteLength(JSON.stringify(result.threads));

      expect(result.threads).toHaveLength(1_000);
      expect(queryMs).toBeLessThanOrEqual(
        performanceBudgets.sidebar.maxQueryMs,
      );
      expect(payloadBytes).toBeLessThanOrEqual(
        performanceBudgets.sidebar.maxInitialPayloadBytes,
      );
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);
});
