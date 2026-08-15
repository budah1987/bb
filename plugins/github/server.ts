// bb-plugin-github — GitHub issues & pull requests inside BB.
//
// Auth rides on the GitHub CLI: if `gh auth status` passes, the plugin
// works. Repos are discovered from BB projects whose stored remote points at
// GitHub. A background service
// syncs open + recently-closed issues/PRs into the plugin's SQLite cache;
// the frontend panel and mention providers read that cache, while
// mutations (comment, create, close/reopen, assign, label) and detail views go
// straight through `gh`.
import { execFile } from "node:child_process";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const DEMAND_SYNC_STALE_MS = 5 * 60_000;
const VIEWER_CACHE_TTL_MS = 60_000;
const ISSUE_PAGE = 100;
const CLOSED_ISSUE_PAGE = 50;
const PR_PAGE = 50;
const CLOSED_PR_PAGE = 30;

const GH_HINT =
  "Install the GitHub CLI (https://cli.github.com) and run `gh auth login`, " +
  "then `bb plugin reload github`.";

const repoNameSchema = z.string().regex(/^[\w.-]+\/[\w.-]+$/);
const itemNumberSchema = z.number().int().positive();
const itemInputSchema = z
  .object({ repo: repoNameSchema, number: itemNumberSchema })
  .strict();
const nonBlankStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "must not be blank");
const repoInfoSchema = z
  .object({
    repo: repoNameSchema,
    projectId: z.string().min(1),
    githubAccountLogin: z.string().min(1).nullable(),
    available: z.boolean(),
    unavailableReason: z.string().nullable(),
  })
  .strict();
const itemSchema = z
  .object({
    repo: repoNameSchema,
    number: itemNumberSchema,
    kind: z.enum(["issue", "pr"]),
    title: z.string(),
    state: z.string(),
    author: z.string(),
    labels: z.array(z.string()),
    assignees: z.array(z.string()),
    url: z.string(),
    body: z.string(),
    updatedAt: z.string(),
  })
  .strict();
const syncResultSchema = z
  .object({
    repos: z.number().int().nonnegative(),
    items: z.number().int().nonnegative(),
  })
  .strict();
const okResultSchema = z.object({ ok: z.literal(true) }).strict();
const commentSchema = z
  .object({ author: z.string(), body: z.string(), createdAt: z.string() })
  .strict();
const threadLinkSchema = z
  .object({
    kind: z.enum(["issue", "pr"]),
    repo: repoNameSchema,
    number: itemNumberSchema,
    threadId: z.string().min(1),
    createdAt: z.string(),
  })
  .strict();
const pullSummarySchema = z
  .object({
    repo: repoNameSchema,
    number: itemNumberSchema,
    title: z.string(),
    state: z.string(),
    author: z.string(),
    body: z.string(),
    url: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    baseRefName: z.string(),
    headRefName: z.string(),
    additions: z.number().nonnegative(),
    deletions: z.number().nonnegative(),
    changedFiles: z.number().int().nonnegative(),
    labels: z.array(z.string()),
    assignees: z.array(z.string()),
    reviewDecision: z.string(),
    mergeStateStatus: z.string(),
    reviewRequests: z.array(z.string()),
    checks: z.array(
      z
        .object({
          name: z.string(),
          status: z.enum(["success", "failure", "pending", "neutral"]),
          url: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
const pullActivitySchema = z
  .object({
    comments: z.array(commentSchema),
    reviews: z.array(
      z
        .object({
          author: z.string(),
          state: z.string(),
          body: z.string(),
          createdAt: z.string(),
        })
        .strict(),
    ),
    reviewThreads: z.array(
      z
        .object({
          path: z.string(),
          line: z.number().int().nonnegative().nullable(),
          diffHunk: z.string(),
          comments: z.array(commentSchema),
        })
        .strict(),
    ),
  })
  .strict();
const pullFilesSchema = z.array(
  z
    .object({
      path: z.string(),
      status: z.string(),
      additions: z.number().nonnegative(),
      deletions: z.number().nonnegative(),
      patch: z.string().nullable(),
    })
    .strict(),
);

export const githubRpcContract = defineRpcContract({
  status: {
    input: z.null(),
    output: z
      .object({
        ghOk: z.boolean(),
        ghError: z.string().nullable(),
        repos: z.array(repoInfoSchema),
        lastSyncedAt: z.string().nullable(),
      })
      .strict(),
  },
  refresh: { input: z.null(), output: syncResultSchema },
  listItems: {
    input: z
      .object({
        kind: z.enum(["issue", "pr"]).optional(),
        repo: repoNameSchema.optional(),
        query: z.string().optional(),
        state: z.enum(["open", "closed"]).optional(),
        mine: z.boolean().optional(),
      })
      .strict(),
    output: z.object({ items: z.array(itemSchema) }).strict(),
  },
  viewer: {
    input: z.null(),
    output: z.object({ login: z.string().min(1) }).strict(),
  },
  assignableUsers: {
    input: z.object({ repo: repoNameSchema }).strict(),
    output: z.object({ users: z.array(z.string().min(1)) }).strict(),
  },
  repositoryLabels: {
    input: z.object({ repo: repoNameSchema }).strict(),
    output: z.object({ labels: z.array(z.string().min(1)) }).strict(),
  },
  setIssueState: {
    input: itemInputSchema
      .extend({ state: z.enum(["open", "closed"]) })
      .strict(),
    output: okResultSchema,
  },
  setAssignees: {
    input: itemInputSchema
      .extend({ assignees: z.array(z.string().min(1)) })
      .strict(),
    output: z
      .object({ ok: z.literal(true), assignees: z.array(z.string().min(1)) })
      .strict(),
  },
  setLabels: {
    input: itemInputSchema.extend({ labels: z.array(z.string()) }).strict(),
    output: z
      .object({ ok: z.literal(true), labels: z.array(z.string().min(1)) })
      .strict(),
  },
  getIssue: {
    input: itemInputSchema,
    output: z
      .object({
        issue: z
          .object({
            repo: repoNameSchema,
            number: itemNumberSchema,
            title: z.string(),
            state: z.string(),
            author: z.string(),
            body: z.string(),
            labels: z.array(z.string()),
            assignees: z.array(z.string()),
            url: z.string(),
            updatedAt: z.string(),
            comments: z.array(commentSchema),
          })
          .strict(),
      })
      .strict(),
  },
  getPull: {
    input: itemInputSchema,
    output: z.object({ pull: pullSummarySchema }).strict(),
  },
  getPullActivity: {
    input: itemInputSchema,
    output: z.object({ activity: pullActivitySchema }).strict(),
  },
  getPullFiles: {
    input: itemInputSchema,
    output: z.object({ files: pullFilesSchema }).strict(),
  },
  commentPull: {
    input: itemInputSchema.extend({ body: nonBlankStringSchema }).strict(),
    output: okResultSchema,
  },
  pullForThread: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ pull: itemInputSchema.nullable() }).strict(),
  },
  commentIssue: {
    input: itemInputSchema.extend({ body: nonBlankStringSchema }).strict(),
    output: okResultSchema,
  },
  createIssue: {
    input: z
      .object({
        repo: repoNameSchema,
        title: nonBlankStringSchema,
        body: z.string().optional(),
      })
      .strict(),
    output: z
      .object({ number: itemNumberSchema.nullable(), url: z.string() })
      .strict(),
  },
  startWork: {
    input: itemInputSchema,
    output: z
      .object({ threadId: z.string().min(1), created: z.boolean() })
      .strict(),
  },
  startReview: {
    input: itemInputSchema,
    output: z
      .object({ threadId: z.string().min(1), created: z.boolean() })
      .strict(),
  },
  listLinks: {
    input: z.null(),
    output: z
      .object({ links: z.record(z.string(), z.array(threadLinkSchema)) })
      .strict(),
  },
});

interface RepoInfo {
  repo: string; // "owner/name"
  projectId: string;
  /** Null deliberately means this project follows the active gh CLI viewer. */
  githubAccountLogin: string | null;
  defaultSourceHostId: string | null;
}

interface CachedItem {
  repo: string;
  number: number;
  kind: "issue" | "pr";
  title: string;
  state: string;
  author: string;
  labels: string[];
  assignees: string[];
  url: string;
  body: string;
  updatedAt: string;
}

interface GhListEntry {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  author?: { login?: unknown };
  labels?: Array<{ name?: unknown }>;
  assignees?: Array<{ login?: unknown }>;
  url?: unknown;
  body?: unknown;
  updatedAt?: unknown;
}

type GhRunner = (args: string[]) => Promise<string>;

interface ThreadLink {
  kind: "issue" | "pr";
  repo: string;
  number: number;
  threadId: string;
  createdAt: string;
}

interface BbProjectSummary {
  id: string;
  gitRemoteUrl?: string | null;
  githubAccountLogin?: string | null;
  sources?: readonly {
    hostId: string;
    isDefault: boolean;
  }[];
}

function needsConfiguration(message: string): Error {
  return Object.assign(new Error(message), {
    name: "NeedsConfigurationError",
  });
}

/** owner/name from any GitHub remote URL (https, ssh, git@), else null. */
export function parseGithubRemote(url: string): string | null {
  const match = url
    .trim()
    .match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  if (match === null) return null;
  return `${match[1]}/${match[2]}`;
}

export function githubReposFromProjects(
  projects: readonly BbProjectSummary[],
): RepoInfo[] {
  const byRepo = new Map<string, RepoInfo>();
  for (const project of projects) {
    const repo = parseGithubRemote(project.gitRemoteUrl ?? "");
    const githubAccountLogin =
      project.githubAccountLogin?.trim().toLowerCase() || null;
    const key = `${githubAccountLogin ?? ""}:${repo ?? ""}`;
    if (repo !== null) {
      const sources = project.sources ?? [];
      const defaultSource = sources.find((source) => source.isDefault) ?? null;
      const candidate = {
        repo,
        projectId: project.id,
        githubAccountLogin,
        defaultSourceHostId: defaultSource?.hostId ?? null,
      };
      const current = byRepo.get(key);
      // One GitHub repository can be attached to multiple BB projects. The
      // smallest stable project id owns this repo+account association so
      // workspace placement never depends on projects.list response order.
      if (
        current === undefined ||
        candidate.projectId.localeCompare(current.projectId) < 0
      ) {
        byRepo.set(key, candidate);
      }
    }
  }
  return [...byRepo.values()];
}

function isRepoName(value: unknown): value is string {
  return typeof value === "string" && /^[\w.-]+\/[\w.-]+$/.test(value);
}

function run(
  file: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `${file} ${args.slice(0, 3).join(" ")} failed: ${
                stderr.trim() || error.message
              }`,
            ),
          );
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
  });
}

export function parsePaginatedGhApi(raw: string): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("GitHub API pagination returned a non-array response");
  }
  const rows: Record<string, unknown>[] = [];
  for (const page of parsed) {
    if (!Array.isArray(page)) {
      throw new Error("GitHub API pagination returned a malformed page");
    }
    for (const row of page) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        throw new Error("GitHub API pagination returned a malformed row");
      }
      rows.push(row as Record<string, unknown>);
    }
  }
  return rows;
}

export function validateGithubCliArgs(argv: string[]): string | null {
  const [sub, arg, ...rest] = argv;
  if (rest.length > 0) return `Unexpected argument "${rest[0]}".`;
  if (sub === undefined) return null;
  if (sub === "help" || sub === "--help") {
    return arg === undefined ? null : `Unexpected argument "${arg}".`;
  }
  if (sub === "repos" || sub === "sync") {
    return arg === undefined
      ? null
      : `Subcommand "${sub}" does not accept arguments.`;
  }
  if ((sub === "issues" || sub === "prs") && arg !== undefined) {
    return isRepoName(arg)
      ? null
      : `Invalid repository "${arg}"; expected owner/repo.`;
  }
  return null;
}

export function shouldRefreshGithubCache(
  lastSyncedAt: string | null,
  nowMs = Date.now(),
): boolean {
  if (lastSyncedAt === null) return true;
  const lastSyncedMs = Date.parse(lastSyncedAt);
  return (
    !Number.isFinite(lastSyncedMs) ||
    nowMs - lastSyncedMs >= DEMAND_SYNC_STALE_MS
  );
}

function toItems(
  raw: string,
  repo: string,
  kind: "issue" | "pr",
): CachedItem[] {
  const entries = JSON.parse(raw) as GhListEntry[];
  return entries
    .filter(
      (entry): entry is GhListEntry & { number: number } =>
        typeof entry?.number === "number",
    )
    .map((entry) => ({
      repo,
      number: entry.number,
      kind,
      title: String(entry.title ?? ""),
      state: String(entry.state ?? "OPEN"),
      author: String(entry.author?.login ?? ""),
      labels: (entry.labels ?? []).map((label) => String(label?.name ?? "")),
      assignees: (entry.assignees ?? []).map((user) =>
        String(user?.login ?? ""),
      ),
      url: String(entry.url ?? ""),
      body: typeof entry.body === "string" ? entry.body : "",
      updatedAt: String(entry.updatedAt ?? ""),
    }));
}

// Open items plus a page of recently-closed ones, so the Closed filter has
// something to show without a live gh call per view.
export async function fetchRepoItems(
  gh: GhRunner,
  repo: string,
): Promise<CachedItem[]> {
  const fields =
    "number,title,state,author,labels,assignees,url,body,updatedAt";
  // A repo with GitHub Issues disabled must not abort the whole sync —
  // PRs still exist and should be cached.
  const ghIssuesTolerant = (args: string[]) =>
    gh(args).catch((error: unknown) => {
      if (String(error).toLowerCase().includes("disabled issues")) return "[]";
      throw error;
    });
  const [openIssues, closedIssues, openPrs, closedPrs] = await Promise.all([
    ghIssuesTolerant([
      "issue",
      "list",
      "-R",
      repo,
      "--state",
      "open",
      "--limit",
      String(ISSUE_PAGE),
      "--json",
      fields,
    ]),
    ghIssuesTolerant([
      "issue",
      "list",
      "-R",
      repo,
      "--state",
      "closed",
      "--limit",
      String(CLOSED_ISSUE_PAGE),
      "--json",
      fields,
    ]),
    gh([
      "pr",
      "list",
      "-R",
      repo,
      "--state",
      "open",
      "--limit",
      String(PR_PAGE),
      "--json",
      fields,
    ]),
    gh([
      "pr",
      "list",
      "-R",
      repo,
      "--state",
      "closed",
      "--limit",
      String(CLOSED_PR_PAGE),
      "--json",
      fields,
    ]),
  ]);
  return [
    ...toItems(openIssues, repo, "issue"),
    ...toItems(closedIssues, repo, "issue"),
    ...toItems(openPrs, repo, "pr"),
    ...toItems(closedPrs, repo, "pr"),
  ];
}

export default async function plugin(bb: BbPluginApi) {
  // ------------------------------------------------------------------
  // gh CLI plumbing. The server process may have a trimmed PATH, so probe
  // common install locations once and remember the winner.
  // ------------------------------------------------------------------
  let ghPath: string | null = null;
  let ghAuthError: string | null = null;

  async function resolveGh(): Promise<string> {
    if (ghPath !== null) return ghPath;
    const candidates = ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"];
    for (const candidate of candidates) {
      try {
        await run(candidate, ["--version"], 5_000);
        ghPath = candidate;
        return candidate;
      } catch {
        // try the next location
      }
    }
    throw needsConfiguration(`GitHub CLI not found. ${GH_HINT}`);
  }

  async function gh(args: string[], timeoutMs?: number): Promise<string> {
    const file = await resolveGh();
    const { stdout } = await run(file, args, timeoutMs);
    return stdout;
  }

  async function checkAuth(): Promise<void> {
    try {
      await gh(["auth", "status"], 10_000);
      ghAuthError = null;
    } catch (error) {
      ghAuthError = error instanceof Error ? error.message : String(error);
      throw needsConfiguration(`GitHub CLI is not authenticated. ${GH_HINT}`);
    }
  }

  // ------------------------------------------------------------------
  // Repo discovery: BB project sources → git origin → owner/repo.
  // ------------------------------------------------------------------
  let repoCache: { repos: RepoInfo[]; fetchedAt: number } | null = null;

  async function discoverRepos(force = false): Promise<RepoInfo[]> {
    if (
      !force &&
      repoCache !== null &&
      Date.now() - repoCache.fetchedAt < 60_000
    ) {
      return repoCache.repos;
    }
    let repos: RepoInfo[] = [];
    try {
      const projects = await bb.sdk.projects.list();
      repos = githubReposFromProjects(projects);
    } catch (error) {
      bb.log.warn(
        `project discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    repoCache = { repos, fetchedAt: Date.now() };
    return repos;
  }

  function reposForAccount(
    repos: readonly RepoInfo[],
    accountLogin: string,
  ): RepoInfo[] {
    const byRepo = new Map<string, RepoInfo>();
    for (const repo of repos
      .filter(
        (entry) =>
          entry.githubAccountLogin === null ||
          entry.githubAccountLogin === accountLogin,
      )
      .sort((left, right) => left.projectId.localeCompare(right.projectId))) {
      const current = byRepo.get(repo.repo);
      if (
        current === undefined ||
        (current.githubAccountLogin === null &&
          repo.githubAccountLogin === accountLogin)
      ) {
        byRepo.set(repo.repo, repo);
      }
    }
    return [...byRepo.values()];
  }

  function publicRepoInfo(repo: RepoInfo, accountLogin: string | null) {
    const available =
      accountLogin !== null &&
      (repo.githubAccountLogin === null ||
        repo.githubAccountLogin === accountLogin);
    return {
      repo: repo.repo,
      projectId: repo.projectId,
      githubAccountLogin: repo.githubAccountLogin,
      available,
      unavailableReason: available
        ? null
        : accountLogin === null
          ? "The active GitHub CLI account could not be resolved."
          : `This project uses ${repo.githubAccountLogin}; gh is authenticated as ${accountLogin}.`,
    };
  }

  function publicRepos(
    repos: readonly RepoInfo[],
    accountLogin: string | null,
  ) {
    const byRepo = new Map<string, RepoInfo>();
    for (const repo of [...repos].sort((left, right) =>
      left.projectId.localeCompare(right.projectId),
    )) {
      const current = byRepo.get(repo.repo);
      const repoAvailable =
        accountLogin !== null &&
        (repo.githubAccountLogin === null ||
          repo.githubAccountLogin === accountLogin);
      const currentAvailable =
        current !== undefined &&
        accountLogin !== null &&
        (current.githubAccountLogin === null ||
          current.githubAccountLogin === accountLogin);
      if (current === undefined || (repoAvailable && !currentAvailable)) {
        byRepo.set(repo.repo, repo);
      }
    }
    return [...byRepo.values()].map((repo) =>
      publicRepoInfo(repo, accountLogin),
    );
  }

  // ------------------------------------------------------------------
  // SQLite cache of open issues + PRs across tracked repos. Repo discovery is
  // intentionally GitHub.com-only, so the gh viewer login is the complete
  // account partition here; this plugin has no separate GitHub host dimension.
  // ------------------------------------------------------------------
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS items (
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
    `ALTER TABLE items RENAME TO items_without_account;
     CREATE TABLE items (
       account_login TEXT NOT NULL,
       repo TEXT NOT NULL,
       number INTEGER NOT NULL,
       kind TEXT NOT NULL,
       title TEXT NOT NULL,
       state TEXT NOT NULL,
       author TEXT NOT NULL,
       labels TEXT NOT NULL,
       assignees TEXT NOT NULL,
       url TEXT NOT NULL,
       body TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (account_login, repo, kind, number)
     );
     INSERT INTO items (
       account_login, repo, number, kind, title, state, author, labels,
       assignees, url, body, updated_at
     )
     SELECT
       '', repo, number, kind, title, state, author, labels,
       assignees, url, body, updated_at
     FROM items_without_account;
     DROP TABLE items_without_account`,
  ]);

  function parseStringArray(raw: unknown): string[] {
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // tolerate a corrupt row rather than failing the whole list
    }
    return [];
  }

  function rowToItem(row: Record<string, unknown>): CachedItem {
    return {
      repo: String(row.repo),
      number: Number(row.number),
      kind: row.kind === "pr" ? "pr" : "issue",
      title: String(row.title),
      state: String(row.state),
      author: String(row.author),
      labels: parseStringArray(row.labels),
      assignees: parseStringArray(row.assignees),
      url: String(row.url),
      body: String(row.body),
      updatedAt: String(row.updated_at),
    };
  }

  function listCachedItems(
    accountLogin: string,
    options: {
      kind?: "issue" | "pr";
      repo?: string;
      query?: string;
      /** "open" → OPEN only; "closed" → everything else (CLOSED, MERGED). */
      state?: "open" | "closed";
      /** Only items whose assignees include this login. */
      assignee?: string;
    },
  ): CachedItem[] {
    const clauses = ["account_login = ?"];
    const params: unknown[] = [accountLogin];
    if (options.kind !== undefined) {
      clauses.push("kind = ?");
      params.push(options.kind);
    }
    if (options.repo !== undefined) {
      clauses.push("repo = ?");
      params.push(options.repo);
    }
    if (options.state === "open") {
      clauses.push("state = 'OPEN'");
    } else if (options.state === "closed") {
      clauses.push("state != 'OPEN'");
    }
    if (options.assignee !== undefined) {
      clauses.push("assignees LIKE ?");
      params.push(`%${JSON.stringify(options.assignee)}%`);
    }
    const query = options.query?.trim() ?? "";
    if (query.length > 0) {
      clauses.push(
        "(title LIKE ? OR CAST(number AS TEXT) LIKE ? OR repo LIKE ?)",
      );
      const like = `%${query.replace(/^#/, "")}%`;
      params.push(like, like, like);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM items ${where} ORDER BY updated_at DESC`)
      .all(...params) as Record<string, unknown>[];
    return rows.map(rowToItem);
  }

  function getCachedItem(
    accountLogin: string,
    kind: "issue" | "pr",
    repo: string,
    number: number,
  ): CachedItem | null {
    const row = db
      .prepare(
        "SELECT * FROM items WHERE account_login = ? AND repo = ? AND kind = ? AND number = ?",
      )
      .get(accountLogin, repo, kind, number) as
      | Record<string, unknown>
      | undefined;
    return row === undefined ? null : rowToItem(row);
  }

  function replaceRepoRows(
    accountLogin: string,
    repo: string,
    items: CachedItem[],
  ): void {
    const insert = db.prepare(
      `INSERT INTO items (account_login, repo, number, kind, title, state, author, labels, assignees, url, body, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    db.transaction(() => {
      db.prepare("DELETE FROM items WHERE account_login = ? AND repo = ?").run(
        accountLogin,
        repo,
      );
      for (const item of items) {
        insert.run(
          accountLogin,
          item.repo,
          item.number,
          item.kind,
          item.title,
          item.state,
          item.author,
          JSON.stringify(item.labels),
          JSON.stringify(item.assignees),
          item.url,
          item.body,
          item.updatedAt,
        );
      }
    })();
  }

  /** Patch a cached row in place after a mutation so the UI updates without
      waiting for the next full sync. */
  function patchCachedItem(
    accountLogin: string,
    kind: "issue" | "pr",
    repo: string,
    number: number,
    patch: { state?: string; assignees?: string[]; labels?: string[] },
  ): void {
    if (patch.state !== undefined) {
      db.prepare(
        "UPDATE items SET state = ? WHERE account_login = ? AND repo = ? AND kind = ? AND number = ?",
      ).run(patch.state, accountLogin, repo, kind, number);
    }
    if (patch.assignees !== undefined) {
      db.prepare(
        "UPDATE items SET assignees = ? WHERE account_login = ? AND repo = ? AND kind = ? AND number = ?",
      ).run(JSON.stringify(patch.assignees), accountLogin, repo, kind, number);
    }
    if (patch.labels !== undefined) {
      db.prepare(
        "UPDATE items SET labels = ? WHERE account_login = ? AND repo = ? AND kind = ? AND number = ?",
      ).run(JSON.stringify(patch.labels), accountLogin, repo, kind, number);
    }
    bb.realtime.publish("data-changed", {});
  }

  async function syncAll(
    accountLogin: string,
    force = false,
  ): Promise<{ repos: number; items: number }> {
    await checkAuth();
    const repos = reposForAccount(await discoverRepos(force), accountLogin);
    const before = JSON.stringify(
      db
        .prepare(
          "SELECT repo, kind, number, updated_at FROM items WHERE account_login = ? ORDER BY repo, kind, number",
        )
        .all(accountLogin),
    );
    let total = 0;
    for (const { repo } of repos) {
      try {
        const items = await fetchRepoItems(gh, repo);
        replaceRepoRows(accountLogin, repo, items);
        total += items.length;
      } catch (error) {
        bb.log.warn(
          `sync failed for ${repo}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const after = JSON.stringify(
      db
        .prepare(
          "SELECT repo, kind, number, updated_at FROM items WHERE account_login = ? ORDER BY repo, kind, number",
        )
        .all(accountLogin),
    );
    await bb.storage.kv.set(syncCursorKey(accountLogin), {
      lastSyncedAt: new Date().toISOString(),
      repos: repos.length,
      items: total,
    });
    bb.realtime.publish("sync-changed", {});
    if (before !== after) {
      bb.realtime.publish("data-changed", { items: total });
    }
    bb.log.info(`synced ${total} item(s) across ${repos.length} repo(s)`);
    return { repos: repos.length, items: total };
  }

  const syncInFlightByLogin = new Map<
    string,
    Promise<{ repos: number; items: number }>
  >();
  const nextDemandSyncAtMsByLogin = new Map<string, number>();
  async function requestSync(
    force = false,
  ): Promise<{ repos: number; items: number }> {
    // `gh auth switch` can happen while the plugin process stays alive. Never
    // choose a cache partition for a live sync from the TTL viewer cache.
    const accountLogin = await ensureCacheAccount(true);
    const existing = syncInFlightByLogin.get(accountLogin);
    if (existing !== undefined) return existing;
    const request = syncAll(accountLogin, force).finally(() => {
      if (syncInFlightByLogin.get(accountLogin) === request) {
        syncInFlightByLogin.delete(accountLogin);
      }
    });
    syncInFlightByLogin.set(accountLogin, request);
    return request;
  }

  // ------------------------------------------------------------------
  // Issue/PR ↔ thread links (the pills in the UI).
  // kv: "link:<kind>:<repo>#<number>" → ThreadLink[]
  // ------------------------------------------------------------------
  function linkKey(kind: "issue" | "pr", repo: string, number: number): string {
    return `link:${kind}:${repo}#${number}`;
  }

  async function addLink(link: ThreadLink): Promise<void> {
    const key = linkKey(link.kind, link.repo, link.number);
    const existing = (await bb.storage.kv.get<ThreadLink[]>(key)) ?? [];
    await bb.storage.kv.set(key, [...existing, link]);
    bb.realtime.publish("links-changed", { key });
  }

  async function listAllLinks(): Promise<Record<string, ThreadLink[]>> {
    const keys = await bb.storage.kv.list("link:");
    const result: Record<string, ThreadLink[]> = {};
    for (const key of keys) {
      const links = await bb.storage.kv.get<ThreadLink[]>(key);
      if (links !== undefined && links.length > 0) {
        result[key.slice("link:".length)] = links;
      }
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Spawning agent threads on issues / PR reviews.
  // ------------------------------------------------------------------
  async function resolveRepoProject(
    repo: string,
    accountLogin: string,
  ): Promise<RepoInfo> {
    const candidates = (await discoverRepos(true))
      .filter((entry) => entry.repo === repo)
      .sort((left, right) => left.projectId.localeCompare(right.projectId));
    if (candidates.length === 0) {
      throw new Error(
        `No BB project is attached to ${repo}. Add this repository to BB before starting a conversation.`,
      );
    }
    const info =
      candidates.find((entry) => entry.githubAccountLogin === accountLogin) ??
      candidates.find((entry) => entry.githubAccountLogin === null);
    if (info === undefined) {
      const configuredAccounts = [
        ...new Set(
          candidates
            .map((entry) => entry.githubAccountLogin)
            .filter((login): login is string => login !== null),
        ),
      ].join(", ");
      throw new Error(
        `${repo} is attached to GitHub account ${configuredAccounts}, but gh is authenticated as ${accountLogin}. ` +
          "Select the matching GitHub account for the BB project or authenticate gh with that account.",
      );
    }
    return info;
  }

  function requireWorkspaceProject(
    info: RepoInfo,
  ): RepoInfo & { defaultSourceHostId: string } {
    if (info.defaultSourceHostId === null) {
      throw new Error(
        `The BB project for ${info.repo} has no default local source. Add a default project source before starting a conversation.`,
      );
    }
    return { ...info, defaultSourceHostId: info.defaultSourceHostId };
  }

  async function reusableThreadId(
    kind: "issue" | "pr",
    repo: string,
    number: number,
    projectIds: ReadonlySet<string>,
  ): Promise<string | null> {
    const links =
      (await bb.storage.kv.get<ThreadLink[]>(linkKey(kind, repo, number))) ??
      [];
    for (const link of [...links].reverse()) {
      try {
        const thread = await bb.sdk.threads.get({ threadId: link.threadId });
        if (projectIds.has(thread.projectId)) return link.threadId;
      } catch {
        // Deleted or inaccessible threads are stale links; try an older one.
      }
    }
    return null;
  }

  async function reusablePullWorkspaceThreadId(
    repo: string,
    number: number,
    projectId: string,
    headRefName: string,
  ): Promise<string | null> {
    const threads = await bb.sdk.threads.list({
      projectId,
      archived: false,
      limit: 100,
    });
    const candidates = threads
      .filter(
        (thread) =>
          thread.environmentId !== null &&
          thread.environmentBranchName === headRefName,
      )
      .sort((left, right) => right.updatedAt - left.updatedAt);
    for (const thread of candidates) {
      if (thread.environmentId === null) continue;
      try {
        const result = await bb.sdk.environments.pullRequest({
          environmentId: thread.environmentId,
        });
        if (
          result.outcome === "available" &&
          result.pullRequest.number === number &&
          parseGithubPullUrl(result.pullRequest.url)?.repo === repo
        ) {
          return thread.id;
        }
      } catch {
        // A stale environment must not prevent checking another matching tab.
      }
    }
    return null;
  }

  function parseGithubPullUrl(
    url: string,
  ): { repo: string; number: number } | null {
    const match = url.match(
      /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#]|$)/,
    );
    if (match === null) return null;
    return { repo: match[1], number: Number(match[2]) };
  }

  async function spawnOnItem(
    kind: "issue" | "pr",
    repo: string,
    number: number,
  ): Promise<{ threadId: string; created: boolean }> {
    const attachedProjects = (await discoverRepos(true))
      .filter((entry) => entry.repo === repo)
      .sort((left, right) => left.projectId.localeCompare(right.projectId));
    if (attachedProjects.length === 0) {
      throw new Error(
        `No BB project is attached to ${repo}. Add this repository to BB before starting a conversation.`,
      );
    }
    // Opening an existing local conversation is read-only. Resolve it before
    // touching gh so a switched/offline account never blocks navigation.
    const existingThreadId = await reusableThreadId(
      kind,
      repo,
      number,
      new Set(attachedProjects.map((project) => project.projectId)),
    );
    if (existingThreadId !== null) {
      return { threadId: existingThreadId, created: false };
    }

    const access = await requireRepoAccess(repo);
    const accountLogin = access.accountLogin;
    const project = requireWorkspaceProject(access.project);
    const item = getCachedItem(accountLogin, kind, repo, number);
    let title = item?.title ?? `${kind === "pr" ? "PR" : "issue"} #${number}`;
    let pullBaseRefName: string | null = null;
    let pullHeadRefName: string | null = null;
    if (kind === "pr") {
      const raw = await gh([
        "pr",
        "view",
        String(number),
        "-R",
        repo,
        "--json",
        "number,title,baseRefName,headRefName",
      ]);
      const pull = JSON.parse(raw) as {
        number?: unknown;
        title?: unknown;
        baseRefName?: unknown;
        headRefName?: unknown;
      };
      if (Number(pull.number) !== number) {
        throw new Error(
          `GitHub returned an unexpected pull request for ${repo}#${number}.`,
        );
      }
      title = String(pull.title ?? title);
      pullBaseRefName = String(pull.baseRefName ?? "").trim();
      pullHeadRefName = String(pull.headRefName ?? "").trim();
      if (pullBaseRefName.length === 0) {
        throw new Error(
          `GitHub did not return a base branch for ${repo}#${number}.`,
        );
      }
      if (pullHeadRefName.length === 0) {
        throw new Error(
          `GitHub did not return a head branch for ${repo}#${number}.`,
        );
      }
      const workspaceThreadId = await reusablePullWorkspaceThreadId(
        repo,
        number,
        project.projectId,
        pullHeadRefName,
      );
      if (workspaceThreadId !== null) {
        await addLink({
          kind,
          repo,
          number,
          threadId: workspaceThreadId,
          createdAt: new Date().toISOString(),
        });
        return { threadId: workspaceThreadId, created: false };
      }
    }
    const ref = `${repo}#${number}`;
    const prompt =
      kind === "issue"
        ? [
            `Work on GitHub issue ${ref}: ${title}`,
            "",
            "Read the full issue and its comments first:",
            `  gh issue view ${number} -R ${repo} --comments`,
            "",
            item !== null && item.body.length > 0
              ? `Issue description:\n\n${item.body}`
              : "(no cached description — read it with the command above)",
            "",
            "Implement a fix or the requested change in this checkout. " +
              `If you open a pull request, include "Fixes #${number}" in its body.`,
          ].join("\n")
        : [
            `Review GitHub pull request ${ref}: ${title}`,
            "",
            "Read the PR and its diff:",
            `  gh pr view ${number} -R ${repo} --comments`,
            `  gh pr diff ${number} -R ${repo}`,
            "",
            "Review the change for correctness, missing tests, and design issues. " +
              "Summarize your findings with file/line references. Do not push " +
              "changes or post to GitHub unless asked.",
          ].join("\n");
    const workspace = (() => {
      if (kind === "pr") {
        if (pullBaseRefName === null) {
          throw new Error(`GitHub did not return a base branch for ${ref}.`);
        }
        return {
          type: "managed-worktree" as const,
          baseBranch: { kind: "named" as const, name: pullBaseRefName },
          pullRequestNumber: number,
        };
      }
      return {
        type: "managed-worktree" as const,
        baseBranch: { kind: "default" as const },
      };
    })();
    const thread = await bb.sdk.threads.spawn({
      projectId: project.projectId,
      environment: {
        type: "host",
        hostId: project.defaultSourceHostId,
        workspace,
      },
      title: `${ref}: ${title}`.slice(0, 120),
      prompt,
    });
    await addLink({
      kind,
      repo,
      number,
      threadId: thread.id,
      createdAt: new Date().toISOString(),
    });
    bb.log.info(`spawned thread ${thread.id} for ${kind} ${ref}`);
    return { threadId: thread.id, created: true };
  }

  const conversationInFlight = new Map<
    string,
    Promise<{ threadId: string; created: boolean }>
  >();

  async function openConversation(
    kind: "issue" | "pr",
    repo: string,
    number: number,
  ): Promise<{ threadId: string; created: boolean }> {
    const key = `${kind}:${repo}#${number}`;
    const existing = conversationInFlight.get(key);
    if (existing !== undefined) return existing;
    const request = spawnOnItem(kind, repo, number).finally(() => {
      if (conversationInFlight.get(key) === request) {
        conversationInFlight.delete(key);
      }
    });
    conversationInFlight.set(key, request);
    return request;
  }

  // ------------------------------------------------------------------
  // Viewer identity + per-repo assignable users, cached in memory so the
  // filter chips and assignee picker don't hit the network on every render.
  // ------------------------------------------------------------------
  let viewerCache: { login: string; fetchedAt: number } | null = null;
  let viewerInFlight: Promise<string> | null = null;
  let verifiedCacheLogin: string | null = null;

  async function getViewer(force = false): Promise<string> {
    if (
      !force &&
      viewerCache !== null &&
      Date.now() - viewerCache.fetchedAt < VIEWER_CACHE_TTL_MS
    ) {
      return viewerCache.login;
    }
    if (viewerInFlight !== null) return viewerInFlight;
    const request = gh(["api", "user"], 15_000)
      .then((raw) => {
        const login = String(
          (JSON.parse(raw) as { login?: unknown })?.login ?? "",
        )
          .trim()
          .toLowerCase();
        if (login.length === 0)
          throw new Error("could not resolve the gh viewer login");
        viewerCache = { login, fetchedAt: Date.now() };
        return login;
      })
      .finally(() => {
        if (viewerInFlight === request) viewerInFlight = null;
      });
    viewerInFlight = request;
    return request;
  }

  async function ensureCacheAccount(forceViewer = false): Promise<string> {
    const login = await getViewer(forceViewer);
    if (verifiedCacheLogin === login) return login;
    const legacyLoginRaw = await bb.storage.kv.get<string>(
      "cache-account-login",
    );
    const legacyLogin = legacyLoginRaw?.trim().toLowerCase();
    if (legacyLogin !== undefined) {
      db.prepare(
        "UPDATE OR IGNORE items SET account_login = ? WHERE account_login = ''",
      ).run(legacyLogin);
      db.prepare("DELETE FROM items WHERE account_login = ''").run();
      const legacyCursor = await bb.storage.kv.get<{
        lastSyncedAt: string;
        repos: number;
        items: number;
      }>("sync-cursor");
      if (
        legacyCursor !== undefined &&
        (await bb.storage.kv.get(syncCursorKey(legacyLogin))) === undefined
      ) {
        await bb.storage.kv.set(syncCursorKey(legacyLogin), legacyCursor);
      }
    } else {
      db.prepare("DELETE FROM items WHERE account_login = ''").run();
    }
    await bb.storage.kv.delete("sync-cursor");
    await bb.storage.kv.set("cache-account-login", login);
    verifiedCacheLogin = login;
    return login;
  }

  async function requireRepoAccess(repo: string): Promise<{
    accountLogin: string;
    project: RepoInfo;
  }> {
    // Every live repo operation crosses the gh CLI boundary, so resolve the
    // viewer again first. This prevents a same-process `gh auth switch` from
    // authorizing Bob's operation with Alice's cached identity or cache key.
    const accountLogin = await ensureCacheAccount(true);
    const project = await resolveRepoProject(repo, accountLogin);
    return { accountLogin, project };
  }

  function syncCursorKey(accountLogin: string): string {
    return `sync-cursor:${accountLogin}`;
  }

  const assignableCache = new Map<
    string,
    { users: string[]; fetchedAt: number }
  >();
  const labelsCache = new Map<
    string,
    { labels: string[]; fetchedAt: number }
  >();

  async function getAssignableUsers(
    accountLogin: string,
    repo: string,
  ): Promise<string[]> {
    const cacheKey = `${accountLogin}:${repo}`;
    const cached = assignableCache.get(cacheKey);
    if (cached !== undefined && Date.now() - cached.fetchedAt < 10 * 60_000) {
      return cached.users;
    }
    const raw = await gh(
      ["api", `repos/${repo}/assignees?per_page=100`],
      15_000,
    );
    const entries = JSON.parse(raw) as Array<{ login?: unknown }>;
    const users = entries
      .map((entry) => String(entry?.login ?? ""))
      .filter((login) => login.length > 0)
      .sort((a, b) => a.localeCompare(b));
    assignableCache.set(cacheKey, { users, fetchedAt: Date.now() });
    return users;
  }

  async function getRepoLabels(
    accountLogin: string,
    repo: string,
  ): Promise<string[]> {
    const cacheKey = `${accountLogin}:${repo}`;
    const cached = labelsCache.get(cacheKey);
    if (cached !== undefined && Date.now() - cached.fetchedAt < 10 * 60_000) {
      return cached.labels;
    }
    const raw = await gh(["api", `repos/${repo}/labels?per_page=100`], 15_000);
    const entries = JSON.parse(raw) as Array<{ name?: unknown }>;
    const labels = entries
      .map((entry) => String(entry?.name ?? "").trim())
      .filter((name) => name.length > 0)
      .sort((a, b) => a.localeCompare(b));
    labelsCache.set(cacheKey, { labels, fetchedAt: Date.now() });
    return labels;
  }

  // ------------------------------------------------------------------
  // rpc — the frontend data plane.
  // ------------------------------------------------------------------
  bb.rpc.register(githubRpcContract, {
    /** () → auth/sync status for the panel banner. */
    async status() {
      const discoveredRepos = await discoverRepos();
      let accountLogin: string;
      try {
        accountLogin = await ensureCacheAccount(true);
      } catch (error) {
        return {
          ghOk: false,
          ghError: error instanceof Error ? error.message : String(error),
          repos: publicRepos(discoveredRepos, null),
          lastSyncedAt: null,
        };
      }
      const cursor = await bb.storage.kv.get<{
        lastSyncedAt: string;
        repos: number;
        items: number;
      }>(syncCursorKey(accountLogin));
      if (
        shouldRefreshGithubCache(cursor?.lastSyncedAt ?? null) &&
        Date.now() >= (nextDemandSyncAtMsByLogin.get(accountLogin) ?? 0)
      ) {
        nextDemandSyncAtMsByLogin.set(
          accountLogin,
          Date.now() + DEMAND_SYNC_STALE_MS,
        );
        void requestSync().catch((error: unknown) => {
          bb.status.needsConfiguration(
            error instanceof Error ? error.message : String(error),
          );
          bb.log.warn(
            `on-demand sync failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          bb.realtime.publish("sync-changed", {});
        });
      }
      return {
        ghOk: ghAuthError === null,
        ghError: ghAuthError,
        repos: publicRepos(discoveredRepos, accountLogin),
        lastSyncedAt: cursor?.lastSyncedAt ?? null,
      };
    },

    /** () → force a full sync now. */
    async refresh() {
      return await requestSync(true);
    },

    /** { kind?, repo?, query?, state?, mine? } → cached items, newest first. */
    async listItems(input) {
      const accountLogin = await ensureCacheAccount(true);
      return {
        items: listCachedItems(accountLogin, {
          kind: input.kind,
          repo: input.repo,
          query: input.query,
          state: input.state,
          assignee: input.mine === true ? accountLogin : undefined,
        }),
      };
    },

    /** () → the authenticated gh login, for "assign to me" affordances. */
    async viewer() {
      return { login: await ensureCacheAccount(true) };
    },

    /** { repo } → logins that can be assigned to issues in that repo. */
    async assignableUsers(input) {
      const { accountLogin } = await requireRepoAccess(input.repo);
      return { users: await getAssignableUsers(accountLogin, input.repo) };
    },

    /** { repo } → labels available in that repo. */
    async repositoryLabels(input) {
      const { accountLogin } = await requireRepoAccess(input.repo);
      return { labels: await getRepoLabels(accountLogin, input.repo) };
    },

    /** { repo, number, state: "open"|"closed" } → close or reopen an issue. */
    async setIssueState({ repo, number, state }): Promise<{ ok: true }> {
      const { accountLogin } = await requireRepoAccess(repo);
      await gh([
        "issue",
        state === "closed" ? "close" : "reopen",
        String(number),
        "-R",
        repo,
      ]);
      patchCachedItem(accountLogin, "issue", repo, number, {
        state: state === "closed" ? "CLOSED" : "OPEN",
      });
      return { ok: true };
    },

    /** { repo, number, assignees: string[] } → set the exact assignee list. */
    async setAssignees({
      repo,
      number,
      assignees,
    }): Promise<{ ok: true; assignees: string[] }> {
      const { accountLogin } = await requireRepoAccess(repo);
      const next = [...new Set(assignees)];
      const current =
        getCachedItem(accountLogin, "issue", repo, number)?.assignees ?? [];
      const add = next.filter((login) => !current.includes(login));
      const remove = current.filter((login) => !next.includes(login));
      if (add.length === 0 && remove.length === 0)
        return { ok: true, assignees: next };
      const args = ["issue", "edit", String(number), "-R", repo];
      if (add.length > 0) args.push("--add-assignee", add.join(","));
      if (remove.length > 0) args.push("--remove-assignee", remove.join(","));
      await gh(args);
      patchCachedItem(accountLogin, "issue", repo, number, { assignees: next });
      return { ok: true, assignees: next };
    },

    /** { repo, number, labels: string[] } → set the exact issue label list. */
    async setLabels({
      repo,
      number,
      labels,
    }): Promise<{ ok: true; labels: string[] }> {
      const { accountLogin } = await requireRepoAccess(repo);
      const next = [
        ...new Set(labels.map((label) => label.trim()).filter(Boolean)),
      ];
      const currentRaw = await gh(
        ["issue", "view", String(number), "-R", repo, "--json", "labels"],
        15_000,
      );
      const currentDetail = JSON.parse(currentRaw) as {
        labels?: Array<{ name?: unknown }>;
      };
      const current = (currentDetail.labels ?? [])
        .map((label) => String(label?.name ?? "").trim())
        .filter((label) => label.length > 0);
      const add = next.filter((label) => !current.includes(label));
      const remove = current.filter((label) => !next.includes(label));
      if (add.length === 0 && remove.length === 0)
        return { ok: true, labels: next };
      const args = ["issue", "edit", String(number), "-R", repo];
      for (const label of add) args.push("--add-label", label);
      for (const label of remove) args.push("--remove-label", label);
      await gh(args);
      patchCachedItem(accountLogin, "issue", repo, number, { labels: next });
      return { ok: true, labels: next };
    },

    /** { repo, number } → live issue detail incl. comments. */
    async getIssue({ repo, number }) {
      await requireRepoAccess(repo);
      const raw = await gh([
        "issue",
        "view",
        String(number),
        "-R",
        repo,
        "--json",
        "number,title,body,state,author,createdAt,updatedAt,labels,assignees,url,comments",
      ]);
      const detail = JSON.parse(raw) as {
        comments?: Array<{
          author?: { login?: unknown };
          body?: unknown;
          createdAt?: unknown;
        }>;
      } & GhListEntry;
      return {
        issue: {
          repo,
          number,
          title: String(detail.title ?? ""),
          state: String(detail.state ?? ""),
          author: String(detail.author?.login ?? ""),
          body: typeof detail.body === "string" ? detail.body : "",
          labels: (detail.labels ?? []).map((label) =>
            String(label?.name ?? ""),
          ),
          assignees: (detail.assignees ?? []).map((user) =>
            String(user?.login ?? ""),
          ),
          url: String(detail.url ?? ""),
          updatedAt: String(detail.updatedAt ?? ""),
          comments: (detail.comments ?? []).map((comment) => ({
            author: String(comment.author?.login ?? ""),
            body: typeof comment.body === "string" ? comment.body : "",
            createdAt: String(comment.createdAt ?? ""),
          })),
        },
      };
    },

    /** { repo, number } → fast PR overview and checks. Activity and file
        patches have separate calls so the first panel render starts one
        `gh` process instead of three. */
    async getPull({ repo, number }) {
      await requireRepoAccess(repo);
      const prFields =
        "number,title,body,state,isDraft,author,createdAt,updatedAt,labels," +
        "assignees,url,baseRefName,headRefName,additions,deletions," +
        "changedFiles,reviewDecision,mergeStateStatus,statusCheckRollup," +
        "reviewRequests";
      const viewRaw = await gh(
        ["pr", "view", String(number), "-R", repo, "--json", prFields],
        30_000,
      );

      interface GhPullView extends GhListEntry {
        isDraft?: unknown;
        createdAt?: unknown;
        baseRefName?: unknown;
        headRefName?: unknown;
        additions?: unknown;
        deletions?: unknown;
        changedFiles?: unknown;
        reviewDecision?: unknown;
        mergeStateStatus?: unknown;
        statusCheckRollup?: Array<{
          __typename?: unknown;
          name?: unknown;
          context?: unknown;
          status?: unknown;
          conclusion?: unknown;
          state?: unknown;
          detailsUrl?: unknown;
          targetUrl?: unknown;
        }>;
        reviewRequests?: Array<{
          login?: unknown;
          name?: unknown;
          slug?: unknown;
        }>;
      }
      const view = JSON.parse(viewRaw) as GhPullView;

      // CheckRun rows carry status/conclusion; classic StatusContext rows a
      // single state. Normalize both to one traffic-light value.
      const checks = (view.statusCheckRollup ?? []).map((entry) => {
        const conclusion = String(
          entry.conclusion ?? entry.state ?? "",
        ).toUpperCase();
        const running =
          entry.conclusion === "" ||
          ["IN_PROGRESS", "QUEUED", "PENDING", "EXPECTED", "WAITING"].includes(
            String(entry.status ?? entry.state ?? "").toUpperCase(),
          );
        const status: "success" | "failure" | "pending" | "neutral" =
          conclusion === "SUCCESS"
            ? "success"
            : conclusion === "FAILURE" ||
                conclusion === "ERROR" ||
                conclusion === "TIMED_OUT"
              ? "failure"
              : running
                ? "pending"
                : "neutral";
        return {
          name: String(entry.name ?? entry.context ?? "check"),
          status,
          url: String(entry.detailsUrl ?? entry.targetUrl ?? ""),
        };
      });

      return {
        pull: {
          repo,
          number,
          title: String(view.title ?? ""),
          state:
            view.isDraft === true && String(view.state ?? "") === "OPEN"
              ? "DRAFT"
              : String(view.state ?? ""),
          author: String(view.author?.login ?? ""),
          body: typeof view.body === "string" ? view.body : "",
          url: String(view.url ?? ""),
          createdAt: String(view.createdAt ?? ""),
          updatedAt: String(view.updatedAt ?? ""),
          baseRefName: String(view.baseRefName ?? ""),
          headRefName: String(view.headRefName ?? ""),
          additions: Number(view.additions ?? 0),
          deletions: Number(view.deletions ?? 0),
          changedFiles: Number(view.changedFiles ?? 0),
          labels: (view.labels ?? []).map((label) => String(label?.name ?? "")),
          assignees: (view.assignees ?? []).map((user) =>
            String(user?.login ?? ""),
          ),
          reviewDecision: String(view.reviewDecision ?? ""),
          mergeStateStatus: String(view.mergeStateStatus ?? ""),
          reviewRequests: (view.reviewRequests ?? [])
            .map((entry) =>
              String(entry.login ?? entry.name ?? entry.slug ?? ""),
            )
            .filter((name) => name.length > 0),
          checks,
        },
      };
    },

    /** { repo, number } → comments, reviews, and inline review threads. */
    async getPullActivity({ repo, number }) {
      await requireRepoAccess(repo);
      const [viewRaw, reviewCommentsRaw] = await Promise.all([
        gh(
          [
            "pr",
            "view",
            String(number),
            "-R",
            repo,
            "--json",
            "comments,reviews",
          ],
          30_000,
        ),
        gh(
          [
            "api",
            "--paginate",
            "--slurp",
            `repos/${repo}/pulls/${number}/comments?per_page=100`,
          ],
          30_000,
        ),
      ]);
      const view = JSON.parse(viewRaw) as {
        comments?: Array<{
          author?: { login?: unknown };
          body?: unknown;
          createdAt?: unknown;
        }>;
        reviews?: Array<{
          author?: { login?: unknown };
          state?: unknown;
          body?: unknown;
          submittedAt?: unknown;
        }>;
      };
      interface GhReviewComment {
        id?: unknown;
        in_reply_to_id?: unknown;
        path?: unknown;
        line?: unknown;
        original_line?: unknown;
        diff_hunk?: unknown;
        body?: unknown;
        created_at?: unknown;
        user?: { login?: unknown };
      }
      const reviewComments = parsePaginatedGhApi(
        reviewCommentsRaw,
      ) as GhReviewComment[];
      interface ReviewThread {
        path: string;
        line: number | null;
        diffHunk: string;
        comments: Array<{ author: string; body: string; createdAt: string }>;
      }
      // Group inline comments into threads: a comment without in_reply_to_id
      // roots a thread, replies chain onto their root's thread.
      const threadByRootId = new Map<number, ReviewThread>();
      for (const comment of reviewComments) {
        const id = Number(comment.id ?? NaN);
        const replyTo = Number(comment.in_reply_to_id ?? NaN);
        const entry = {
          author: String(comment.user?.login ?? ""),
          body: typeof comment.body === "string" ? comment.body : "",
          createdAt: String(comment.created_at ?? ""),
        };
        const rootThread = Number.isFinite(replyTo)
          ? threadByRootId.get(replyTo)
          : undefined;
        if (rootThread !== undefined) {
          rootThread.comments.push(entry);
          if (Number.isFinite(id)) threadByRootId.set(id, rootThread);
          continue;
        }
        const line = Number(comment.line ?? comment.original_line ?? NaN);
        const thread: ReviewThread = {
          path: String(comment.path ?? ""),
          line: Number.isFinite(line) ? line : null,
          diffHunk:
            typeof comment.diff_hunk === "string" ? comment.diff_hunk : "",
          comments: [entry],
        };
        if (Number.isFinite(id)) threadByRootId.set(id, thread);
      }
      const reviewThreads = [...new Set(threadByRootId.values())];

      return {
        activity: {
          comments: (view.comments ?? []).map((comment) => ({
            author: String(comment.author?.login ?? ""),
            body: typeof comment.body === "string" ? comment.body : "",
            createdAt: String(comment.createdAt ?? ""),
          })),
          reviews: (view.reviews ?? []).map((review) => ({
            author: String(review.author?.login ?? ""),
            state: String(review.state ?? ""),
            body: typeof review.body === "string" ? review.body : "",
            createdAt: String(review.submittedAt ?? ""),
          })),
          reviewThreads,
        },
      };
    },

    /** { repo, number } → changed files and bounded patches. */
    async getPullFiles({ repo, number }) {
      await requireRepoAccess(repo);
      const filesRaw = await gh(
        [
          "api",
          "--paginate",
          "--slurp",
          `repos/${repo}/pulls/${number}/files?per_page=100`,
        ],
        30_000,
      );
      interface GhPullFile {
        filename?: unknown;
        status?: unknown;
        additions?: unknown;
        deletions?: unknown;
        patch?: unknown;
      }
      const files = (parsePaginatedGhApi(filesRaw) as GhPullFile[]).map(
        (file) => {
          const patch = typeof file.patch === "string" ? file.patch : null;
          return {
            path: String(file.filename ?? ""),
            status: String(file.status ?? "modified"),
            additions: Number(file.additions ?? 0),
            deletions: Number(file.deletions ?? 0),
            // Very large patches stay on GitHub — the panel shows a link.
            patch: patch !== null && patch.length <= 20_000 ? patch : null,
          };
        },
      );

      return { files };
    },

    /** { repo, number, body } → add a PR conversation comment. */
    async commentPull({ repo, number, body }): Promise<{ ok: true }> {
      await requireRepoAccess(repo);
      await gh(["pr", "comment", String(number), "-R", repo, "--body", body]);
      return { ok: true };
    },

    /** { threadId } → the PR most relevant to a BB thread: the thread's own
        environment PR (the branch the agent pushed) first, else a PR this
        thread was spawned to review. Null when neither exists. */
    async pullForThread({ threadId }) {
      try {
        const thread = (await bb.sdk.threads.get({ threadId })) as unknown as {
          environmentId?: string | null;
        };
        if (thread?.environmentId) {
          const result = await bb.sdk.environments.pullRequest({
            environmentId: thread.environmentId,
          });
          const url =
            result.outcome === "available" ? result.pullRequest.url : null;
          const match =
            typeof url === "string"
              ? url.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/)
              : null;
          if (match !== null) {
            return { pull: { repo: match[1], number: Number(match[2]) } };
          }
        }
      } catch {
        // no environment / PR lookup failed — fall through to spawn links
      }
      const links = await listAllLinks();
      for (const [key, threadLinks] of Object.entries(links)) {
        const match = key.match(/^pr:([\w.-]+\/[\w.-]+)#(\d+)$/);
        if (match === null) continue;
        if (threadLinks.some((link) => link.threadId === threadId)) {
          return { pull: { repo: match[1], number: Number(match[2]) } };
        }
      }
      return { pull: null };
    },

    /** { repo, number, body } → add an issue comment. */
    async commentIssue({ repo, number, body }): Promise<{ ok: true }> {
      await requireRepoAccess(repo);
      await gh([
        "issue",
        "comment",
        String(number),
        "-R",
        repo,
        "--body",
        body,
      ]);
      return { ok: true };
    },

    /** { repo, title, body? } → create an issue, sync, return number+url. */
    async createIssue(input) {
      const { accountLogin } = await requireRepoAccess(input.repo);
      const body = input.body ?? "";
      const stdout = await gh([
        "issue",
        "create",
        "-R",
        input.repo,
        "--title",
        input.title,
        "--body",
        body,
      ]);
      const match = stdout.trim().match(/\/issues\/(\d+)\s*$/);
      const number = match !== null ? Number(match[1]) : null;
      try {
        replaceRepoRows(
          accountLogin,
          input.repo,
          await fetchRepoItems(gh, input.repo),
        );
        bb.realtime.publish("data-changed", {});
      } catch {
        // creation succeeded; the next scheduled sync will pick it up
      }
      return { number, url: stdout.trim() };
    },

    /** { repo, number } → spawn a worker thread on an issue. */
    async startWork({ repo, number }) {
      return await openConversation("issue", repo, number);
    },

    /** { repo, number } → spawn a review thread on a PR. */
    async startReview({ repo, number }) {
      return await openConversation("pr", repo, number);
    },

    /** () → every issue/PR → thread link, keyed "<kind>:<repo>#<number>". */
    async listLinks() {
      return { links: await listAllLinks() };
    },
  });

  // ------------------------------------------------------------------
  // Mentions: issues and PRs attach their details as agent context.
  // Search reads the cache (2s time box); resolve prefers a live gh view
  // and falls back to the cache so a network blip doesn't block the send.
  // ------------------------------------------------------------------
  function mentionItems(kind: "issue" | "pr", query: string) {
    if (verifiedCacheLogin === null) return [];
    return listCachedItems(verifiedCacheLogin, { kind, query, state: "open" })
      .slice(0, 8)
      .map((item) => ({
        id: `${item.repo}#${item.number}`,
        title: `#${item.number} ${item.title}`,
        subtitle: item.repo,
      }));
  }

  function parseMentionId(itemId: string): { repo: string; number: number } {
    const match = itemId.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
    if (match === null) throw new Error(`malformed mention id "${itemId}"`);
    return { repo: match[1], number: Number(match[2]) };
  }

  async function mentionContext(
    kind: "issue" | "pr",
    itemId: string,
  ): Promise<{ context: string }> {
    const { repo, number } = parseMentionId(itemId);
    const { accountLogin } = await requireRepoAccess(repo);
    const noun = kind === "pr" ? "pull request" : "issue";
    try {
      const raw = await gh(
        kind === "pr"
          ? [
              "pr",
              "view",
              String(number),
              "-R",
              repo,
              "--json",
              "number,title,body,state,author,url",
            ]
          : [
              "issue",
              "view",
              String(number),
              "-R",
              repo,
              "--json",
              "number,title,body,state,author,url",
            ],
        15_000,
      );
      const detail = JSON.parse(raw) as GhListEntry;
      return {
        context: [
          `# GitHub ${noun} ${repo}#${number}: ${String(detail.title ?? "")}`,
          "",
          `State: ${String(detail.state ?? "")} · Author: ${String(detail.author?.login ?? "")}`,
          `URL: ${String(detail.url ?? "")}`,
          "",
          typeof detail.body === "string" && detail.body.length > 0
            ? detail.body
            : "(no description)",
          "",
          `For full comments/diff run: gh ${kind === "pr" ? "pr" : "issue"} view ${number} -R ${repo} --comments`,
        ].join("\n"),
      };
    } catch (error) {
      const cached = getCachedItem(accountLogin, kind, repo, number);
      if (cached === null)
        throw error instanceof Error ? error : new Error(String(error));
      return {
        context: [
          `# GitHub ${noun} ${repo}#${number}: ${cached.title}`,
          "",
          `State: ${cached.state} · Author: ${cached.author}`,
          `URL: ${cached.url}`,
          "",
          cached.body.length > 0 ? cached.body : "(no description)",
        ].join("\n"),
      };
    }
  }

  bb.ui.registerMentionProvider({
    id: "issue",
    label: "GitHub issues",
    triggers: ["@", "#"],
    search({ query }) {
      return mentionItems("issue", query);
    },
    resolve(itemId) {
      return mentionContext("issue", itemId);
    },
  });

  bb.ui.registerMentionProvider({
    id: "pr",
    label: "GitHub pull requests",
    triggers: ["@", "#"],
    search({ query }) {
      return mentionItems("pr", query);
    },
    resolve(itemId) {
      return mentionContext("pr", itemId);
    },
  });

  // ------------------------------------------------------------------
  // CLI: `bb github …` for agents and terminals.
  // ------------------------------------------------------------------
  const USAGE = [
    "Usage:",
    "  bb github repos              List tracked repositories",
    "  bb github issues [repo]      List cached open issues",
    "  bb github prs [repo]         List cached open pull requests",
    "  bb github sync               Refresh the cache from GitHub now",
  ].join("\n");

  bb.cli.register({
    name: "github",
    summary: "Browse tracked GitHub repos, issues, and PRs",
    commands: [
      {
        name: "repos",
        summary: "List tracked repositories",
        usage: "bb github repos",
      },
      {
        name: "issues",
        summary: "List cached open issues",
        usage: "bb github issues [owner/repo]",
      },
      {
        name: "prs",
        summary: "List cached open pull requests",
        usage: "bb github prs [owner/repo]",
      },
      {
        name: "sync",
        summary: "Refresh the cache from GitHub now",
        usage: "bb github sync",
      },
    ],
    async run(argv) {
      const [sub, arg] = argv;
      try {
        const validationError = validateGithubCliArgs(argv);
        if (validationError !== null) {
          return { exitCode: 1, stderr: `${validationError}\n${USAGE}` };
        }
        if (sub === undefined || sub === "help" || sub === "--help") {
          return { exitCode: 0, stdout: USAGE };
        }
        if (sub === "repos") {
          const accountLogin = await ensureCacheAccount(true);
          const repos = publicRepos(await discoverRepos(true), accountLogin);
          if (repos.length === 0) {
            return {
              exitCode: 0,
              stdout: "No tracked repos. Add a project with a GitHub remote.",
            };
          }
          return {
            exitCode: 0,
            stdout: repos
              .map(
                (entry) =>
                  `${entry.repo}\t(${entry.projectId})${entry.available ? "" : `\t(unavailable: ${entry.unavailableReason})`}`,
              )
              .join("\n"),
          };
        }
        if (sub === "issues" || sub === "prs") {
          const accountLogin = await ensureCacheAccount(true);
          const items = listCachedItems(accountLogin, {
            kind: sub === "prs" ? "pr" : "issue",
            repo: isRepoName(arg) ? arg : undefined,
            state: "open",
          });
          if (items.length === 0) {
            return {
              exitCode: 0,
              stdout: "Nothing cached. Run `bb github sync` first.",
            };
          }
          return {
            exitCode: 0,
            stdout: items
              .map(
                (item) =>
                  `${item.repo}#${item.number}\t[${item.state}]\t${item.title}`,
              )
              .join("\n"),
          };
        }
        if (sub === "sync") {
          const { repos, items } = await requestSync(true);
          return {
            exitCode: 0,
            stdout: `Synced ${items} item(s) across ${repos} repo(s).`,
          };
        }
        return {
          exitCode: 1,
          stderr: `Unknown subcommand "${sub}".\n${USAGE}`,
        };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
