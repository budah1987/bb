import { describe, expect, it } from "vitest";
import type { EnvironmentStatusResponse } from "@bb/server-contract";
import { summarizeBranchHealth } from "./BranchHealthSection";

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

describe("summarizeBranchHealth", () => {
  it("reports a clean current branch as healthy", () => {
    expect(
      summarizeBranchHealth({
        isLoading: false,
        previews: { issues: [], providers: [] },
        pullRequest: { outcome: "absent" },
        status: availableStatus(),
      }),
    ).toEqual({ label: "Healthy", tier: "success" });
  });

  it("reports local changes and an outdated branch as in progress", () => {
    expect(
      summarizeBranchHealth({
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
      summarizeBranchHealth({
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
});
