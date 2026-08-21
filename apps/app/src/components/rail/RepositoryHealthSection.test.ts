import { describe, expect, it } from "vitest";
import type { EnvironmentStatusResponse } from "@bb/server-contract";
import {
  getOpenableDeployment,
  summarizeRepositoryHealth,
} from "./RepositoryHealthSection";

function availableStatus(
  overrides: {
    behindCount?: number;
    hasUncommittedChanges?: boolean;
  } = {},
): EnvironmentStatusResponse {
  return {
    outcome: "available",
    workspace: {
      branch: { currentBranch: "codex/dev-server", defaultBranch: "main" },
      checkout: {
        kind: "branch",
        branchName: "codex/dev-server",
        headSha: null,
      },
      workingTree: {
        deletions: 0,
        files: [],
        lineStatsComplete: true,
        hasUncommittedChanges: overrides.hasUncommittedChanges ?? false,
        insertions: 0,
        state: overrides.hasUncommittedChanges ? "dirty_uncommitted" : "clean",
      },
      mergeBase: {
        aheadCount: 1,
        baseRef: "origin/main",
        behindCount: overrides.behindCount ?? 0,
        commits: [],
        deletions: 0,
        files: [],
        lineStatsComplete: true,
        hasCommittedUnmergedChanges: true,
        insertions: 0,
        mergeBaseBranch: "main",
      },
    },
  };
}

describe("summarizeRepositoryHealth", () => {
  it("reports a clean current branch as healthy", () => {
    expect(
      summarizeRepositoryHealth({
        isLoading: false,
        previews: { issues: [], providers: [] },
        pullRequest: { outcome: "absent" },
        status: availableStatus(),
      }),
    ).toEqual({ label: "Healthy", tier: "success" });
  });

  it("reports local changes and an outdated branch as in progress", () => {
    expect(
      summarizeRepositoryHealth({
        isLoading: false,
        previews: { issues: [], providers: [] },
        pullRequest: { outcome: "absent" },
        status: availableStatus({
          behindCount: 2,
          hasUncommittedChanges: true,
        }),
      }),
    ).toEqual({ label: "In progress", tier: "warning" });
  });

  it("gives a failed deployment the highest priority", () => {
    expect(
      summarizeRepositoryHealth({
        isLoading: false,
        previews: {
          issues: [],
          providers: [
            {
              branchUrl: null,
              deploymentUrl: null,
              environment: "preview",
              framePolicy: "unknown",
              frameReason: null,
              id: "github:preview",
              kind: "deployment",
              label: "preview",
              logUrl: null,
              port: null,
              shared: false,
              source: "github",
              state: "failed",
              updatedAt: null,
              url: null,
            },
          ],
        },
        pullRequest: { outcome: "absent" },
        status: availableStatus(),
      }),
    ).toEqual({ label: "Needs attention", tier: "destructive" });
  });

  it("keeps authentication and rate limits consistent across responsive surfaces", () => {
    const common = {
      isLoading: false,
      previews: { issues: [], providers: [] },
      pullRequest: { outcome: "absent" } as const,
      status: availableStatus(),
    };
    expect(
      summarizeRepositoryHealth({
        ...common,
        repositoryHealth: {
          outcome: "authentication_required",
          host: "github.com",
          login: "amir",
          message: "Sign in required",
        },
      }),
    ).toEqual({ label: "Sign in", tier: "destructive" });
    expect(
      summarizeRepositoryHealth({
        ...common,
        repositoryHealth: {
          outcome: "rate_limited",
          host: "github.com",
          login: "amir",
          message: "Limit reached",
          retryAt: "2026-08-20T08:00:00.000Z",
        },
      }),
    ).toEqual({ label: "Limited", tier: "warning" });
  });
});

describe("getOpenableDeployment", () => {
  it("returns the deployment URL that can open in the browser panel", () => {
    const deployment = {
      branchUrl: "https://feature.example.test",
      deploymentUrl: "https://commit.example.test",
      environment: "preview",
      framePolicy: "allowed",
      frameReason: null,
      id: "github:preview",
      kind: "deployment",
      label: "Vercel",
      logUrl: null,
      port: null,
      shared: true,
      source: "github",
      state: "ready",
      updatedAt: null,
      url: "https://feature.example.test",
    } as const;

    expect(getOpenableDeployment([deployment])).toBe(deployment);
    expect(getOpenableDeployment([{ ...deployment, url: null }])).toBeNull();
  });
});
