import { execFile } from "node:child_process";
import type { GithubAccount } from "@bb/host-daemon-contract";

const COMMAND_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const TOKEN_TTL_MS = 10 * 60_000;
const ACCOUNT_TTL_MS = 60_000;
const DEFAULT_MAX_CONCURRENCY = 4;

interface CommandResult {
  stdout: string;
  stderr: string;
}

export type GithubCommandRunner = (
  file: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<CommandResult>;

export type GithubFetch = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

interface GithubAuthStatusRow {
  active?: unknown;
  host?: unknown;
  login?: unknown;
  state?: unknown;
}

interface GithubAuthStatusPayload {
  hosts?: unknown;
}

interface CachedToken {
  expiresAt: number;
  token: string;
}

interface CachedAccounts {
  accounts: readonly GithubAccount[];
  expiresAt: number;
}

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAt: string | null,
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

function defaultRunCommand(
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
  const accounts: GithubAccount[] = [];
  for (const rows of Object.values(parsed.hosts as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    for (const value of rows) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        continue;
      }
      const row = value as GithubAuthStatusRow;
      if (
        row.state === "success" &&
        typeof row.host === "string" &&
        typeof row.login === "string" &&
        typeof row.active === "boolean"
      ) {
        accounts.push({
          active: row.active,
          host: row.host,
          login: row.login,
        });
      }
    }
  }
  return accounts;
}

function accountKey(account: Pick<GithubAccount, "host" | "login">): string {
  return `${account.host}\n${account.login.toLocaleLowerCase()}`;
}

function githubApiBaseUrl(host: string): string {
  return host === "github.com"
    ? "https://api.github.com"
    : `https://${host}/api/v3`;
}

function githubGraphqlUrl(host: string): string {
  return host === "github.com"
    ? "https://api.github.com/graphql"
    : `https://${host}/api/graphql`;
}

function retryAtFromResponse(
  response: Response,
  now: () => number,
): string | null {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds)) {
      return new Date(now() + seconds * 1_000).toISOString();
    }
  }
  const reset = response.headers.get("x-ratelimit-reset");
  if (reset !== null) {
    const epochSeconds = Number.parseInt(reset, 10);
    if (Number.isFinite(epochSeconds)) {
      return new Date(epochSeconds * 1_000).toISOString();
    }
  }
  return null;
}

export interface GithubApiClient {
  accounts(args: {
    env: NodeJS.ProcessEnv;
    forceRefresh?: boolean;
    ghPath?: string;
  }): Promise<readonly GithubAccount[]>;
  graphql(args: {
    account: Pick<GithubAccount, "host" | "login">;
    env: NodeJS.ProcessEnv;
    ghPath?: string;
    query: string;
    signal?: AbortSignal;
    variables?: Readonly<Record<string, string | number | boolean | null>>;
  }): Promise<unknown>;
  requestJson(args: {
    account: Pick<GithubAccount, "host" | "login">;
    env: NodeJS.ProcessEnv;
    ghPath?: string;
    path: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
  token(args: {
    account: Pick<GithubAccount, "host" | "login">;
    env: NodeJS.ProcessEnv;
    forceRefresh?: boolean;
    ghPath?: string;
  }): Promise<string>;
}

export function createGithubApiClient(
  options: {
    fetch?: GithubFetch;
    maxConcurrency?: number;
    now?: () => number;
    run?: GithubCommandRunner;
    tokenTtlMs?: number;
  } = {},
): GithubApiClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const run = options.run ?? defaultRunCommand;
  const now = options.now ?? Date.now;
  const tokenTtlMs = options.tokenTtlMs ?? TOKEN_TTL_MS;
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const tokenCache = new Map<string, CachedToken>();
  const tokenInflight = new Map<string, Promise<string>>();
  const requestInflight = new Map<string, Promise<unknown>>();
  let accountCache: CachedAccounts | null = null;
  let accountInflight: Promise<readonly GithubAccount[]> | null = null;
  let activeRequests = 0;
  const requestWaiters: Array<() => void> = [];

  const acquireRequestSlot = async () => {
    if (activeRequests < maxConcurrency) {
      activeRequests += 1;
      return;
    }
    await new Promise<void>((resolve) => requestWaiters.push(resolve));
    activeRequests += 1;
  };

  const releaseRequestSlot = () => {
    activeRequests -= 1;
    requestWaiters.shift()?.();
  };

  const resolveToken = async (args: {
    account: Pick<GithubAccount, "host" | "login">;
    env: NodeJS.ProcessEnv;
    forceRefresh?: boolean;
    ghPath?: string;
  }): Promise<string> => {
    const key = accountKey(args.account);
    const cached = tokenCache.get(key);
    if (!args.forceRefresh && cached && cached.expiresAt > now()) {
      return cached.token;
    }
    const pending = tokenInflight.get(key);
    if (pending) return pending;

    const load = run(
      args.ghPath ?? "gh",
      [
        "auth",
        "token",
        "--hostname",
        args.account.host,
        "--user",
        args.account.login,
      ],
      { env: args.env, timeoutMs: COMMAND_TIMEOUT_MS },
    )
      .then((result) => {
        const token = result.stdout.trim();
        if (!token) {
          throw new Error(
            `GitHub CLI returned no token for @${args.account.login}`,
          );
        }
        tokenCache.set(key, { token, expiresAt: now() + tokenTtlMs });
        return token;
      })
      .finally(() => tokenInflight.delete(key));
    tokenInflight.set(key, load);
    return load;
  };

  const accounts = async (args: {
    env: NodeJS.ProcessEnv;
    forceRefresh?: boolean;
    ghPath?: string;
  }): Promise<readonly GithubAccount[]> => {
    if (
      !args.forceRefresh &&
      accountCache !== null &&
      accountCache.expiresAt > now()
    ) {
      return accountCache.accounts;
    }
    if (accountInflight !== null) return accountInflight;
    accountInflight = run(
      args.ghPath ?? "gh",
      ["auth", "status", "--json", "hosts"],
      { env: args.env, timeoutMs: COMMAND_TIMEOUT_MS },
    )
      .then((result) => {
        const nextAccounts = parseAccounts(result.stdout);
        const authenticatedKeys = new Set(nextAccounts.map(accountKey));
        for (const key of tokenCache.keys()) {
          if (!authenticatedKeys.has(key)) tokenCache.delete(key);
        }
        accountCache = {
          accounts: nextAccounts,
          expiresAt: now() + ACCOUNT_TTL_MS,
        };
        return nextAccounts;
      })
      .finally(() => {
        accountInflight = null;
      });
    return accountInflight;
  };

  interface RequestArgs {
    account: Pick<GithubAccount, "host" | "login">;
    body?: string;
    env: NodeJS.ProcessEnv;
    ghPath?: string;
    method: "GET" | "POST";
    signal?: AbortSignal;
    url: string;
  }

  const performRequest = async (args: RequestArgs): Promise<unknown> => {
    const execute = async (forceTokenRefresh: boolean): Promise<Response> => {
      const token = await resolveToken({
        account: args.account,
        env: args.env,
        forceRefresh: forceTokenRefresh,
        ...(args.ghPath === undefined ? {} : { ghPath: args.ghPath }),
      });
      await acquireRequestSlot();
      try {
        return await fetchImpl(args.url, {
          method: args.method,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          ...(args.body === undefined ? {} : { body: args.body }),
          ...(args.signal === undefined ? {} : { signal: args.signal }),
        });
      } finally {
        releaseRequestSlot();
      }
    };

    let response = await execute(false);
    if (response.status === 401) {
      tokenCache.delete(accountKey(args.account));
      response = await execute(true);
    }
    if (!response.ok) {
      const retryAt = retryAtFromResponse(response, now);
      throw new GithubApiError(
        response.status === 401
          ? `GitHub authentication failed for @${args.account.login}`
          : `GitHub API request failed with HTTP ${response.status}`,
        response.status,
        retryAt,
      );
    }
    return response.json() as Promise<unknown>;
  };

  const request = (args: RequestArgs): Promise<unknown> => {
    if (args.signal !== undefined) return performRequest(args);
    const key = [
      accountKey(args.account),
      args.method,
      args.url,
      args.body ?? "",
    ].join("\n");
    const pending = requestInflight.get(key);
    if (pending) return pending;
    const operation = performRequest(args).finally(() => {
      requestInflight.delete(key);
    });
    requestInflight.set(key, operation);
    return operation;
  };

  return {
    accounts,
    graphql: (args) =>
      request({
        account: args.account,
        body: JSON.stringify({
          query: args.query,
          variables: args.variables ?? {},
        }),
        env: args.env,
        method: "POST",
        url: githubGraphqlUrl(args.account.host),
        ...(args.ghPath === undefined ? {} : { ghPath: args.ghPath }),
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      }),
    requestJson: (args) =>
      request({
        account: args.account,
        env: args.env,
        method: "GET",
        url: new URL(args.path, `${githubApiBaseUrl(args.account.host)}/`).href,
        ...(args.ghPath === undefined ? {} : { ghPath: args.ghPath }),
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      }),
    token: resolveToken,
  };
}

export const defaultGithubApiClient = createGithubApiClient();
