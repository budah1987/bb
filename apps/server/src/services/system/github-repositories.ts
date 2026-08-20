import type {
  GithubAccountCatalog,
  GithubPullRequestCatalog,
  GithubRepositoryHealthRecord,
  GithubRepositoryHealthResult,
  GithubRepositoryActivityResult,
  GithubRepositoryCatalog,
} from "@bb/host-daemon-contract";
import type {
  SystemGithubAccountsQuery,
  SystemGithubPullRequestsQuery,
  SystemGithubRepositoryHealthQuery,
  SystemGithubRepositoryActivityQuery,
  SystemGithubRepositoriesQuery,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  assertUsableHostId,
  requirePrimaryHostId,
} from "../hosts/primary-host.js";

const GITHUB_HEALTH_TTL_MS = 60_000;

interface CachedGithubRepositoryHealth {
  record: GithubRepositoryHealthRecord;
  expiresAt: number;
  rateLimit: { remaining: number | null; resetAt: string | null };
}

const repositoryHealthCaches = new WeakMap<
  AppDeps,
  Map<string, CachedGithubRepositoryHealth>
>();

function healthCacheFor(
  deps: AppDeps,
): Map<string, CachedGithubRepositoryHealth> {
  const existing = repositoryHealthCaches.get(deps);
  if (existing) return existing;
  const created = new Map<string, CachedGithubRepositoryHealth>();
  repositoryHealthCaches.set(deps, created);
  return created;
}

function healthCacheKey(args: {
  hostId: string;
  githubHost: string;
  login: string;
  repository: string;
}): string {
  return [
    args.hostId,
    args.githubHost.toLocaleLowerCase(),
    args.login.toLocaleLowerCase(),
    args.repository.toLocaleLowerCase(),
  ].join("\n");
}

export function invalidateGithubRepositoryHealthCache(
  deps: AppDeps,
  args: {
    githubHost?: string;
    hostId: string;
    login?: string | null;
    repository: string;
  },
): void {
  const cache = healthCacheFor(deps);
  const githubHost = (args.githubHost ?? "github.com").toLocaleLowerCase();
  const login = args.login?.toLocaleLowerCase() ?? null;
  const repository = args.repository.toLocaleLowerCase();
  for (const key of cache.keys()) {
    const [cachedHostId, cachedGithubHost, cachedLogin, cachedRepository] =
      key.split("\n");
    if (
      cachedHostId === args.hostId &&
      cachedGithubHost === githubHost &&
      cachedRepository === repository &&
      (login === null || cachedLogin === login)
    ) {
      cache.delete(key);
    }
  }
}

/** Reads authenticated account identities without moving credentials off-host. */
export async function getGithubAccounts(
  deps: AppDeps,
  query: SystemGithubAccountsQuery,
): Promise<GithubAccountCatalog> {
  const hostId = query.hostId ?? requirePrimaryHostId(deps);
  assertUsableHostId(deps, { hostId });
  return callHostRetryableOnlineRpc(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "github.account_catalog" },
  });
}

/**
 * Reads GitHub accounts and the union of their repositories from one machine.
 * Credentials never cross the daemon boundary; this result contains logins
 * and repository metadata only.
 */
export async function getGithubRepositories(
  deps: AppDeps,
  query: SystemGithubRepositoriesQuery,
): Promise<GithubRepositoryCatalog> {
  const hostId = query.hostId ?? requirePrimaryHostId(deps);
  assertUsableHostId(deps, { hostId });
  return callHostRetryableOnlineRpc(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "github.repository_catalog" },
  });
}

export async function getGithubPullRequests(
  deps: AppDeps,
  query: SystemGithubPullRequestsQuery,
): Promise<GithubPullRequestCatalog> {
  const hostId = query.hostId ?? requirePrimaryHostId(deps);
  assertUsableHostId(deps, { hostId });
  return callHostRetryableOnlineRpc(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "github.pull_request_catalog",
      repository: query.repository,
      githubAccountLogin: query.githubAccountLogin,
    },
  });
}

/**
 * Returns a bounded native GitHub health projection. `cached` is a hard
 * no-I/O mode used by persistent navigation; only `allow-fetch` may call the
 * owning host daemon.
 */
export async function getGithubRepositoryHealth(
  deps: AppDeps,
  query: SystemGithubRepositoryHealthQuery,
): Promise<GithubRepositoryHealthResult> {
  const hostId = query.hostId ?? requirePrimaryHostId(deps);
  assertUsableHostId(deps, { hostId });
  const repositories = query.repositories.split(",");
  const cache = healthCacheFor(deps);
  const entries = repositories.flatMap((repository) => {
    const cached = cache.get(
      healthCacheKey({
        hostId,
        githubHost: query.githubHost,
        login: query.githubAccountLogin,
        repository,
      }),
    );
    return cached ? [cached] : [];
  });
  const now = Date.now();
  const allPresent = entries.length === repositories.length;
  const allFresh =
    allPresent && entries.every((entry) => entry.expiresAt > now);
  if (query.refresh === "cached" || allFresh) {
    if (entries.length === 0) {
      return {
        outcome: "unavailable",
        host: query.githubHost,
        login: query.githubAccountLogin,
        message: "Repository health has not been loaded yet.",
      };
    }
    const fetchedAt = entries.reduce(
      (latest, entry) =>
        entry.record.fetchedAt > latest ? entry.record.fetchedAt : latest,
      entries[0]?.record.fetchedAt ?? new Date(0).toISOString(),
    );
    return {
      outcome: "available",
      host: query.githubHost,
      login: query.githubAccountLogin,
      repositories: entries.map((entry) => entry.record),
      fetchedAt,
      rateLimit: entries[0]?.rateLimit ?? {
        remaining: null,
        resetAt: null,
      },
    };
  }

  const result = await callHostRetryableOnlineRpc(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "github.repository_health",
      githubHost: query.githubHost,
      githubAccountLogin: query.githubAccountLogin,
      repositories,
    },
  });
  if (result.outcome === "available") {
    const expiresAt = now + GITHUB_HEALTH_TTL_MS;
    for (const record of result.repositories) {
      cache.set(
        healthCacheKey({
          hostId,
          githubHost: result.host,
          login: result.login,
          repository: record.nameWithOwner,
        }),
        { record, expiresAt, rateLimit: result.rateLimit },
      );
    }
  }
  return result;
}

/** On-demand repository coordination; never called by persistent navigation. */
export async function getGithubRepositoryActivity(
  deps: AppDeps,
  query: SystemGithubRepositoryActivityQuery,
): Promise<GithubRepositoryActivityResult> {
  const hostId = query.hostId ?? requirePrimaryHostId(deps);
  assertUsableHostId(deps, { hostId });
  return callHostRetryableOnlineRpc(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "github.repository_activity",
      githubHost: query.githubHost,
      githubAccountLogin: query.githubAccountLogin,
      repository: query.repository,
    },
  });
}
