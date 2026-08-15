import type {
  GithubAccountCatalog,
  GithubPullRequestCatalog,
  GithubRepositoryCatalog,
} from "@bb/host-daemon-contract";
import type {
  SystemGithubAccountsQuery,
  SystemGithubPullRequestsQuery,
  SystemGithubRepositoriesQuery,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  assertUsableHostId,
  requirePrimaryHostId,
} from "../hosts/primary-host.js";

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
