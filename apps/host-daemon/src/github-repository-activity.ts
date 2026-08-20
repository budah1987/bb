import type {
  GithubInboxItem,
  GithubIssueSummary,
  GithubRepositoryActivityResult,
  GithubWorkflowRunSummary,
} from "@bb/host-daemon-contract";
import {
  defaultGithubApiClient,
  GithubApiError,
  type GithubApiClient,
} from "./github-api.js";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function nestedString(value: unknown, key: string): string | null {
  const object = record(value);
  return typeof object?.[key] === "string" ? object[key] : null;
}

function parseIssues(value: unknown): GithubIssueSummary[] {
  if (!Array.isArray(value))
    throw new Error("GitHub returned malformed issues");
  return value.flatMap((item): GithubIssueSummary[] => {
    const issue = record(item);
    if (
      issue === null ||
      issue.pull_request !== undefined ||
      typeof issue.number !== "number" ||
      typeof issue.title !== "string" ||
      typeof issue.html_url !== "string" ||
      typeof issue.updated_at !== "string"
    ) {
      return [];
    }
    const labels = Array.isArray(issue.labels)
      ? issue.labels.flatMap((label): string[] => {
          if (typeof label === "string") return [label];
          const name = nestedString(label, "name");
          return name === null ? [] : [name];
        })
      : [];
    return [
      {
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        author: nestedString(issue.user, "login"),
        labels,
        updatedAt: issue.updated_at,
      },
    ];
  });
}

function parseWorkflowRuns(value: unknown): GithubWorkflowRunSummary[] {
  const runs = record(value)?.workflow_runs;
  if (!Array.isArray(runs)) {
    throw new Error("GitHub returned malformed workflow runs");
  }
  return runs.flatMap((item): GithubWorkflowRunSummary[] => {
    const run = record(item);
    if (
      run === null ||
      typeof run.id !== "number" ||
      typeof run.name !== "string" ||
      typeof run.html_url !== "string" ||
      typeof run.event !== "string" ||
      typeof run.status !== "string" ||
      typeof run.updated_at !== "string"
    ) {
      return [];
    }
    return [
      {
        id: run.id,
        name: run.name,
        url: run.html_url,
        branch: typeof run.head_branch === "string" ? run.head_branch : null,
        event: run.event,
        status: run.status,
        conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
        updatedAt: run.updated_at,
      },
    ];
  });
}

function subjectWebUrl(apiUrl: string | null, host: string): string | null {
  if (apiUrl === null) return null;
  const match = apiUrl.match(
    /\/repos\/([^/]+)\/([^/]+)\/(issues|pulls)\/(\d+)$/u,
  );
  if (!match) return null;
  const [, owner, repository, kind, number] = match;
  return `https://${host}/${owner}/${repository}/${kind === "pulls" ? "pull" : "issues"}/${number}`;
}

function parseInbox(args: {
  host: string;
  repository: string;
  value: unknown;
}): GithubInboxItem[] {
  if (!Array.isArray(args.value)) {
    throw new Error("GitHub returned malformed notifications");
  }
  return args.value.flatMap((item): GithubInboxItem[] => {
    const notification = record(item);
    const repository = nestedString(notification?.repository, "full_name");
    const subject = record(notification?.subject);
    if (
      notification === null ||
      repository?.toLocaleLowerCase() !== args.repository.toLocaleLowerCase() ||
      subject === null ||
      typeof notification.id !== "string" ||
      typeof notification.reason !== "string" ||
      typeof notification.unread !== "boolean" ||
      typeof notification.updated_at !== "string" ||
      typeof subject.title !== "string" ||
      typeof subject.type !== "string"
    ) {
      return [];
    }
    return [
      {
        id: notification.id,
        repository,
        reason: notification.reason,
        title: subject.title,
        subjectType: subject.type,
        unread: notification.unread,
        updatedAt: notification.updated_at,
        url: subjectWebUrl(
          typeof subject.url === "string" ? subject.url : null,
          args.host,
        ),
      },
    ];
  });
}

function failure(args: {
  error: unknown;
  host: string;
  login: string;
}): GithubRepositoryActivityResult {
  if (args.error instanceof GithubApiError && args.error.status === 401) {
    return {
      outcome: "authentication_required",
      host: args.host,
      login: args.login,
      message: `GitHub sign-in is required for @${args.login}.`,
    };
  }
  if (
    args.error instanceof GithubApiError &&
    (args.error.status === 429 || args.error.status === 403) &&
    args.error.retryAt !== null
  ) {
    return {
      outcome: "rate_limited",
      host: args.host,
      login: args.login,
      message: "GitHub's request limit has been reached.",
      retryAt: args.error.retryAt,
    };
  }
  return {
    outcome: "unavailable",
    host: args.host,
    login: args.login,
    message: "GitHub repository activity is temporarily unavailable.",
  };
}

export async function getGithubRepositoryActivity(args: {
  client?: GithubApiClient;
  env: NodeJS.ProcessEnv;
  githubHost: string;
  githubAccountLogin: string;
  repository: string;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<GithubRepositoryActivityResult> {
  const client = args.client ?? defaultGithubApiClient;
  const account = { host: args.githubHost, login: args.githubAccountLogin };
  const [owner, repository] = args.repository.split("/") as [string, string];
  const path = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  try {
    const [issues, workflowRuns, inbox] = await Promise.all([
      client.requestJson({
        account,
        env: args.env,
        path: `${path}/issues?state=open&sort=updated&per_page=50`,
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      }),
      client.requestJson({
        account,
        env: args.env,
        path: `${path}/actions/runs?per_page=30`,
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      }),
      client.requestJson({
        account,
        env: args.env,
        path: `${path}/notifications?all=false&per_page=50`,
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      }),
    ]);
    return {
      outcome: "available",
      host: account.host,
      login: account.login,
      repository: args.repository,
      issues: parseIssues(issues),
      workflowRuns: parseWorkflowRuns(workflowRuns),
      inbox: parseInbox({
        host: account.host,
        repository: args.repository,
        value: inbox,
      }),
      fetchedAt: (args.now ?? (() => new Date()))().toISOString(),
    };
  } catch (error) {
    return failure({ error, host: account.host, login: account.login });
  }
}
