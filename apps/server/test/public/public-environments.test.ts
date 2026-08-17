import { describe, expect, it } from "vitest";
import { createTerminalSession, getEnvironment, upsertHost } from "@bb/db";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThreadFixture,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public environments", () => {
  it("propagates a bounded truncated diff table of contents", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-truncated-diff",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/truncated-diff-env",
        workspaceProvisionType: "managed-worktree",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/diff/files?target=uncommitted`,
      );
      const diffFilesCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diffFiles" &&
          command.environmentId === environment.id,
      );
      expect(diffFilesCommand.command).toMatchObject({ maxFiles: 500 });
      await reportQueuedCommandSuccess(harness, diffFilesCommand, {
        outcome: "available",
        files: [
          {
            path: "large.bin",
            previousPath: null,
            statusLetter: "A",
            additions: 0,
            deletions: 0,
            binary: true,
            origin: "untracked",
          },
        ],
        shortstat: "1 file changed",
        mergeBaseRef: null,
        truncated: true,
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        outcome: "available",
        truncated: true,
        files: [
          {
            path: "large.bin",
            origin: "untracked",
            loadMode: "on_demand",
          },
        ],
      });
    });
  });

  it("records the daemon-observed current branch after workspace status", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-current-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        branchName: "bb/stale",
        defaultBranch: "main",
        path: "/tmp/current-branch-env",
        workspaceProvisionType: "managed-worktree",
      });

      const statusPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/status`,
      );
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      expect(statusCommand.command).toMatchObject({
        maxUntrackedLineStatFiles: 50,
        maxUntrackedLineStatBytes: 8 * 1024 * 1024,
      });
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: {
          workingTree: {
            insertions: 0,
            deletions: 0,
            lineStatsComplete: true,
            files: [],
            hasUncommittedChanges: false,
            state: "clean",
          },
          branch: {
            currentBranch: "feature/current",
            defaultBranch: "trunk",
          },
          checkout: {
            kind: "branch",
            branchName: "feature/current",
            headSha: null,
          },
          mergeBase: null,
        },
      });

      const response = await statusPromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        outcome: "available",
        workspace: {
          branch: {
            currentBranch: "feature/current",
            defaultBranch: "trunk",
          },
        },
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        branchName: "feature/current",
        defaultBranch: "trunk",
      });
    });
  });

  it("clears the stored branch after detached workspace status", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-detached-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        branchName: "bb/stale",
        defaultBranch: "main",
        path: "/tmp/detached-branch-env",
        workspaceProvisionType: "managed-worktree",
      });

      const statusPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/status`,
      );
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: {
          workingTree: {
            insertions: 0,
            deletions: 0,
            lineStatsComplete: true,
            files: [],
            hasUncommittedChanges: false,
            state: "clean",
          },
          branch: {
            currentBranch: null,
            defaultBranch: "main",
          },
          checkout: {
            kind: "detached",
            headSha: "0123456789abcdef0123456789abcdef01234567",
          },
          mergeBase: null,
        },
      });

      const response = await statusPromise;
      expect(response.status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        branchName: null,
        defaultBranch: "main",
      });
    });
  });

  it("renames an environment through the public update route", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        workspaceProvisionType: "managed-worktree",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "  Review workspace  " }),
        },
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        id: environment.id,
        name: "Review workspace",
      });
    });
  });

  it("renames a worktree branch and folder through the daemon before updating metadata", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-worktree-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/original-worktree",
        branchName: "feature/original",
        workspaceProvisionType: "managed-worktree",
      });

      const branchResponsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/rename`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target: "branch",
            value: "feature/renamed",
          }),
        },
      );
      const branchCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.rename" &&
          command.environmentId === environment.id,
      );
      expect(branchCommand.command).toMatchObject({
        target: "branch",
        value: "feature/renamed",
        workspaceContext: { workspacePath: "/tmp/original-worktree" },
      });
      await reportQueuedCommandSuccess(harness, branchCommand, {
        target: "branch",
        branchName: "feature/renamed",
      });
      expect((await branchResponsePromise).status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        branchName: "feature/renamed",
        path: "/tmp/original-worktree",
      });

      const folderResponsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/rename`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target: "folder", value: "renamed-worktree" }),
        },
      );
      const folderCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.rename" &&
          command.environmentId === environment.id &&
          command.target === "folder",
      );
      await reportQueuedCommandSuccess(harness, folderCommand, {
        target: "folder",
        path: "/tmp/renamed-worktree",
      });
      expect((await folderResponsePromise).status).toBe(200);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        branchName: "feature/renamed",
        path: "/tmp/renamed-worktree",
      });
    });
  });

  it("rejects empty environment updates", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/environments/env_missing",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("lists workspace paths via host.list_paths for a personal-workspace environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-paths",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      // A "personal" workspace is exactly what a projectless thread runs in.
      // The environment-scoped route remains the direct surface used by
      // existing-thread file search for a personal workspace.
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/personal-workspace",
        workspaceProvisionType: "personal",
      });

      const pathsPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/paths?query=app&includeFiles=true&includeDirectories=false`,
      );
      const pathsCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === "/tmp/personal-workspace",
      );
      expect(pathsCommand.command).toMatchObject({
        path: "/tmp/personal-workspace",
        query: "app",
        includeFiles: true,
        includeDirectories: false,
      });
      await reportQueuedCommandSuccess(harness, pathsCommand, {
        paths: [
          {
            kind: "file",
            path: "src/app.ts",
            name: "app.ts",
            score: 80,
            positions: [0, 1, 2],
          },
        ],
        truncated: false,
      });

      const pathsResponse = await pathsPromise;
      expect(pathsResponse.status).toBe(200);
      await expect(readJson(pathsResponse)).resolves.toEqual({
        paths: [
          {
            kind: "file",
            path: "src/app.ts",
            name: "app.ts",
            score: 80,
            positions: [0, 1, 2],
          },
        ],
        truncated: false,
      });
    });
  });

  it("returns not-ready for workspace path search on an unprovisioned environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-environment-paths-pending",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        status: "provisioning",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/paths?query=app&includeFiles=true&includeDirectories=false`,
      );

      expect(response.status).toBe(409);
    });
  });

  it("shares and unshares a local preview port", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness, {
        session: { id: "host-preview-share" },
      });
      upsertHost(harness.db, harness.hub, {
        connectMachineId: "machine-preview-share",
        id: fixture.host.id,
        name: fixture.host.name,
        type: fixture.host.type,
      });
      harness.deps.sharedPorts.recordHostConnectCapability({
        hasMachineCredential: true,
        hostId: fixture.host.id,
        sessionId: fixture.session.id,
      });
      harness.deps.sharedPorts.recordTunnelIdentity(fixture.host.id, {
        baseDomain: "getbb.app",
        label: "preview-host",
      });

      const shareResponse = await harness.app.request(
        `/api/v1/environments/${fixture.environment.id}/previews/share`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ port: 4173 }),
        },
      );

      expect(shareResponse.status).toBe(200);
      await expect(readJson(shareResponse)).resolves.toEqual({
        port: 4173,
        url: "https://preview-host--4173.getbb.app",
      });
      expect(
        harness.deps.sharedPorts.reconcileSharedPortsForHost(fixture.host.id)
          .ports,
      ).toContain(4173);

      const unshareResponse = await harness.app.request(
        `/api/v1/environments/${fixture.environment.id}/previews/unshare`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ port: 4173 }),
        },
      );

      expect(unshareResponse.status).toBe(200);
      await expect(readJson(unshareResponse)).resolves.toEqual({
        port: 4173,
        shared: false,
      });
      expect(
        harness.deps.sharedPorts.reconcileSharedPortsForHost(fixture.host.id)
          .ports,
      ).not.toContain(4173);
    });
  });

  it("keeps one stable preview provider for a restarted development server", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness, {
        session: { id: "host-restarted-preview" },
      });
      const environmentPath = fixture.environment.path;
      if (environmentPath === null) {
        throw new Error("Expected a ready environment path");
      }
      for (const [id, title, now] of [
        ["terminal-old", "Old dev server", 1],
        ["terminal-new", "New dev server", 2],
      ] as const) {
        createTerminalSession(harness.db, {
          cols: 120,
          daemonSessionId: fixture.session.id,
          devServerPort: 4173,
          environmentId: fixture.environment.id,
          hostId: fixture.host.id,
          initialCwd: environmentPath,
          launchCommand: "pnpm dev -- --port 4173",
          now,
          restartPolicy: "until_stopped",
          rows: 32,
          status: "exited",
          supervisionDesired: false,
          supervisionId: id,
          threadId: fixture.thread.id,
          title,
        });
      }

      const responsePromise = harness.app.request(
        `/api/v1/environments/${fixture.environment.id}/previews`,
      );
      const dockerCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "workspace.docker_mounts",
      );
      await reportQueuedCommandSuccess(harness, dockerCommand, {
        containers: [],
        outcome: "available",
        workspaceGit: {
          branch: "feature",
          commonDir: "/repo/.git",
          root: environmentPath,
        },
      });
      const githubCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "workspace.github_deployments",
      );
      await reportQueuedCommandSuccess(harness, githubCommand, {
        message: "Not a GitHub repository",
        outcome: "unavailable",
        reason: "not_github_repository",
      });
      const portCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "workspace.port_status",
      );
      await reportQueuedCommandSuccess(harness, portCommand, {
        isListening: false,
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        providers: [
          {
            id: "terminal:4173",
            label: "New dev server",
            port: 4173,
            source: "terminal",
          },
        ],
      });
    });
  });

  it("uses the environment GitHub account and preserves both deployment URLs", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness, {
        environment: { githubAccountLogin: "amirghst" },
        session: { id: "host-deployment-preview" },
      });
      const environmentPath = fixture.environment.path;
      if (environmentPath === null) {
        throw new Error("Expected a ready environment path");
      }

      const responsePromise = harness.app.request(
        `/api/v1/environments/${fixture.environment.id}/previews`,
      );
      const dockerCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "workspace.docker_mounts",
      );
      await reportQueuedCommandSuccess(harness, dockerCommand, {
        containers: [],
        outcome: "available",
        workspaceGit: {
          branch: "draft/auth",
          commonDir: "/repo/.git",
          root: environmentPath,
        },
      });
      const githubCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "workspace.github_deployments",
      );
      expect(githubCommand.command).toMatchObject({
        githubAccountLogin: "amirghst",
      });
      await reportQueuedCommandSuccess(harness, githubCommand, {
        deployments: [
          {
            createdAt: "2026-08-17T10:00:00Z",
            environment: "Preview – web",
            id: 42,
            latestStatus: {
              branchUrl: "https://branch.preview.example.com",
              createdAt: "2026-08-17T10:01:00Z",
              deploymentUrl: "https://commit.preview.example.com",
              logUrl: "https://logs.example.com/42",
              state: "success",
              updatedAt: "2026-08-17T10:02:00Z",
            },
            ref: "draft/auth",
            updatedAt: "2026-08-17T10:02:00Z",
          },
        ],
        outcome: "available",
        ref: "draft/auth",
        repository: "budah1987/bb",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        providers: [
          {
            branchUrl: "https://branch.preview.example.com/",
            deploymentUrl: "https://commit.preview.example.com/",
            id: "github:Preview – web",
            url: "https://branch.preview.example.com/",
          },
        ],
      });
    });
  });

  it("forwards Docker control to the environment host", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedThreadFixture(harness, {
        session: { id: "host-docker-control" },
      });
      const responsePromise = harness.app.request(
        `/api/v1/environments/${fixture.environment.id}/docker-control`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "restart",
            containerId: "abcdef123456",
          }),
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "workspace.docker_control",
      );
      expect(command.command).toMatchObject({
        action: "restart",
        containerId: "abcdef123456",
        environmentId: fixture.environment.id,
      });
      await reportQueuedCommandSuccess(harness, command, {
        action: "restart",
        containerId: "abcdef123456",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        action: "restart",
        containerId: "abcdef123456",
      });
    });
  });
});
