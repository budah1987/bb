import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  resolveRootComposeThreadEnvironment,
  type RootComposeSelectedBranch,
} from "./root-compose-thread-environment";

const projectId = "proj_123";
const hostWorktreeEnvironmentValue = "host:host_123:worktree";
const hostLocalEnvironmentValue = "host:host_123:local";

function selectedBranch(name: string): RootComposeSelectedBranch {
  return { name, isNew: false };
}

describe("resolveRootComposeThreadEnvironment", () => {
  it("omits unmanaged branch checkout when no branch is selected", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: null,
        defaultWorktreeBaseBranch: null,
        environmentValue: hostLocalEnvironmentValue,
        projectId,
        selectedBranch: null,
      }),
    ).toEqual({
      type: "host",
      hostId: "host_123",
      workspace: {
        type: "unmanaged",
        path: null,
      },
    });
  });

  it("sends explicit existing branch checkout for host local", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: null,
        defaultWorktreeBaseBranch: null,
        environmentValue: hostLocalEnvironmentValue,
        projectId,
        selectedBranch: selectedBranch("develop"),
      }),
    ).toMatchObject({
      workspace: {
        type: "unmanaged",
        branch: {
          kind: "existing",
          name: "develop",
        },
      },
    });
  });

  it("sends explicit new branch checkout for host local", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: null,
        defaultWorktreeBaseBranch: null,
        environmentValue: hostLocalEnvironmentValue,
        projectId,
        selectedBranch: { name: "develop", isNew: true },
      }),
    ).toMatchObject({
      workspace: {
        type: "unmanaged",
        branch: { kind: "new", baseBranch: "develop" },
      },
    });
  });

  it("preserves the requested branch name for host local", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "main",
        environmentValue: hostLocalEnvironmentValue,
        projectId,
        selectedBranch: {
          name: "main",
          isNew: true,
          requestedName: "feature/github-workflow",
        },
      }),
    ).toMatchObject({
      workspace: {
        type: "unmanaged",
        branch: {
          kind: "new",
          baseBranch: "main",
          name: "feature/github-workflow",
        },
      },
    });
  });

  it("sends pull-request checkout intent for host local", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "main",
        environmentValue: hostLocalEnvironmentValue,
        projectId,
        selectedBranch: {
          name: "main",
          isNew: false,
          requestedName: "pr-42-feature",
          pullRequest: {
            number: 42,
            title: "Feature",
            url: "https://github.com/acme/repo/pull/42",
            isDraft: false,
            headBranch: "feature",
            headRepository: "contributor/repo",
            baseBranch: "main",
            author: "contributor",
            updatedAt: "2026-08-05T00:00:00.000Z",
          },
        },
      }),
    ).toMatchObject({
      workspace: {
        type: "unmanaged",
        branch: { kind: "pull-request", number: 42, name: "pr-42-feature" },
      },
    });
  });

  it("sends default base branch for managed worktrees without an explicit pick", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "main",
        environmentValue: hostWorktreeEnvironmentValue,
        projectId,
        selectedBranch: null,
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    });
  });

  it("sends smart remote default base branch for managed worktrees without an explicit pick", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "origin/main",
        environmentValue: hostWorktreeEnvironmentValue,
        projectId,
        selectedBranch: null,
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "origin/main" },
      },
    });
  });

  it("sends a named base branch when the selected branch matches the env's current", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "origin/main",
        environmentValue: hostWorktreeEnvironmentValue,
        projectId,
        selectedBranch: selectedBranch("develop"),
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "develop" },
      },
    });
  });

  it("preserves named branch and pull-request inputs for managed worktrees", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "origin/main",
        environmentValue: hostWorktreeEnvironmentValue,
        projectId,
        selectedBranch: {
          name: "main",
          isNew: false,
          requestedName: "pr-42-feature",
          pullRequest: {
            number: 42,
            title: "Feature",
            url: "https://github.com/acme/repo/pull/42",
            isDraft: false,
            headBranch: "feature",
            headRepository: "contributor/repo",
            baseBranch: "main",
            author: "contributor",
            updatedAt: "2026-08-05T00:00:00.000Z",
          },
        },
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        branchName: "pr-42-feature",
        pullRequestNumber: 42,
      },
    });
  });

  it("uses personal workspaces for the personal project", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: null,
        defaultWorktreeBaseBranch: null,
        environmentValue: hostLocalEnvironmentValue,
        projectId: PERSONAL_PROJECT_ID,
        selectedBranch: selectedBranch("develop"),
      }),
    ).toEqual({
      type: "host",
      hostId: "host_123",
      workspace: { type: "personal" },
    });
  });
});
