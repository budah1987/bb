import type {
  GithubAccount,
  GithubAccountCatalog,
  GithubPullRequest,
  GithubPullRequestCatalog,
  GithubRepository,
  GithubRepositoryCatalog,
} from "@bb/host-daemon-contract";
import {
  createGithubApiClient,
  defaultGithubApiClient,
  type GithubApiClient,
  type GithubCommandRunner,
  type GithubFetch,
} from "./github-api.js";

const GITHUB_HOST = "github.com";

function githubDotComAccounts(
  accounts: readonly GithubAccount[],
): readonly GithubAccount[] {
  return accounts.filter(
    (account) => account.host.toLocaleLowerCase() === GITHUB_HOST,
  );
}

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

interface GithubRepositoryNode {
  defaultBranchRef?: unknown;
  isPrivate?: unknown;
  name?: unknown;
  nameWithOwner?: unknown;
  owner?: unknown;
  updatedAt?: unknown;
  url?: unknown;
}

interface GithubRestPullRequestRow {
  base?: unknown;
  draft?: unknown;
  head?: unknown;
  html_url?: unknown;
  number?: unknown;
  title?: unknown;
  updated_at?: unknown;
  user?: unknown;
}

interface RepositoryAccumulator {
  repository: Omit<GithubRepository, "accessibleBy" | "activeAccount">;
  accountLogins: Set<string>;
}

export type { GithubCommandRunner } from "./github-api.js";

function resolveClient(args: {
  client?: GithubApiClient;
  fetch?: GithubFetch;
  run?: GithubCommandRunner;
}): GithubApiClient {
  if (args.client) return args.client;
  if (args.fetch || args.run) {
    return createGithubApiClient({
      ...(args.fetch === undefined ? {} : { fetch: args.fetch }),
      ...(args.run === undefined ? {} : { run: args.run }),
    });
  }
  return defaultGithubApiClient;
}

export async function getGithubAccountCatalog(args: {
  client?: GithubApiClient;
  env: NodeJS.ProcessEnv;
  fetch?: GithubFetch;
  ghPath?: string;
  run?: GithubCommandRunner;
}): Promise<GithubAccountCatalog> {
  const client = resolveClient(args);
  const accounts = githubDotComAccounts(
    await client.accounts({
      env: args.env,
      forceRefresh: true,
      ...(args.ghPath === undefined ? {} : { ghPath: args.ghPath }),
    }),
  );
  if (accounts.length === 0) {
    throw new Error(
      "No authenticated github.com account was found. Run `gh auth login` first.",
    );
  }
  return { accounts: [...accounts] };
}

export async function getGithubAccountEnvironment(args: {
  client?: GithubApiClient;
  env: NodeJS.ProcessEnv;
  fetch?: GithubFetch;
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
  const token = await resolveClient(args).token({
    account,
    env: args.env,
    ...(args.ghPath === undefined ? {} : { ghPath: args.ghPath }),
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

function parseRepositoryPage(value: unknown): {
  endCursor: string | null;
  hasNextPage: boolean;
  repositories: Array<Omit<GithubRepository, "accessibleBy" | "activeAccount">>;
} {
  const repositories: Array<
    Omit<GithubRepository, "accessibleBy" | "activeAccount">
  > = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("GitHub returned a malformed repository page");
  }
  const data = (value as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("GitHub returned a malformed repository page");
  }
  const viewer = (data as Record<string, unknown>).viewer;
  if (typeof viewer !== "object" || viewer === null || Array.isArray(viewer)) {
    throw new Error("GitHub returned a malformed repository viewer");
  }
  const connection = (viewer as Record<string, unknown>).repositories;
  if (
    typeof connection !== "object" ||
    connection === null ||
    Array.isArray(connection)
  ) {
    throw new Error("GitHub returned a malformed repository connection");
  }
  const connectionRecord = connection as Record<string, unknown>;
  if (!Array.isArray(connectionRecord.nodes)) {
    throw new Error("GitHub returned malformed repository nodes");
  }
  for (const node of connectionRecord.nodes) {
    const repository = parseRepositoryNode(node);
    if (repository) repositories.push(repository);
  }
  const pageInfo = connectionRecord.pageInfo;
  if (
    typeof pageInfo !== "object" ||
    pageInfo === null ||
    Array.isArray(pageInfo)
  ) {
    throw new Error("GitHub returned malformed repository pagination");
  }
  const pageInfoRecord = pageInfo as Record<string, unknown>;
  if (typeof pageInfoRecord.hasNextPage !== "boolean") {
    throw new Error("GitHub returned malformed repository pagination");
  }
  const endCursor =
    typeof pageInfoRecord.endCursor === "string"
      ? pageInfoRecord.endCursor
      : null;
  if (pageInfoRecord.hasNextPage && endCursor === null) {
    throw new Error("GitHub returned no cursor for the next repository page");
  }
  return {
    repositories,
    hasNextPage: pageInfoRecord.hasNextPage,
    endCursor,
  };
}

async function repositoriesForAccount(args: {
  account: GithubAccount;
  client: GithubApiClient;
  env: NodeJS.ProcessEnv;
  ghPath?: string;
  signal?: AbortSignal;
}): Promise<Array<Omit<GithubRepository, "accessibleBy" | "activeAccount">>> {
  const repositories: Array<
    Omit<GithubRepository, "accessibleBy" | "activeAccount">
  > = [];
  let endCursor: string | null = null;
  do {
    const payload = await args.client.graphql({
      account: args.account,
      env: args.env,
      query: REPOSITORY_QUERY,
      variables: { endCursor },
      ...(args.ghPath === undefined ? {} : { ghPath: args.ghPath }),
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    });
    const page = parseRepositoryPage(payload);
    repositories.push(...page.repositories);
    endCursor = page.hasNextPage ? page.endCursor : null;
  } while (endCursor !== null);
  return repositories;
}

function parsePullRequests(value: unknown): GithubPullRequest[] {
  if (!Array.isArray(value)) {
    throw new Error("GitHub returned malformed pull requests");
  }
  return value.flatMap((item): GithubPullRequest[] => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return [];
    }
    const row = item as GithubRestPullRequestRow;
    const author = optionalNestedString(row.user, "login");
    const headBranch = optionalNestedString(row.head, "ref");
    const headRepository =
      typeof row.head === "object" &&
      row.head !== null &&
      !Array.isArray(row.head)
        ? optionalNestedString(
            (row.head as Record<string, unknown>).repo,
            "full_name",
          )
        : null;
    const baseBranch = optionalNestedString(row.base, "ref");
    if (
      typeof row.number !== "number" ||
      !Number.isInteger(row.number) ||
      row.number <= 0 ||
      typeof row.title !== "string" ||
      row.title.length === 0 ||
      typeof row.html_url !== "string" ||
      typeof row.draft !== "boolean" ||
      headBranch === null ||
      headRepository === null ||
      baseBranch === null ||
      author === null ||
      typeof row.updated_at !== "string"
    ) {
      return [];
    }
    return [
      {
        number: row.number,
        title: row.title,
        url: row.html_url,
        isDraft: row.draft,
        headBranch,
        headRepository,
        baseBranch,
        author,
        updatedAt: row.updated_at,
      },
    ];
  });
}

export async function getGithubPullRequestCatalog(args: {
  client?: GithubApiClient;
  env: NodeJS.ProcessEnv;
  fetch?: GithubFetch;
  repository: string;
  githubAccountLogin: string;
  ghPath?: string;
  run?: GithubCommandRunner;
  signal?: AbortSignal;
}): Promise<GithubPullRequestCatalog> {
  const account: GithubAccount = {
    active: false,
    host: GITHUB_HOST,
    login: args.githubAccountLogin,
  };
  const [owner, repository] = args.repository.split("/");
  if (!owner || !repository || args.repository.split("/").length !== 2) {
    throw new Error(`Invalid GitHub repository: ${args.repository}`);
  }
  const client = resolveClient(args);
  try {
    await client.token({
      account,
      env: args.env,
      ...(args.ghPath === undefined ? {} : { ghPath: args.ghPath }),
    });
  } catch (error) {
    throw new Error(
      `GitHub account @${args.githubAccountLogin} is not authenticated on this machine. Run \`gh auth login\` for that account first.`,
      { cause: error },
    );
  }
  const payload = await client.requestJson({
    account,
    env: args.env,
    path: `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls?state=open&per_page=100`,
    ...(args.ghPath === undefined ? {} : { ghPath: args.ghPath }),
    ...(args.signal === undefined ? {} : { signal: args.signal }),
  });
  return {
    repository: args.repository,
    account: account.login,
    pullRequests: parsePullRequests(payload),
  };
}

export async function getGithubRepositoryCatalog(args: {
  client?: GithubApiClient;
  env: NodeJS.ProcessEnv;
  fetch?: GithubFetch;
  ghPath?: string;
  run?: GithubCommandRunner;
  signal?: AbortSignal;
}): Promise<GithubRepositoryCatalog> {
  const client = resolveClient(args);
  const accounts = githubDotComAccounts(
    await client.accounts({
      env: args.env,
      ...(args.ghPath === undefined ? {} : { ghPath: args.ghPath }),
    }),
  );
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
        client,
        env: args.env,
        ...(args.ghPath === undefined ? {} : { ghPath: args.ghPath }),
        ...(args.signal === undefined ? {} : { signal: args.signal }),
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
    accounts: [...accounts],
    repositories,
    scope: accounts.length > 1 ? "union" : "account",
  };
}
