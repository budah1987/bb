import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import type { PluginRpcClient, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  default as githubPlugin,
  fetchRepoItems,
  githubReposFromProjects,
  githubRpcContract,
  parsePaginatedGhApi,
  shouldRefreshGithubCache,
  validateGithubCliArgs,
} from "./server";

type GithubRpcHandlers = PluginRpcHandlers<typeof githubRpcContract>;

function assertGithubFrontendInference(
  client: PluginRpcClient<typeof githubRpcContract>,
) {
  expectTypeOf(
    client.call("getPull", { repo: "get-bb/bb", number: 694 }),
  ).toEqualTypeOf<
    Promise<{
      pull: {
        repo: string;
        number: number;
        title: string;
        state: string;
        author: string;
        body: string;
        url: string;
        createdAt: string;
        updatedAt: string;
        baseRefName: string;
        headRefName: string;
        additions: number;
        deletions: number;
        changedFiles: number;
        labels: string[];
        assignees: string[];
        reviewDecision: string;
        mergeStateStatus: string;
        reviewRequests: string[];
        checks: Array<{
          name: string;
          status: "success" | "failure" | "pending" | "neutral";
          url: string;
        }>;
      };
    }>
  >();

  expectTypeOf(
    client.call("getPullFiles", { repo: "get-bb/bb", number: 694 }),
  ).toEqualTypeOf<
    Promise<{
      files: Array<{
        path: string;
        status: string;
        additions: number;
        deletions: number;
        patch: string | null;
      }>;
    }>
  >();

  expectTypeOf(
    client.call("getPullActivity", { repo: "get-bb/bb", number: 694 }),
  ).toEqualTypeOf<
    Promise<{
      activity: {
        comments: Array<{ author: string; body: string; createdAt: string }>;
        reviews: Array<{
          author: string;
          state: string;
          body: string;
          createdAt: string;
        }>;
        reviewThreads: Array<{
          path: string;
          line: number | null;
          diffHunk: string;
          comments: Array<{ author: string; body: string; createdAt: string }>;
        }>;
      };
    }>
  >();

  expectTypeOf(
    client.call("startReview", { repo: "get-bb/bb", number: 694 }),
  ).toEqualTypeOf<Promise<{ threadId: string; created: boolean }>>();

  // @ts-expect-error issue numbers must be numeric.
  void client.call("getIssue", { repo: "get-bb/bb", number: "694" });
  // @ts-expect-error unknown filter values are rejected by the contract.
  void client.call("listItems", { kind: "discussion" });
}

describe("GitHub RPC contract", () => {
  it("keeps cached items and sync cursors partitioned by viewer login", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "bb-github-cache-account-"));
    const ghPath = join(fixtureDir, "gh");
    const callsPath = join(fixtureDir, "calls.log");
    writeFileSync(callsPath, "");
    writeFileSync(
      ghPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.BB_GITHUB_TEST_CALLS, args.join(" ") + "\\n");
const login = process.env.BB_GITHUB_TEST_LOGIN;
if (args[0] === "--version" || (args[0] === "auth" && args[1] === "status")) process.exit(0);
if (args[0] === "api" && args[1] === "user") {
  process.stdout.write(JSON.stringify({ login }));
  process.exit(0);
}
if (args[0] === "issue" && args[1] === "list") {
  if (args.includes("closed")) {
    process.stdout.write("[]");
    process.exit(0);
  }
  const number = login === "alice" ? 1 : 2;
  process.stdout.write(JSON.stringify([{
    number,
    title: login + " item",
    state: "OPEN",
    author: { login },
    labels: [],
    assignees: [{ login }],
    url: "https://github.com/acme/widgets/issues/" + number,
    body: "",
    updatedAt: login === "alice" ? "2026-08-13T00:00:00Z" : "2026-08-14T00:00:00Z"
  }]));
  process.exit(0);
}
if (args[0] === "issue" && args[1] === "close") process.exit(0);
if (args[0] === "pr" && args[1] === "list") {
  process.stdout.write("[]");
  process.exit(0);
}
process.stderr.write("unexpected gh call: " + args.join(" "));
process.exit(1);
`,
    );
    chmodSync(ghPath, 0o755);

    const previousPath = process.env.PATH;
    const previousLogin = process.env.BB_GITHUB_TEST_LOGIN;
    const previousCalls = process.env.BB_GITHUB_TEST_CALLS;
    process.env.PATH = `${fixtureDir}:${previousPath ?? ""}`;
    process.env.BB_GITHUB_TEST_LOGIN = "alice";
    process.env.BB_GITHUB_TEST_CALLS = callsPath;

    let current = createFakePluginHost({
      pluginId: "github-account-partition",
      sdk: {
        projects: {
          list: async () => [
            {
              id: "project-widgets",
              gitRemoteUrl: "https://github.com/acme/widgets.git",
              githubAccountLogin: null,
              sources: [
                { hostId: "host-1", isDefault: true, path: "/repos/widgets" },
              ],
            },
          ],
        },
      },
    });
    try {
      const legacyDb = current.bb.storage.database();
      current.bb.storage.migrate(legacyDb, [
        `CREATE TABLE items (
           repo TEXT NOT NULL,
           number INTEGER NOT NULL,
           kind TEXT NOT NULL,
           title TEXT NOT NULL,
           state TEXT NOT NULL,
           author TEXT NOT NULL,
           labels TEXT NOT NULL,
           url TEXT NOT NULL,
           body TEXT NOT NULL,
           updated_at TEXT NOT NULL,
           PRIMARY KEY (repo, kind, number)
         )`,
        `ALTER TABLE items ADD COLUMN assignees TEXT NOT NULL DEFAULT '[]'`,
      ]);
      legacyDb
        .prepare(
          `INSERT INTO items (
           repo, number, kind, title, state, author, labels, assignees,
           url, body, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "acme/widgets",
          99,
          "issue",
          "legacy alice item",
          "OPEN",
          "alice",
          "[]",
          "[]",
          "https://github.com/acme/widgets/issues/99",
          "",
          "2026-08-12T00:00:00Z",
        );
      await current.bb.storage.kv.set("cache-account-login", "Alice");
      await current.bb.storage.kv.set("sync-cursor", {
        lastSyncedAt: "2026-08-12T00:00:00Z",
        repos: 1,
        items: 1,
      });

      await githubPlugin(current.bb);
      expect(readFileSync(callsPath, "utf8")).toBe("");
      expect(await current.harness.callRpc("listItems", {})).toEqual({
        items: [
          expect.objectContaining({ number: 99, title: "legacy alice item" }),
        ],
      });
      expect(
        await current.bb.storage.kv.get("sync-cursor:alice"),
      ).toMatchObject({ lastSyncedAt: "2026-08-12T00:00:00Z" });

      await current.harness.callRpc("refresh", null);
      expect(await current.harness.callRpc("listItems", {})).toEqual({
        items: [expect.objectContaining({ number: 1, title: "alice item" })],
      });

      process.env.BB_GITHUB_TEST_LOGIN = "bob";
      await current.harness.callRpc("refresh", null);
      expect(await current.harness.callRpc("listItems", {})).toEqual({
        items: [expect.objectContaining({ number: 2, title: "bob item" })],
      });

      process.env.BB_GITHUB_TEST_LOGIN = "alice";
      await current.harness.callRpc("setIssueState", {
        repo: "acme/widgets",
        number: 1,
        state: "closed",
      });
      expect(await current.harness.callRpc("listItems", {})).toEqual({
        items: [
          expect.objectContaining({
            number: 1,
            title: "alice item",
            state: "CLOSED",
          }),
        ],
      });

      const db = current.bb.storage.database();
      expect(
        db
          .prepare(
            "SELECT account_login, number, state FROM items ORDER BY account_login",
          )
          .all(),
      ).toEqual([
        { account_login: "alice", number: 1, state: "CLOSED" },
        { account_login: "bob", number: 2, state: "OPEN" },
      ]);
      expect(
        await current.bb.storage.kv.get("sync-cursor:alice"),
      ).toMatchObject({ items: 1 });
      expect(await current.bb.storage.kv.get("sync-cursor:bob")).toMatchObject({
        items: 1,
      });
    } finally {
      await current.harness.dispose();
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousLogin === undefined) delete process.env.BB_GITHUB_TEST_LOGIN;
      else process.env.BB_GITHUB_TEST_LOGIN = previousLogin;
      if (previousCalls === undefined) delete process.env.BB_GITHUB_TEST_CALLS;
      else process.env.BB_GITHUB_TEST_CALLS = previousCalls;
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("keeps pull requests when a repository has GitHub Issues disabled", async () => {
    const calls: string[][] = [];
    const openPulls = JSON.stringify([
      {
        number: 17,
        title: "Keep syncing pull requests",
        state: "OPEN",
        author: { login: "octocat" },
        labels: [{ name: "bug" }],
        assignees: [],
        url: "https://github.com/acme/widgets/pull/17",
        body: "",
        updatedAt: "2026-08-10T00:00:00Z",
      },
    ]);

    const items = await fetchRepoItems(async (args) => {
      calls.push(args);
      if (args[0] === "issue") {
        throw new Error(
          "gh issue list failed: the 'acme/widgets' repository has disabled Issues",
        );
      }
      return args.includes("open") ? openPulls : "[]";
    }, "acme/widgets");

    expect(calls).toHaveLength(4);
    expect(calls.filter(([kind]) => kind === "pr")).toHaveLength(2);
    expect(items).toEqual([
      expect.objectContaining({
        repo: "acme/widgets",
        number: 17,
        kind: "pr",
        title: "Keep syncing pull requests",
      }),
    ]);
  });

  it("flattens every paginated GitHub API page", () => {
    expect(
      parsePaginatedGhApi(
        JSON.stringify([[{ id: 1 }, { id: 2 }], [{ id: 3 }]]),
      ),
    ).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);

    expect(() => parsePaginatedGhApi(JSON.stringify([{ id: 1 }]))).toThrow(
      "malformed page",
    );
  });

  it("rejects CLI arguments that would otherwise broaden a repository query", () => {
    expect(validateGithubCliArgs(["issues", "get-bb/bb"])).toBeNull();
    expect(validateGithubCliArgs(["issues", "bad/repo/shape"])).toContain(
      "expected owner/repo",
    );
    expect(validateGithubCliArgs(["prs", "get-bb/bb", "extra"])).toContain(
      "Unexpected argument",
    );
    expect(validateGithubCliArgs(["repos", "--json"])).toContain(
      "does not accept arguments",
    );
  });

  it("uses stored project remotes without scanning local checkouts", () => {
    expect(
      githubReposFromProjects([
        {
          id: "project-1",
          gitRemoteUrl: "git@github.com:acme/widgets.git",
          githubAccountLogin: "Alice",
          sources: [
            { hostId: "host-1", isDefault: true },
            { hostId: "host-2", isDefault: false },
          ],
        },
        {
          id: "project-2",
          gitRemoteUrl: "https://github.com/acme/widgets.git",
        },
        {
          id: "project-0",
          gitRemoteUrl: "https://github.com/acme/widgets.git",
          githubAccountLogin: "alice",
          sources: [{ hostId: "host-0", isDefault: true }],
        },
        { id: "project-3", gitRemoteUrl: null },
      ]),
    ).toEqual([
      {
        repo: "acme/widgets",
        projectId: "project-0",
        githubAccountLogin: "alice",
        defaultSourceHostId: "host-0",
      },
      {
        repo: "acme/widgets",
        projectId: "project-2",
        githubAccountLogin: null,
        defaultSourceHostId: null,
      },
    ]);
  });

  it("refreshes GitHub data only when the persisted cache is stale", () => {
    const now = Date.parse("2026-08-12T20:00:00.000Z");
    expect(shouldRefreshGithubCache(null, now)).toBe(true);
    expect(shouldRefreshGithubCache("invalid", now)).toBe(true);
    expect(shouldRefreshGithubCache("2026-08-12T19:56:00.000Z", now)).toBe(
      false,
    );
    expect(shouldRefreshGithubCache("2026-08-12T19:55:00.000Z", now)).toBe(
      true,
    );
  });

  it("opens existing conversations and provisions new work in the exact BB project source", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "bb-github-conversation-"));
    const ghPath = join(fixtureDir, "gh");
    const callsPath = join(fixtureDir, "calls.log");
    writeFileSync(callsPath, "");
    writeFileSync(
      ghPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.BB_GITHUB_TEST_CALLS, args.join(" ") + "\\n");
if (args[0] === "--version" || (args[0] === "auth" && args[1] === "status")) process.exit(0);
if (args[0] === "api" && args[1] === "user") {
  if (process.env.BB_GITHUB_TEST_FAIL_VIEWER === "1") process.exit(1);
  process.stdout.write(JSON.stringify({ login: "alice" }));
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "view" && args[2] === "42") {
  process.stdout.write(JSON.stringify({ number: 42, title: "Ship the rail", baseRefName: "main", headRefName: "feature/right-rail" }));
  process.exit(0);
}
process.stderr.write("unexpected gh call: " + args.join(" "));
process.exit(1);
`,
    );
    chmodSync(ghPath, 0o755);

    const previousPath = process.env.PATH;
    const previousCalls = process.env.BB_GITHUB_TEST_CALLS;
    const previousFailViewer = process.env.BB_GITHUB_TEST_FAIL_VIEWER;
    process.env.PATH = `${fixtureDir}:${previousPath ?? ""}`;
    process.env.BB_GITHUB_TEST_CALLS = callsPath;
    let spawned = 0;
    let exposeExistingWorkspace = false;
    const current = createFakePluginHost({
      pluginId: "github-conversations",
      sdk: {
        projects: {
          list: async () => [
            {
              id: "project-widgets",
              gitRemoteUrl: "https://github.com/acme/widgets.git",
              githubAccountLogin: "alice",
              sources: [
                {
                  hostId: "host-secondary",
                  isDefault: false,
                  path: "/secondary",
                },
                { hostId: "host-default", isDefault: true, path: "/default" },
              ],
            },
            {
              id: "project-private",
              gitRemoteUrl: "https://github.com/acme/private.git",
              githubAccountLogin: "bob",
              sources: [
                { hostId: "host-bob", isDefault: true, path: "/private" },
              ],
            },
          ],
        },
        threads: {
          spawn: async () => ({ id: `thread-${++spawned}` }),
          list: async () =>
            exposeExistingWorkspace
              ? [
                  {
                    id: "thread-existing-workspace",
                    environmentId: "environment-existing-workspace",
                    environmentBranchName: "feature/right-rail",
                    updatedAt: 200,
                  },
                  {
                    id: "thread-wrong-branch",
                    environmentId: "environment-wrong-branch",
                    environmentBranchName: "feature/other",
                    updatedAt: 300,
                  },
                ]
              : [],
          get: async ({ threadId }) => ({
            id: threadId,
            projectId:
              threadId === "thread-private-existing"
                ? "project-private"
                : "project-widgets",
          }),
        },
        environments: {
          pullRequest: async ({ environmentId }) => ({
            outcome: "available",
            pullRequest: {
              number:
                environmentId === "environment-existing-workspace" ? 42 : 99,
              url:
                environmentId === "environment-existing-workspace"
                  ? "https://github.com/acme/widgets/pull/42"
                  : "https://github.com/acme/widgets/pull/99",
            },
          }),
        },
      },
    });
    try {
      await githubPlugin(current.bb);

      await expect(
        current.harness.callRpc("startReview", {
          repo: "acme/widgets",
          number: 42,
        }),
      ).resolves.toEqual({ threadId: "thread-1", created: true });
      expect(
        current.harness.sdk.callsTo("threads.spawn")[0]?.[0],
      ).toMatchObject({
        projectId: "project-widgets",
        environment: {
          type: "host",
          hostId: "host-default",
          workspace: {
            type: "managed-worktree",
            baseBranch: { kind: "named", name: "main" },
            pullRequestNumber: 42,
          },
        },
      });

      await expect(
        current.harness.callRpc("startReview", {
          repo: "acme/widgets",
          number: 42,
        }),
      ).resolves.toEqual({ threadId: "thread-1", created: false });
      expect(current.harness.sdk.callsTo("threads.spawn")).toHaveLength(1);

      await current.bb.storage.kv.delete("link:pr:acme/widgets#42");
      exposeExistingWorkspace = true;
      await expect(
        current.harness.callRpc("startReview", {
          repo: "acme/widgets",
          number: 42,
        }),
      ).resolves.toEqual({
        threadId: "thread-existing-workspace",
        created: false,
      });
      expect(current.harness.sdk.callsTo("threads.spawn")).toHaveLength(1);
      expect(current.harness.sdk.callsTo("environments.pullRequest")).toEqual([
        [{ environmentId: "environment-existing-workspace" }],
      ]);
      await expect(current.harness.callRpc("listLinks", null)).resolves.toEqual(
        {
          links: {
            "pr:acme/widgets#42": [
              expect.objectContaining({
                threadId: "thread-existing-workspace",
              }),
            ],
          },
        },
      );

      await expect(
        current.harness.callRpc("startWork", {
          repo: "acme/widgets",
          number: 7,
        }),
      ).resolves.toEqual({ threadId: "thread-2", created: true });
      expect(
        current.harness.sdk.callsTo("threads.spawn")[1]?.[0],
      ).toMatchObject({
        projectId: "project-widgets",
        environment: {
          type: "host",
          hostId: "host-default",
          workspace: {
            type: "managed-worktree",
            baseBranch: { kind: "default" },
          },
        },
      });

      await current.bb.storage.kv.set("link:issue:acme/private#9", [
        {
          kind: "issue",
          repo: "acme/private",
          number: 9,
          threadId: "thread-private-existing",
          createdAt: "2026-08-14T00:00:00.000Z",
        },
      ]);
      await expect(
        current.harness.callRpc("startWork", {
          repo: "acme/private",
          number: 9,
        }),
      ).resolves.toEqual({
        threadId: "thread-private-existing",
        created: false,
      });
      await current.bb.storage.kv.delete("link:issue:acme/private#9");
      await expect(
        current.harness.callRpc("startWork", {
          repo: "acme/private",
          number: 9,
        }),
      ).rejects.toThrow(
        /attached to GitHub account bob.*authenticated as alice/,
      );

      await current.bb.storage.kv.set("link:issue:acme/widgets#8", [
        {
          kind: "issue",
          repo: "acme/widgets",
          number: 8,
          threadId: "thread-offline-existing",
          createdAt: "2026-08-14T00:00:00.000Z",
        },
      ]);
      process.env.BB_GITHUB_TEST_FAIL_VIEWER = "1";
      await expect(
        current.harness.callRpc("startWork", {
          repo: "acme/widgets",
          number: 8,
        }),
      ).resolves.toEqual({
        threadId: "thread-offline-existing",
        created: false,
      });
      delete process.env.BB_GITHUB_TEST_FAIL_VIEWER;

      await expect(
        current.harness.callRpc("getIssue", {
          repo: "outside/not-attached",
          number: 1,
        }),
      ).rejects.toThrow(/No BB project is attached/);
      await expect(
        current.harness.callRpc("commentIssue", {
          repo: "acme/private",
          number: 9,
          body: "must not post",
        }),
      ).rejects.toThrow(
        /attached to GitHub account bob.*authenticated as alice/,
      );
      expect(current.harness.sdk.callsTo("threads.spawn")).toHaveLength(2);
      const calls = readFileSync(callsPath, "utf8").split("\n");
      expect(
        calls.filter((line) => line.startsWith("pr view 42")),
      ).toHaveLength(2);
      expect(calls.some((line) => line.startsWith("issue comment"))).toBe(
        false,
      );
      expect(calls.some((line) => line.startsWith("issue view"))).toBe(false);
    } finally {
      await current.harness.dispose();
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousCalls === undefined) delete process.env.BB_GITHUB_TEST_CALLS;
      else process.env.BB_GITHUB_TEST_CALLS = previousCalls;
      if (previousFailViewer === undefined)
        delete process.env.BB_GITHUB_TEST_FAIL_VIEWER;
      else process.env.BB_GITHUB_TEST_FAIL_VIEWER = previousFailViewer;
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("infers parsed handler inputs and frontend results", () => {
    expectTypeOf<
      Parameters<GithubRpcHandlers["createIssue"]>[0]
    >().toEqualTypeOf<{
      repo: string;
      title: string;
      body?: string;
    }>();
    expectTypeOf(assertGithubFrontendInference).toBeFunction();
  });

  it("rejects invalid method inputs and outputs at runtime", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "github-contract",
    });
    const contract = defineRpcContract({
      startWork: githubRpcContract.startWork,
    });
    bb.rpc.register(contract, {
      startWork() {
        return { threadId: "", created: true };
      },
    });

    await expect(
      harness.callRpc("startWork", {
        repo: "not-a-repository",
        number: 0,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      harness.callRpc("startWork", { repo: "get-bb/bb", number: 694 }),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });
});
