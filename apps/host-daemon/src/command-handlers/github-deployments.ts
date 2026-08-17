import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 15_000;
const COMMAND_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const MAX_DEPLOYMENTS = 12;

const githubDeploymentSchema = z
  .object({
    id: z.number().int().nonnegative(),
    ref: z.string(),
    environment: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

const githubDeploymentStatusSchema = z
  .object({
    state: z.string(),
    environment_url: z.string().nullable(),
    log_url: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

const githubDeploymentsSchema = z.array(githubDeploymentSchema);
const githubDeploymentStatusesSchema = z.array(githubDeploymentStatusSchema);
const githubPullRequestCommentsSchema = z
  .object({
    comments: z.array(
      z
        .object({
          author: z.object({ login: z.string() }).passthrough(),
          body: z.string(),
          createdAt: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

interface CommandOutput {
  stdout: string;
}

export type GithubDeploymentCommandRunner = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv },
) => Promise<CommandOutput>;

export interface WorkspaceGithubDeploymentsAvailable {
  outcome: "available";
  repository: string;
  ref: string;
  deployments: Array<{
    id: number;
    environment: string;
    ref: string;
    createdAt: string;
    updatedAt: string;
    latestStatus: {
      state: string;
      branchUrl: string | null;
      deploymentUrl: string | null;
      logUrl: string | null;
      createdAt: string;
      updatedAt: string;
    } | null;
  }>;
}

export interface WorkspaceGithubDeploymentsUnavailable {
  outcome: "unavailable";
  reason:
    | "github_not_installed"
    | "github_unavailable"
    | "not_github_repository";
  message: string;
}

export type WorkspaceGithubDeploymentsResult =
  | WorkspaceGithubDeploymentsAvailable
  | WorkspaceGithubDeploymentsUnavailable;

interface DiscoverWorkspaceGithubDeploymentsArgs {
  env: NodeJS.ProcessEnv;
  run?: GithubDeploymentCommandRunner;
  workspacePath: string;
}

async function defaultRun(
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv },
): Promise<CommandOutput> {
  const result = await execFileAsync(command, [...args], {
    env: options.env,
    encoding: "utf8",
    maxBuffer: COMMAND_MAX_BUFFER_BYTES,
    timeout: COMMAND_TIMEOUT_MS,
  });
  return { stdout: result.stdout };
}

function commandErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

function commandErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Command failed";
}

function nonEmptyUrl(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeVercelPreviewUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname.endsWith(".vercel.app") ||
        url.hostname.endsWith(".vercel.sh"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Vercel's GitHub deployment status points at one immutable deployment. Its
 * edited PR comment is the credential-free source for the stable branch alias.
 * Parse only the visible project table so an opaque Vercel metadata format
 * change cannot break discovery.
 */
export function parseVercelBranchUrls(
  commentBody: string,
): ReadonlyMap<string, string> {
  const urls = new Map<string, string>();
  const rowPattern =
    /\|\s*(?:<a[^>]*>.*?<\/a>\s*)?\[([^\]]+)\]\(https:\/\/vercel\.com\/[^)]+\)\s*\|[^|]*\|\s*\[Preview\]\((https:\/\/[^)]+)\)/giu;
  for (const match of commentBody.matchAll(rowPattern)) {
    const project = match[1]?.trim();
    const url = match[2] === undefined ? null : safeVercelPreviewUrl(match[2]);
    if (project && url !== null) urls.set(project, url);
  }
  return urls;
}

function vercelProjectForEnvironment(environment: string): string | null {
  const match = /^Preview(?:\s*[–—-]\s*(.+))?$/iu.exec(environment.trim());
  return match?.[1]?.trim() || null;
}

async function discoverVercelBranchUrls(args: {
  env: NodeJS.ProcessEnv;
  ref: string;
  repository: string;
  run: GithubDeploymentCommandRunner;
}): Promise<ReadonlyMap<string, string>> {
  try {
    const response = await args.run(
      "gh",
      ["pr", "view", args.ref, "--repo", args.repository, "--json", "comments"],
      { env: args.env },
    );
    const { comments } = githubPullRequestCommentsSchema.parse(
      JSON.parse(response.stdout),
    );
    const comment = comments
      .filter((candidate) =>
        ["vercel", "vercel[bot]"].includes(
          candidate.author.login.toLocaleLowerCase(),
        ),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return comment === undefined
      ? new Map()
      : parseVercelBranchUrls(comment.body);
  } catch {
    // A branch need not have a PR, and GitHub may withhold comments even when
    // deployment status is readable. The immutable deployment remains useful.
    return new Map();
  }
}

export function parseGithubRepository(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/u.exec(
    trimmed,
  );
  if (sshMatch !== null) {
    return `${sshMatch[1]}/${sshMatch[2]?.replace(/\.git$/u, "")}`;
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    const parts = url.pathname
      .replace(/^\//u, "")
      .replace(/\.git$/u, "")
      .split("/");
    return parts.length === 2 && parts.every((part) => part.length > 0)
      ? `${parts[0]}/${parts[1]}`
      : null;
  } catch {
    return null;
  }
}

export async function discoverWorkspaceGithubDeployments({
  env,
  run = defaultRun,
  workspacePath,
}: DiscoverWorkspaceGithubDeploymentsArgs): Promise<WorkspaceGithubDeploymentsResult> {
  let ref: string;
  let remoteUrl: string;
  try {
    const [refResult, remoteResult] = await Promise.all([
      run("git", ["-C", workspacePath, "rev-parse", "--abbrev-ref", "HEAD"], {
        env,
      }),
      run("git", ["-C", workspacePath, "remote", "get-url", "origin"], {
        env,
      }),
    ]);
    ref = refResult.stdout.trim();
    remoteUrl = remoteResult.stdout.trim();
  } catch (error) {
    return {
      outcome: "unavailable",
      reason: "not_github_repository",
      message: `Could not resolve the GitHub repository: ${commandErrorMessage(error)}`,
    };
  }

  const repository = parseGithubRepository(remoteUrl);
  if (repository === null || ref.length === 0 || ref === "HEAD") {
    return {
      outcome: "unavailable",
      reason: "not_github_repository",
      message:
        "The environment is not on a named branch in a GitHub repository.",
    };
  }

  let deployments: z.infer<typeof githubDeploymentsSchema>;
  try {
    const response = await run(
      "gh",
      [
        "api",
        "--method",
        "GET",
        `repos/${repository}/deployments`,
        "-f",
        `ref=${ref}`,
        "-f",
        `per_page=${MAX_DEPLOYMENTS}`,
      ],
      { env },
    );
    deployments = githubDeploymentsSchema.parse(JSON.parse(response.stdout));
  } catch (error) {
    const isNotInstalled = commandErrorCode(error) === "ENOENT";
    return {
      outcome: "unavailable",
      reason: isNotInstalled ? "github_not_installed" : "github_unavailable",
      message: isNotInstalled
        ? "GitHub CLI is not installed on this host."
        : `GitHub deployments are unavailable: ${commandErrorMessage(error)}`,
    };
  }

  try {
    const [branchUrls, rawResults] = await Promise.all([
      deployments.length === 0
        ? Promise.resolve(new Map<string, string>())
        : discoverVercelBranchUrls({ env, ref, repository, run }),
      Promise.all(
        deployments.slice(0, MAX_DEPLOYMENTS).map(async (deployment) => {
          const response = await run(
            "gh",
            [
              "api",
              "--method",
              "GET",
              `repos/${repository}/deployments/${deployment.id}/statuses`,
              "-f",
              "per_page=1",
            ],
            { env },
          );
          const statuses = githubDeploymentStatusesSchema.parse(
            JSON.parse(response.stdout),
          );
          const latest = statuses[0];
          return {
            id: deployment.id,
            environment: deployment.environment,
            ref: deployment.ref,
            createdAt: deployment.created_at,
            updatedAt: deployment.updated_at,
            latestStatus:
              latest === undefined
                ? null
                : {
                    state: latest.state,
                    branchUrl: null,
                    deploymentUrl: nonEmptyUrl(latest.environment_url),
                    logUrl: nonEmptyUrl(latest.log_url),
                    createdAt: latest.created_at,
                    updatedAt: latest.updated_at,
                  },
          };
        }),
      ),
    ]);
    const results: WorkspaceGithubDeploymentsAvailable["deployments"] =
      rawResults.map((deployment) => {
        const status = deployment.latestStatus;
        if (
          status === null ||
          status.deploymentUrl === null ||
          safeVercelPreviewUrl(status.deploymentUrl) === null
        ) {
          return deployment;
        }
        const project = vercelProjectForEnvironment(deployment.environment);
        const branchUrl =
          project === null && branchUrls.size === 1
            ? branchUrls.values().next().value
            : project === null
              ? undefined
              : branchUrls.get(project);
        return {
          ...deployment,
          latestStatus: { ...status, branchUrl: branchUrl ?? null },
        };
      });
    return { outcome: "available", deployments: results, ref, repository };
  } catch (error) {
    return {
      outcome: "unavailable",
      reason: "github_unavailable",
      message: `GitHub deployment statuses are unavailable: ${commandErrorMessage(error)}`,
    };
  }
}
