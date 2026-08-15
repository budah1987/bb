import { execFile } from "node:child_process";
import type {
  GithubAccount,
  GithubAccountCatalog,
  GithubPullRequest,
  GithubPullRequestCatalog,
  GithubRepository,
  GithubRepositoryCatalog,
} from "@bb/host-daemon-contract";

const GITHUB_HOST = "github.com";
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

const REPOSITORY_QUERY = `
  query($endCursor: String) {
    viewer {
      repositories(
        first: 100
        after: $endCursor
        affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        nodes {
          name
          nameWithOwner
          url
          isPrivate
          updatedAt
          owner { login }
          defaultBranchRef { name }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

interface CommandResult {
  stdout: string;
  stderr: string;
}

export type GithubCommandRunner = (
  file: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<CommandResult>;

interface GithubAuthStatusRow {
  active?: unknown;
  host?: unknown;
  login?: unknown;
  state?: unknown;
}

interface GithubAuthStatusPayload {
  hosts?: unknown;
}

interface GithubRepositoryNode {
  defaultBranchRef?: unknown;
  isPrivate?: unknown;
  name?: unknown;
  nameWithOwner?: unknown;
  owner?: unknown;
  updatedAt?: unknown;
  url?: unknown;
}

interface GithubPullRequestRow {
  author?: unknown;
  baseRefName?: unknown;
  headRefName?: unknown;
  headRepository?: unknown;
  isDraft?: unknown;
  number?: unknown;
  title?: unknown;
  updatedAt?: unknown;
  url?: unknown;
}

interface RepositoryAccumulator {
  repository: Omit<GithubRepository, "accessibleBy" | "activeAccount">;
  accountLogins: Set<string>;
}

function runCommand(
  file: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        env: options.env,
        timeout: options.timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr });
          return;
        }
        reject(
          new Error(
            `${file} ${args.slice(0, 3).join(" ")} failed: ${stderr.trim() || error.message}`,
          ),
        );
      },
    );
  });
}

function parseAccounts(raw: string): GithubAccount[] {
  const parsed = JSON.parse(raw) as GithubAuthStatusPayload;
  if (
    typeof parsed.hosts !== "object" ||
    parsed.hosts === null ||
    Array.isArray(parsed.hosts)
  ) {
    throw new Error("GitHub CLI returned malformed authentication status");
  }
  const rows = (parsed.hosts as Record<string, unknown>)[GITHUB_HOST];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value): GithubAccount[] => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [];
    }
    const row = value as GithubAuthStatusRow;
    if (
      row.state !== "success" ||
      typeof row.host !== "string" ||
      typeof row.login !== "string" ||
      typeof row.active !== "boolean"
    ) {
      return [];
    }
    return [{ host: row.host, login: row.login, active: row.active }];
  });
}

async function listGithubAccounts(args: {
  env: NodeJS.ProcessEnv;
  ghPath: string;
  run: GithubCommandRunner;
}): Promise<GithubAccount[]> {
  const status = await args.run(
    args.ghPath,
    ["auth", "status", "--json", "hosts"],
    { env: args.env, timeoutMs: COMMAND_TIMEOUT_MS },
  );
  return parseAccounts(status.stdout);
}

export async function getGithubAccountCatalog(args: {
  env: NodeJS.ProcessEnv;
  ghPath?: string;
  run?: GithubCommandRunner;
}): Promise<GithubAccountCatalog> {
  const accounts = await listGithubAccounts({
    env: args.env,
    ghPath: args.ghPath ?? "gh",
    run: args.run ?? runCommand,
  });
  if (accounts.length === 0) {
    throw new Error(
      "No authenticated github.com account was found. Run `gh auth login` first.",
    );
  }
  return { accounts };
}

export async function getGithubAccountEnvironment(args: {
  env: NodeJS.ProcessEnv;
  login: string | null;
  ghPath?: string;
  run?: GithubCommandRunner;
}): Promise<NodeJS.ProcessEnv | undefined> {
  if (args.login === null) return undefined;
  const account: GithubAccount = {
    active: false,
    host: GITHUB_HOST,
    login: args.login,
  };
  const token = await tokenForAccount({
    account,
    env: args.env,
    ghPath: args.ghPath ?? "gh",
    run: args.run ?? runCommand,
  });
  return { GH_HOST: account.host, GH_TOKEN: token };
}

function optionalNestedString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "string" && nested.length > 0 ? nested : null;
}

function parseRepositoryNode(
  value: unknown,
): Omit<GithubRepository, "accessibleBy" | "activeAccount"> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const node = value as GithubRepositoryNode;
  const owner = optionalNestedString(node.owner, "login");
  if (
    typeof node.name !== "string" ||
    typeof node.nameWithOwner !== "string" ||
    typeof node.url !== "string" ||
    typeof node.isPrivate !== "boolean" ||
    typeof node.updatedAt !== "string" ||
    owner === null
  ) {
    return null;
  }
  return {
    name: node.name,
    nameWithOwner: node.nameWithOwner,
    owner,
    url: node.url,
    isPrivate: node.isPrivate,
    defaultBranch: optionalNestedString(node.defaultBranchRef, "name"),
    updatedAt: node.updatedAt,
  };
}

function parseRepositoryPages(
  raw: string,
): Array<Omit<GithubRepository, "accessibleBy" | "activeAccount">> {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("GitHub CLI returned malformed repository pages");
  }
  const repositories: Array<
    Omit<GithubRepository, "accessibleBy" | "activeAccount">
  > = [];
  for (const page of parsed) {
    if (typeof page !== "object" || page === null || Array.isArray(page)) {
      continue;
    }
    const data = (page as Record<string, unknown>).data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      continue;
    }
    const viewer = (data as Record<string, unknown>).viewer;
    if (
      typeof viewer !== "object" ||
      viewer === null ||
      Array.isArray(viewer)
    ) {
      continue;
    }
    const connection = (viewer as Record<string, unknown>).repositories;
    if (
      typeof connection !== "object" ||
      connection === null ||
      Array.isArray(connection)
    ) {
      continue;
    }
    const nodes = (connection as Record<string, unknown>).nodes;
    if (!Array.isArray(nodes)) continue;
    for (const node of nodes) {
      const repository = parseRepositoryNode(node);
      if (repository) repositories.push(repository);
    }
  }
  return repositories;
}

async function repositoriesForAccount(args: {
  account: GithubAccount;
  env: NodeJS.ProcessEnv;
  ghPath: string;
  run: GithubCommandRunner;
}): Promise<Array<Omit<GithubRepository, "accessibleBy" | "activeAccount">>> {
  const token = await tokenForAccount(args);
  const result = await args.run(
    args.ghPath,
    [
      "api",
      "graphql",
      "--paginate",
      "--slurp",
      "-f",
      `query=${REPOSITORY_QUERY}`,
    ],
    {
      env: {
        ...args.env,
        GH_HOST: args.account.host,
        GH_TOKEN: token,
      },
      timeoutMs: COMMAND_TIMEOUT_MS,
    },
  );
  return parseRepositoryPages(result.stdout);
}

async function tokenForAccount(args: {
  account: GithubAccount;
  env: NodeJS.ProcessEnv;
  ghPath: string;
  run: GithubCommandRunner;
}): Promise<string> {
  const tokenResult = await args.run(
    args.ghPath,
    [
      "auth",
      "token",
      "--hostname",
      args.account.host,
      "--user",
      args.account.login,
    ],
    { env: args.env, timeoutMs: COMMAND_TIMEOUT_MS },
  );
  const token = tokenResult.stdout.trim();
  if (!token) {
    throw new Error(`GitHub CLI returned no token for @${args.account.login}`);
  }
  return token;
}

function parsePullRequests(raw: string): GithubPullRequest[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("GitHub CLI returned malformed pull requests");
  }
  return parsed.flatMap((value): GithubPullRequest[] => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [];
    }
    const row = value as GithubPullRequestRow;
    const author = optionalNestedString(row.author, "login");
    const headRepository = optionalNestedString(
      row.headRepository,
      "nameWithOwner",
    );
    if (
      typeof row.number !== "number" ||
      !Number.isInteger(row.number) ||
      row.number <= 0 ||
      typeof row.title !== "string" ||
      row.title.length === 0 ||
      typeof row.url !== "string" ||
      typeof row.isDraft !== "boolean" ||
      typeof row.headRefName !== "string" ||
      row.headRefName.length === 0 ||
      headRepository === null ||
      typeof row.baseRefName !== "string" ||
      row.baseRefName.length === 0 ||
      author === null ||
      typeof row.updatedAt !== "string"
    ) {
      return [];
    }
    return [
      {
        number: row.number,
        title: row.title,
        url: row.url,
        isDraft: row.isDraft,
        headBranch: row.headRefName,
        headRepository,
        baseBranch: row.baseRefName,
        author,
        updatedAt: row.updatedAt,
      },
    ];
  });
}

export async function getGithubPullRequestCatalog(args: {
  env: NodeJS.ProcessEnv;
  repository: string;
  githubAccountLogin: string;
  ghPath?: string;
  run?: GithubCommandRunner;
}): Promise<GithubPullRequestCatalog> {
  const run = args.run ?? runCommand;
  const ghPath = args.ghPath ?? "gh";
  const accounts = await listGithubAccounts({ env: args.env, ghPath, run });
  const account = accounts.find(
    (candidate) =>
      candidate.login.toLocaleLowerCase() ===
      args.githubAccountLogin.toLocaleLowerCase(),
  );
  if (!account) {
    throw new Error(
      `GitHub account @${args.githubAccountLogin} is not authenticated on this machine. Run \`gh auth login\` for that account first.`,
    );
  }
  const token = await tokenForAccount({ account, env: args.env, ghPath, run });
  const result = await run(
    ghPath,
    [
      "pr",
      "list",
      "--repo",
      args.repository,
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,url,isDraft,headRefName,headRepository,baseRefName,author,updatedAt",
    ],
    {
      env: {
        ...args.env,
        GH_HOST: account.host,
        GH_TOKEN: token,
      },
      timeoutMs: COMMAND_TIMEOUT_MS,
    },
  );
  return {
    repository: args.repository,
    account: account.login,
    pullRequests: parsePullRequests(result.stdout),
  };
}

export async function getGithubRepositoryCatalog(args: {
  env: NodeJS.ProcessEnv;
  ghPath?: string;
  run?: GithubCommandRunner;
}): Promise<GithubRepositoryCatalog> {
  const run = args.run ?? runCommand;
  const ghPath = args.ghPath ?? "gh";
  const accounts = await listGithubAccounts({ env: args.env, ghPath, run });
  if (accounts.length === 0) {
    throw new Error(
      "No authenticated github.com account was found. Run `gh auth login` first.",
    );
  }

  const accountRepositories = await Promise.all(
    accounts.map(async (account) => ({
      account,
      repositories: await repositoriesForAccount({
        account,
        env: args.env,
        ghPath,
        run,
      }),
    })),
  );
  const byRepository = new Map<string, RepositoryAccumulator>();
  for (const { account, repositories } of accountRepositories) {
    for (const repository of repositories) {
      const key = repository.nameWithOwner.toLocaleLowerCase();
      const existing = byRepository.get(key);
      if (existing) {
        existing.accountLogins.add(account.login);
      } else {
        byRepository.set(key, {
          repository,
          accountLogins: new Set([account.login]),
        });
      }
    }
  }

  const activeLogin = accounts.find((account) => account.active)?.login ?? null;
  const repositories = [...byRepository.values()]
    .map(({ repository, accountLogins }): GithubRepository => {
      const accessibleBy = accounts
        .map((account) => account.login)
        .filter((login) => accountLogins.has(login));
      return {
        ...repository,
        accessibleBy,
        activeAccount:
          activeLogin !== null && accountLogins.has(activeLogin)
            ? activeLogin
            : null,
      };
    })
    .sort((left, right) => {
      const updatedDelta =
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      return updatedDelta !== 0
        ? updatedDelta
        : left.nameWithOwner.localeCompare(right.nameWithOwner);
    });

  return {
    accounts,
    repositories,
    scope: accounts.length > 1 ? "union" : "account",
  };
}
