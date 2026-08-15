import { describe, expect, it } from "vitest";
import { getEnvironment, getThread } from "@bb/db";
import type { GitHostPullRequest } from "@bb/domain";
import { environmentArchiveThreadsResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import {
  listQueuedEnvironmentCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

function rawPullRequest(
  overrides: Partial<GitHostPullRequest> = {},
): GitHostPullRequest {
  return {
    number: 42,
    title: "Add pull request actions",
    state: "OPEN",
    url: "https://github.com/acme/bb/pull/42",
    isDraft: false,
    baseRefName: "main",
    headRefName: "bb/pr-actions",
    updatedAt: "2026-06-16T12:30:00Z",
    checks: [],
    reviewDecision: null,
    reviewRequestCount: 0,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    ...overrides,
  };
}

describe("public environment action regressions", () => {
  it("archives every conversation in an unmanaged environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-unmanaged-environment-archive",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/unmanaged-environment-archive",
        workspaceProvisionType: "unmanaged",
      });
      const idleThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const activeThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/archive-threads`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      const archiveResult = environmentArchiveThreadsResponseSchema.parse(
        await readJson(response),
      );
      expect(archiveResult.archivedThreadIds).toHaveLength(2);
      expect(archiveResult.archivedThreadIds).toEqual(
        expect.arrayContaining([idleThread.id, activeThread.id]),
      );
      expect(getThread(harness.db, idleThread.id)?.archivedAt).not.toBeNull();
      expect(getThread(harness.db, activeThread.id)?.archivedAt).not.toBeNull();

      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === activeThread.id,
      );
      await reportQueuedCommandSuccess(harness, stopCommand, {
        providerCheckpointId: null,
      });

      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "ready",
        workspaceProvisionType: "unmanaged",
      });
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.destroy",
          environment.id,
        ),
      ).toHaveLength(0);
    });
  });

  it("persists a GitHub account and scopes PR lookups to it", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-github-account",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/github-account-env",
        workspaceProvisionType: "managed-worktree",
      });

      const updatePromise = harness.app.request(
        `/api/v1/environments/${environment.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ githubAccountLogin: "budah1987" }),
        },
      );
      const accountCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "github.account_catalog",
      );
      await reportQueuedCommandSuccess(harness, accountCommand, {
        accounts: [
          { active: true, host: "github.com", login: "amirghst" },
          { active: false, host: "github.com", login: "budah1987" },
        ],
      });

      const updateResponse = await updatePromise;
      expect(updateResponse.status).toBe(200);
      await expect(readJson(updateResponse)).resolves.toMatchObject({
        githubAccountLogin: "budah1987",
      });

      const pullRequestPromise = harness.app.request(
        `/api/v1/environments/${environment.id}/pull-request`,
      );
      const pullRequestCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "workspace.pull_request",
      );
      expect(pullRequestCommand.command).toMatchObject({
        githubAccountLogin: "budah1987",
      });
      await reportQueuedCommandSuccess(harness, pullRequestCommand, {
        outcome: "absent",
      });

      const pullRequestResponse = await pullRequestPromise;
      expect(pullRequestResponse.status).toBe(200);
      await expect(readJson(pullRequestResponse)).resolves.toEqual({
        outcome: "absent",
      });
    });
  });

  it("prepares pull request metadata for an unmanaged git checkout", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pr-metadata",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        branchName: "feature/pr-metadata",
        defaultBranch: "main",
        path: "/tmp/pr-metadata-env",
        workspaceProvisionType: "unmanaged",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "pull_request_metadata",
            options: {
              baseBranch: "main",
              fallbackTitle: "Improve pull request creation",
            },
          }),
        },
      );

      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      expect(diffCommand.command).toMatchObject({
        target: { type: "branch_committed", mergeBaseBranch: "main" },
      });
      await reportQueuedCommandSuccess(harness, diffCommand, {
        outcome: "available",
        diff: {
          diff: "",
          files: "",
          mergeBaseRef: null,
          shortstat: "",
          truncated: false,
        },
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        ok: true,
        action: "pull_request_metadata",
        title: "Improve pull request creation",
        body: "",
        generated: false,
      });
    });
  });

  it("rejects malformed squash-merge payload with a 400", async () => {
    await withTestHarness(async (harness) => {
      const squashMergeResponse = await harness.app.request(
        "/api/v1/environments/env_missing/actions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "squash_merge",
          }),
        },
      );
      expect(squashMergeResponse.status).toBe(400);
      await expect(readJson(squashMergeResponse)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("publishes a managed branch directly to main through the host daemon", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-publish-to-main",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/publish-to-main",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "publish_to_main",
            options: { preserveTargetChanges: true },
          }),
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        ({ command: queued }) =>
          queued.type === "workspace.publish_committed_branch" &&
          queued.environmentId === environment.id,
      );
      expect(command.command).toMatchObject({
        targetBranch: "main",
        preserveTargetChanges: true,
      });
      await reportQueuedCommandSuccess(harness, command, {
        outcome: "published",
        sourceBranch: "meeting-ingestion/sku-coverage",
        targetBranch: "main",
        sourceCommitSha: "source-sha",
        remoteTargetBeforeSha: "remote-before",
        remoteTargetAfterSha: "source-sha",
        localTargetBeforeSha: "local-before",
        localTargetAfterSha: "source-sha",
        preservedTargetChangesCommitSha: "local-preservation-sha",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: true,
        action: "publish_to_main",
        sourceBranch: "meeting-ingestion/sku-coverage",
        targetBranch: "main",
        localTargetAfterSha: "source-sha",
        preservedTargetChangesCommitSha: "local-preservation-sha",
      });
    });
  });

  it("returns structured publish blockers from the host daemon", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-publish-to-main-blocked",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/publish-to-main-blocked",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "publish_to_main" }),
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        ({ command: queued }) =>
          queued.type === "workspace.publish_committed_branch" &&
          queued.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, command, {
        outcome: "blocked",
        reason: "target_dirty",
        sourceBranch: "meeting-ingestion/sku-coverage",
        targetBranch: "main",
        sourceCommitSha: "source-sha",
        remoteTargetSha: "remote-sha",
        localTargetSha: "local-sha",
        conflictFiles: [],
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "publish_to_main_blocked",
        details: {
          kind: "publish_to_main_blocked",
          reason: "target_dirty",
          targetBranch: "main",
          remoteTargetSha: "remote-sha",
          localTargetSha: "local-sha",
        },
      });
    });
  });

  it("updates an attached Git worktree from main through the host daemon", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-update-from-main",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: false,
        workspaceProvisionType: "unmanaged",
        isWorktree: true,
        path: "/tmp/update-from-main",
      });
      seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "idle",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "update_from_main", options: {} }),
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        ({ command: queued }) =>
          queued.type === "workspace.update_from_target" &&
          queued.environmentId === environment.id,
      );
      expect(command.command).toMatchObject({
        targetBranch: "main",
        workspaceContext: { workspaceProvisionType: "unmanaged" },
      });
      await reportQueuedCommandSuccess(harness, command, {
        outcome: "updated",
        sourceBranch: "feature/update",
        targetBranch: "main",
        previousSha: "previous-sha",
        currentSha: "current-sha",
        targetSha: "target-sha",
        rebasedCommitCount: 2,
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        ok: true,
        action: "update_from_main",
        outcome: "updated",
        currentSha: "current-sha",
        rebasedCommitCount: 2,
      });
    });
  });

  it("rejects a Git checkout that is not a worktree", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-update-from-main-checkout",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        workspaceProvisionType: "unmanaged",
        isWorktree: false,
        path: "/tmp/update-from-main-checkout",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "update_from_main", options: {} }),
        },
      );

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
        message: "Updating from main requires a Git worktree",
      });
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "workspace.update_from_target",
          environment.id,
        ),
      ).toHaveLength(0);
    });
  });

  it("does not update from main while a conversation can use the workspace", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-update-from-main-busy",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/update-from-main-busy",
      });
      seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });

      const response = await harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "update_from_main", options: {} }),
        },
      );

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "environment_busy",
        message:
          "Stop active conversations in this workspace before updating from main",
        details: {
          kind: "workspace_busy",
          action: "update_from_main",
          reason: "active_threads",
        },
      });
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "workspace.update_from_target",
          environment.id,
        ),
      ).toHaveLength(0);
    });
  });

  it("returns structured update conflicts from the host daemon", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-update-from-main-blocked",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/update-from-main-blocked",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "update_from_main", options: {} }),
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        ({ command: queued }) =>
          queued.type === "workspace.update_from_target" &&
          queued.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, command, {
        outcome: "blocked",
        reason: "rebase_conflict",
        sourceBranch: "feature/update",
        targetBranch: "main",
        previousSha: "previous-sha",
        targetSha: "target-sha",
        conflictFiles: ["README.md"],
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "update_from_main_blocked",
        details: {
          kind: "update_from_main_blocked",
          reason: "rebase_conflict",
          conflictFiles: ["README.md"],
        },
      });
    });
  });

  it("rejects legacy environment action payloads that still send threadId", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-target",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/thread-target",
      });

      const mismatchedResponse = await harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "commit",
            threadId: "thread-legacy",
          }),
        },
      );
      expect(mismatchedResponse.status).toBe(400);
      await expect(readJson(mismatchedResponse)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("records the daemon-observed branch during commit action status preflight", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-commit-observed-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        branchName: "bb/stale",
        defaultBranch: "main",
        path: "/tmp/commit-observed-branch-env",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "commit" }),
        },
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

      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, diffCommand, {
        outcome: "available",
        diff: {
          diff: "",
          files: "",
          mergeBaseRef: null,
          shortstat: "",
          truncated: false,
        },
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "no_changes",
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        branchName: "feature/current",
        defaultBranch: "trunk",
      });
    });
  });

  it("blocks squash merge when the selected worktree has uncommitted changes", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-squash-dirty-worktree",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "feature/dirty",
        defaultBranch: "main",
        path: "/tmp/squash-dirty-worktree",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "squash_merge",
            options: { mergeBaseBranch: "main" },
          }),
        },
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
            insertions: 1,
            deletions: 0,
            lineStatsComplete: true,
            files: [
              {
                path: "README.md",
                status: "M",
                insertions: 1,
                deletions: 0,
              },
            ],
            hasUncommittedChanges: true,
            state: "dirty_uncommitted",
          },
          branch: {
            currentBranch: "feature/dirty",
            defaultBranch: "main",
          },
          checkout: {
            kind: "branch",
            branchName: "feature/dirty",
            headSha: null,
          },
          mergeBase: null,
        },
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "dirty_worktree",
        details: { kind: "squash_merge_dirty_worktree" },
      });
    });
  });

  it("clears the stored branch during detached squash-merge status preflight", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-squash-detached-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        branchName: "bb/stale",
        defaultBranch: "main",
        path: "/tmp/squash-detached-branch-env",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "squash_merge",
            options: { mergeBaseBranch: "main" },
          }),
        },
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

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        branchName: null,
        defaultBranch: "main",
      });
    });
  });

  it("marks draft pull requests ready through the environment action route", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pr-ready",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/pr-ready-env",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "pull_request_ready",
          }),
        },
      );

      const pullRequestCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.pull_request" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, pullRequestCommand, {
        outcome: "available",
        pullRequest: rawPullRequest({ isDraft: true }),
      });

      const readyCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.pull_request_action" &&
          command.environmentId === environment.id,
      );
      expect(readyCommand.command).toMatchObject({
        operation: "ready",
      });
      await reportQueuedCommandSuccess(harness, readyCommand, {});

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        action: "pull_request_ready",
        ok: true,
      });
    });
  });

  it("converts open pull requests back to draft through the environment action route", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pr-draft",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/pr-draft-env",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "pull_request_draft",
          }),
        },
      );

      const pullRequestCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.pull_request" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, pullRequestCommand, {
        outcome: "available",
        pullRequest: rawPullRequest(),
      });

      const draftCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.pull_request_action" &&
          command.environmentId === environment.id,
      );
      expect(draftCommand.command).toMatchObject({
        operation: "draft",
      });
      await reportQueuedCommandSuccess(harness, draftCommand, {});

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        action: "pull_request_draft",
        ok: true,
      });
    });
  });

  it("rejects blocked pull request merges before dispatching a merge command", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pr-blocked",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/pr-blocked-env",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "pull_request_merge",
            options: { method: "merge" },
          }),
        },
      );

      const pullRequestCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.pull_request" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, pullRequestCommand, {
        outcome: "available",
        pullRequest: rawPullRequest({
          mergeStateStatus: "BLOCKED",
          mergeable: "UNKNOWN",
        }),
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "pull_request_not_mergeable",
      });
    });
  });

  it("merges open pull requests through the selected merge method", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pr-merge",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/pr-merge-env",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "pull_request_merge",
            options: { method: "rebase" },
          }),
        },
      );

      const pullRequestCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.pull_request" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, pullRequestCommand, {
        outcome: "available",
        pullRequest: rawPullRequest(),
      });

      const mergeCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.pull_request_action" &&
          command.environmentId === environment.id,
      );
      expect(mergeCommand.command).toMatchObject({
        operation: "merge",
        method: "rebase",
      });
      await reportQueuedCommandSuccess(harness, mergeCommand, {});

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        action: "pull_request_merge",
        method: "rebase",
        ok: true,
      });
    });
  });

  it("re-runs all failed pull request checks", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pr-check-rerun",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/pr-check-rerun-env",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "pull_request_checks_rerun",
            options: { scope: "failed" },
          }),
        },
      );

      const pullRequestCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.pull_request" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, pullRequestCommand, {
        outcome: "available",
        pullRequest: rawPullRequest({
          checks: [
            {
              name: "typecheck",
              status: "completed",
              conclusion: "failure",
              url: "https://github.com/acme/bb/actions/runs/123/job/456",
              startedAt: null,
            },
          ],
        }),
      });

      const rerunCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.pull_request_checks_rerun" &&
          command.environmentId === environment.id,
      );
      expect(rerunCommand.command).toMatchObject({
        target: { scope: "failed" },
      });
      await reportQueuedCommandSuccess(harness, rerunCommand, {
        rerunCount: 1,
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        action: "pull_request_checks_rerun",
        ok: true,
        rerunCount: 1,
      });
    });
  });
});
