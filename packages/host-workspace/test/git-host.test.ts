import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPullRequestForBranch,
  getPullRequestForCurrentBranch,
  parseGitHostPullRequest,
  rerunPullRequestChecksForCurrentBranch,
  runPullRequestActionForCurrentBranch,
  type GitHostPullRequestAction,
} from "../src/git-host.js";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  const { promisify } = await import("node:util");
  // Real execFile carries a promisify custom that resolves { stdout, stderr };
  // mirror it so `promisify(execFile)` behaves the same over the mock.
  Object.defineProperty(execFileMock, promisify.custom, {
    value: (file: string, args: readonly string[], options: object) =>
      new Promise((resolve, reject) => {
        execFileMock(
          file,
          args,
          options,
          (error: Error | null, stdout = "", stderr = "") => {
            if (error) reject(error);
            else resolve({ stdout, stderr });
          },
        );
      }),
  });
  return {
    ...actual,
    execFile: execFileMock,
  };
});

beforeEach(() => {
  execFileMock.mockReset();
});

function ghJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    number: 42,
    title: "Add pull request section",
    state: "OPEN",
    url: "https://github.com/acme/bb/pull/42",
    isDraft: false,
    baseRefName: "main",
    headRefName: "bb/add-pr-section",
    updatedAt: "2026-06-16T12:30:00Z",
    statusCheckRollup: [],
    reviewDecision: null,
    reviewRequests: [],
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    ...overrides,
  });
}

describe("parseGitHostPullRequest", () => {
  it("parses a well-formed open PR", () => {
    expect(parseGitHostPullRequest(ghJson())).toEqual({
      number: 42,
      title: "Add pull request section",
      state: "OPEN",
      url: "https://github.com/acme/bb/pull/42",
      isDraft: false,
      baseRefName: "main",
      headRefName: "bb/add-pr-section",
      updatedAt: "2026-06-16T12:30:00Z",
      checks: [],
      reviewDecision: null,
      reviewRequestCount: 0,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
    });
  });

  it("preserves the draft flag and merged/closed states", () => {
    expect(parseGitHostPullRequest(ghJson({ isDraft: true }))?.isDraft).toBe(
      true,
    );
    expect(parseGitHostPullRequest(ghJson({ state: "MERGED" }))?.state).toBe(
      "MERGED",
    );
    expect(parseGitHostPullRequest(ghJson({ state: "CLOSED" }))?.state).toBe(
      "CLOSED",
    );
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseGitHostPullRequest(`\n  ${ghJson()}\n`)?.number).toBe(42);
  });

  it("normalizes checks, review requests, and mergeability", () => {
    expect(
      parseGitHostPullRequest(
        ghJson({
          statusCheckRollup: [
            {
              __typename: "CheckRun",
              name: "typecheck",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              detailsUrl: "https://github.com/acme/bb/actions/runs/1",
              startedAt: "2026-06-16T12:20:00Z",
            },
            {
              __typename: "StatusContext",
              context: "ci/build",
              state: "FAILURE",
              targetUrl: "https://ci.example.test/build/42",
              createdAt: "2026-06-16T12:21:00Z",
            },
            {
              __typename: "CheckRun",
              workflowName: "lint",
              status: "IN_PROGRESS",
              conclusion: null,
              startedAt: "2026-06-16T12:22:00Z",
            },
          ],
          reviewDecision: "REVIEW_REQUIRED",
          reviewRequests: [
            { requestedReviewer: { login: "octocat" } },
            { requestedReviewer: { login: "hubot" } },
          ],
          mergeStateStatus: "DIRTY",
          mergeable: "CONFLICTING",
        }),
      ),
    ).toMatchObject({
      checks: [
        {
          name: "typecheck",
          status: "completed",
          conclusion: "success",
          url: "https://github.com/acme/bb/actions/runs/1",
          startedAt: "2026-06-16T12:20:00Z",
        },
        {
          name: "ci/build",
          status: "completed",
          conclusion: "failure",
          url: "https://ci.example.test/build/42",
          startedAt: "2026-06-16T12:21:00Z",
        },
        {
          name: "lint",
          status: "in_progress",
          conclusion: null,
          url: null,
          startedAt: "2026-06-16T12:22:00Z",
        },
      ],
      reviewDecision: "REVIEW_REQUIRED",
      reviewRequestCount: 2,
      mergeStateStatus: "DIRTY",
      mergeable: "CONFLICTING",
    });
  });

  it.each([
    ["empty output", ""],
    ["whitespace only", "   \n"],
    ["non-JSON", "no pull requests found for branch"],
    ["a JSON array", "[]"],
  ])("returns null for %s", (_label, stdout) => {
    expect(parseGitHostPullRequest(stdout)).toBeNull();
  });

  it.each([
    ["an unknown state", ghJson({ state: "QUEUED" })],
    [
      "a missing field",
      JSON.stringify({ number: 1, title: "x", state: "OPEN" }),
    ],
    ["a non-positive number", ghJson({ number: 0 })],
    ["an invalid updatedAt", ghJson({ updatedAt: "yesterday" })],
    ["a non-url", ghJson({ url: "not-a-url" })],
  ])("returns null for %s", (_label, stdout) => {
    expect(parseGitHostPullRequest(stdout)).toBeNull();
  });
});

describe("runPullRequestActionForCurrentBranch", () => {
  const actionArgs = {
    cwd: "/tmp/workspace",
    localBranch: "bb/pr-action",
  };

  function mockGhSuccess(): void {
    execFileMock.mockImplementation(
      (
        file: string,
        _args: readonly string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (file === "git") {
          callback(null, "", "");
          return;
        }
        callback(null, "", "");
      },
    );
  }

  it.each([
    ["ready", { operation: "ready" }, ["pr", "ready"]],
    ["draft", { operation: "draft" }, ["pr", "ready", "--undo"]],
    [
      "merge",
      { operation: "merge", method: "merge" },
      ["pr", "merge", "--merge"],
    ],
    [
      "squash",
      { operation: "merge", method: "squash" },
      ["pr", "merge", "--squash"],
    ],
    [
      "rebase",
      { operation: "merge", method: "rebase" },
      ["pr", "merge", "--rebase"],
    ],
  ] satisfies readonly [
    string,
    Exclude<GitHostPullRequestAction, { operation: "create" }>,
    readonly string[],
  ][])(
    "runs gh pr %s without a target so gh can honor a fork upstream",
    async (_label, action, expectedArgs) => {
      mockGhSuccess();

      await runPullRequestActionForCurrentBranch({
        ...actionArgs,
        action,
      });

      expect(execFileMock).toHaveBeenCalledWith(
        "gh",
        expectedArgs,
        expect.objectContaining({
          cwd: "/tmp/workspace",
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
          timeout: 60_000,
        }),
        expect.any(Function),
      );
    },
  );

  it("maps a missing gh executable to a workspace error", async () => {
    const error = Object.assign(new Error("spawn gh ENOENT"), {
      code: "ENOENT",
    });
    execFileMock.mockImplementation(
      (
        file: string,
        _args: readonly string[],
        _options: object,
        callback: (
          error: Error | null,
          stdout?: string,
          stderr?: string,
        ) => void,
      ) => {
        if (file === "git") {
          callback(null, "", "");
          return;
        }
        callback(error);
      },
    );

    await expect(
      runPullRequestActionForCurrentBranch({
        ...actionArgs,
        action: { operation: "ready" },
      }),
    ).rejects.toMatchObject({
      code: "git_host_cli_unavailable",
      name: "WorkspaceError",
    });
  });

  it("uses the selected account environment for PR mutations", async () => {
    mockGhSuccess();

    await runPullRequestActionForCurrentBranch({
      cwd: "/tmp/workspace",
      localBranch: "feature",
      action: { operation: "ready" },
      env: { GH_HOST: "github.com", GH_TOKEN: "personal-token" },
    });

    expect(execFileMock).toHaveBeenCalledWith(
      "gh",
      ["pr", "ready"],
      expect.objectContaining({
        env: expect.objectContaining({
          GH_HOST: "github.com",
          GH_TOKEN: "personal-token",
        }),
      }),
      expect.any(Function),
    );
  });
});

describe("rerunPullRequestChecksForCurrentBranch", () => {
  it("resolves a failed check to its job database ID", async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        commandArgs: readonly string[],
        _options: object,
        callback: (error: Error | null, stdout?: string) => void,
      ) => {
        if (commandArgs[0] === "pr") {
          callback(
            null,
            ghJson({
              statusCheckRollup: [
                {
                  name: "typecheck",
                  status: "COMPLETED",
                  conclusion: "FAILURE",
                  detailsUrl:
                    "https://github.com/acme/bb/actions/runs/123/job/456",
                },
              ],
            }),
          );
          return;
        }
        if (commandArgs[1] === "view") {
          callback(
            null,
            JSON.stringify({
              jobs: [
                {
                  databaseId: 789,
                  name: "typecheck",
                  url: "https://github.com/acme/bb/actions/runs/123/job/456",
                },
              ],
            }),
          );
          return;
        }
        callback(null, "");
      },
    );

    await expect(
      rerunPullRequestChecksForCurrentBranch({
        cwd: "/tmp/workspace",
        localBranch: "feature",
        target: { scope: "check", checkName: "typecheck" },
      }),
    ).resolves.toEqual({ rerunCount: 1 });
    expect(execFileMock).toHaveBeenCalledWith(
      "gh",
      ["run", "rerun", "123", "--job", "789"],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("re-runs failed jobs once per workflow run", async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        commandArgs: readonly string[],
        _options: object,
        callback: (error: Error | null, stdout?: string) => void,
      ) => {
        callback(
          null,
          commandArgs[0] === "pr"
            ? ghJson({
                statusCheckRollup: [
                  {
                    name: "typecheck",
                    status: "COMPLETED",
                    conclusion: "FAILURE",
                    detailsUrl:
                      "https://github.com/acme/bb/actions/runs/123/job/456",
                  },
                  {
                    name: "test",
                    status: "COMPLETED",
                    conclusion: "TIMED_OUT",
                    detailsUrl:
                      "https://github.com/acme/bb/actions/runs/123/job/457",
                  },
                ],
              })
            : "",
        );
      },
    );

    await expect(
      rerunPullRequestChecksForCurrentBranch({
        cwd: "/tmp/workspace",
        localBranch: "feature",
        target: { scope: "failed" },
      }),
    ).resolves.toEqual({ rerunCount: 1 });
    expect(execFileMock).toHaveBeenCalledWith(
      "gh",
      ["run", "rerun", "123", "--failed"],
      expect.any(Object),
      expect.any(Function),
    );
  });
});

describe("createPullRequestForBranch", () => {
  it("pushes the branch and creates a non-interactive draft PR", async () => {
    execFileMock.mockImplementation(
      (
        file: string,
        args: readonly string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const isView = file === "gh" && args[1] === "view";
        callback(null, isView ? ghJson({ isDraft: true }) : "", "");
      },
    );

    await expect(
      createPullRequestForBranch({
        cwd: "/tmp/workspace",
        branch: "bb/pr-create",
        baseBranch: "main",
        body: "Ships the new workflow",
        draft: true,
        title: "Add pull request workflow",
      }),
    ).resolves.toMatchObject({ number: 42, isDraft: true });

    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      "git",
      ["push", "--set-upstream", "origin", "HEAD"],
      expect.objectContaining({ cwd: "/tmp/workspace", timeout: 120_000 }),
      expect.any(Function),
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "gh",
      [
        "pr",
        "create",
        "--title",
        "Add pull request workflow",
        "--body",
        "Ships the new workflow",
        "--base",
        "main",
        "--head",
        "bb/pr-create",
        "--draft",
      ],
      expect.objectContaining({ cwd: "/tmp/workspace", timeout: 60_000 }),
      expect.any(Function),
    );
  });

  it("uses the selected account for both push and PR creation", async () => {
    execFileMock.mockImplementation(
      (
        file: string,
        args: readonly string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const isView = file === "gh" && args[1] === "view";
        callback(null, isView ? ghJson() : "", "");
      },
    );

    await createPullRequestForBranch({
      cwd: "/tmp/workspace",
      branch: "bb/pr-create",
      baseBranch: "main",
      body: "Ships the new workflow",
      draft: false,
      title: "Add pull request workflow",
      env: { GH_HOST: "github.com", GH_TOKEN: "work-token" },
    });

    for (const call of execFileMock.mock.calls) {
      expect(call[2]).toEqual(
        expect.objectContaining({
          env: expect.objectContaining({
            GH_HOST: "github.com",
            GH_TOKEN: "work-token",
          }),
        }),
      );
    }
  });
});

describe("getPullRequestForCurrentBranch", () => {
  const lookupArgs = {
    cwd: "/tmp/workspace",
    localBranch: "bb/pr-lookup",
  };

  function mockGhStdout(stdout: string): void {
    execFileMock.mockImplementation(
      (
        file: string,
        _args: readonly string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (file === "git") {
          callback(null, "", "");
          return;
        }
        callback(null, stdout, "");
      },
    );
  }

  function mockGhFailure(error: Error): void {
    execFileMock.mockImplementation(
      (
        file: string,
        _args: readonly string[],
        _options: object,
        callback: (
          error: Error | null,
          stdout?: string,
          stderr?: string,
        ) => void,
      ) => {
        if (file === "git") {
          callback(null, "", "");
          return;
        }
        callback(error);
      },
    );
  }

  it("uses bare gh lookup when the branch has no differently named upstream", async () => {
    mockGhStdout(ghJson());
    await expect(
      getPullRequestForCurrentBranch(lookupArgs),
    ).resolves.toMatchObject({
      outcome: "found",
      pullRequest: { number: 42, state: "OPEN" },
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "gh",
      ["pr", "view", "--json", expect.any(String)],
      expect.objectContaining({ cwd: "/tmp/workspace" }),
      expect.any(Function),
    );
  });

  it("returns none when gh reports the branch has no PR", async () => {
    mockGhFailure(
      Object.assign(new Error("gh exited 1"), {
        code: 1,
        stderr: 'no pull requests found for branch "bb/pr-lookup"',
      }),
    );
    await expect(getPullRequestForCurrentBranch(lookupArgs)).resolves.toEqual({
      outcome: "none",
    });
  });

  it("returns unavailable when gh is not installed", async () => {
    mockGhFailure(
      Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }),
    );
    await expect(getPullRequestForCurrentBranch(lookupArgs)).resolves.toEqual({
      outcome: "unavailable",
      message: "GitHub CLI is not available",
    });
  });

  it("returns unavailable with the stderr detail for an auth failure", async () => {
    mockGhFailure(
      Object.assign(new Error("gh exited 4"), {
        code: 4,
        stderr: "gh: To get started with GitHub CLI, please run: gh auth login",
      }),
    );
    const result = await getPullRequestForCurrentBranch(lookupArgs);
    expect(result.outcome).toBe("unavailable");
    expect(result).toMatchObject({
      message: expect.stringContaining("gh auth login"),
    });
  });

  it("returns unavailable when gh times out", async () => {
    mockGhFailure(
      Object.assign(new Error("timed out"), { killed: true, code: null }),
    );
    await expect(
      getPullRequestForCurrentBranch(lookupArgs),
    ).resolves.toMatchObject({
      outcome: "unavailable",
      message: expect.stringContaining("timed out"),
    });
  });

  it("returns unavailable for unparseable gh output", async () => {
    mockGhStdout("not json at all");
    await expect(getPullRequestForCurrentBranch(lookupArgs)).resolves.toEqual({
      outcome: "unavailable",
      message: "gh pr view returned unparseable output",
    });
  });
});
