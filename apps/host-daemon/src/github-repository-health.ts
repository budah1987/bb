import type {
  GithubRepositoryHealthRecord,
  GithubRepositoryHealthResult,
} from "@bb/host-daemon-contract";
import {
  defaultGithubApiClient,
  GithubApiError,
  type GithubApiClient,
} from "./github-api.js";

type JsonRecord = Record<string, unknown>;

const ATTENTION_PRIORITY = {
  none: 0,
  review_requested: 1,
  checks_pending: 2,
  changes_requested: 3,
  conflicts: 4,
  checks_failed: 5,
} as const;

type Attention = keyof typeof ATTENTION_PRIORITY;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function nestedRecord(value: unknown, key: string): JsonRecord | null {
  return record(record(value)?.[key]);
}

function statusState(
  value: unknown,
): GithubRepositoryHealthRecord["defaultBranchCheckState"] {
  const state = nestedRecord(value, "statusCheckRollup")?.state;
  if (state === "SUCCESS") return "passing";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  if (typeof state === "string") return "failing";
  return "none";
}

function attentionForPullRequest(value: unknown): Attention {
  const pullRequest = record(value);
  if (pullRequest === null) return "none";
  const commitNodes = nestedRecord(pullRequest, "commits")?.nodes;
  const commit = Array.isArray(commitNodes) ? commitNodes[0] : undefined;
  const checks = statusState(nestedRecord(commit, "commit"));
  if (checks === "failing") return "checks_failed";
  if (pullRequest.mergeable === "CONFLICTING") return "conflicts";
  if (pullRequest.reviewDecision === "CHANGES_REQUESTED") {
    return "changes_requested";
  }
  if (checks === "pending") return "checks_pending";
  if (pullRequest.reviewDecision === "REVIEW_REQUIRED") {
    return "review_requested";
  }
  return "none";
}

function worstAttention(values: unknown): Attention {
  if (!Array.isArray(values)) return "none";
  return values.reduce<Attention>((worst, value) => {
    const candidate = attentionForPullRequest(value);
    return ATTENTION_PRIORITY[candidate] > ATTENTION_PRIORITY[worst]
      ? candidate
      : worst;
  }, "none");
}

function buildHealthQuery(repositories: readonly string[]): {
  query: string;
  variables: Record<string, string>;
} {
  const variables: Record<string, string> = {};
  const declarations: string[] = [];
  const selections = repositories.map((nameWithOwner, index) => {
    const [owner, name] = nameWithOwner.split("/") as [string, string];
    variables[`owner${index}`] = owner;
    variables[`name${index}`] = name;
    declarations.push(`$owner${index}: String!`, `$name${index}: String!`);
    return `
      repository${index}: repository(owner: $owner${index}, name: $name${index}) {
        nameWithOwner
        defaultBranchRef {
          name
          target { ... on Commit { statusCheckRollup { state } } }
        }
        pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
          totalCount
          nodes {
            mergeable
            reviewDecision
            commits(last: 1) {
              nodes { commit { statusCheckRollup { state } } }
            }
          }
        }
      }`;
  });
  return {
    variables,
    query: `query RepositoryHealth(${declarations.join(", ")}) {
      ${selections.join("\n")}
      rateLimit { remaining resetAt }
    }`,
  };
}

function parseAvailable(args: {
  host: string;
  login: string;
  payload: unknown;
  requestedRepositories: readonly string[];
  fetchedAt: string;
}): GithubRepositoryHealthResult {
  const data = nestedRecord(args.payload, "data");
  if (data === null) throw new Error("GitHub returned malformed health data");
  const repositories = args.requestedRepositories.flatMap(
    (requested, index): GithubRepositoryHealthRecord[] => {
      const repository = record(data[`repository${index}`]);
      if (repository === null) return [];
      const defaultBranchRef = record(repository.defaultBranchRef);
      const pullRequests = record(repository.pullRequests);
      return [
        {
          nameWithOwner:
            typeof repository.nameWithOwner === "string"
              ? repository.nameWithOwner
              : requested,
          defaultBranch:
            typeof defaultBranchRef?.name === "string"
              ? defaultBranchRef.name
              : null,
          defaultBranchCheckState: statusState(defaultBranchRef?.target),
          openPullRequestCount:
            typeof pullRequests?.totalCount === "number"
              ? pullRequests.totalCount
              : 0,
          attention: worstAttention(pullRequests?.nodes),
          fetchedAt: args.fetchedAt,
        },
      ];
    },
  );
  const rateLimit = record(data.rateLimit);
  return {
    outcome: "available",
    host: args.host,
    login: args.login,
    repositories,
    fetchedAt: args.fetchedAt,
    rateLimit: {
      remaining:
        typeof rateLimit?.remaining === "number" ? rateLimit.remaining : null,
      resetAt:
        typeof rateLimit?.resetAt === "string" ? rateLimit.resetAt : null,
    },
  };
}

export async function getGithubRepositoryHealth(args: {
  client?: GithubApiClient;
  env: NodeJS.ProcessEnv;
  githubHost: string;
  githubAccountLogin: string;
  repositories: readonly string[];
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<GithubRepositoryHealthResult> {
  const client = args.client ?? defaultGithubApiClient;
  const account = {
    host: args.githubHost,
    login: args.githubAccountLogin,
  };
  const { query, variables } = buildHealthQuery(args.repositories);
  const fetchedAt = (args.now ?? (() => new Date()))().toISOString();
  try {
    const payload = await client.graphql({
      account,
      env: args.env,
      query,
      variables,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    });
    return parseAvailable({
      host: account.host,
      login: account.login,
      payload,
      requestedRepositories: args.repositories,
      fetchedAt,
    });
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 401) {
      return {
        outcome: "authentication_required",
        host: account.host,
        login: account.login,
        message: `GitHub sign-in is required for @${account.login}.`,
      };
    }
    if (
      error instanceof GithubApiError &&
      (error.status === 429 ||
        (error.status === 403 && error.retryAt !== null)) &&
      error.retryAt !== null
    ) {
      return {
        outcome: "rate_limited",
        host: account.host,
        login: account.login,
        message: "GitHub's request limit has been reached.",
        retryAt: error.retryAt,
      };
    }
    return {
      outcome: "unavailable",
      host: account.host,
      login: account.login,
      message: "GitHub repository health is temporarily unavailable.",
    };
  }
}
