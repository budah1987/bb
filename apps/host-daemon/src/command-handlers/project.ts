import fs from "node:fs/promises";
import path from "node:path";
import { runGit, WorkspaceError } from "@bb/host-workspace";
import { ExpectedCommandDispatchError } from "../command-dispatch-support.js";
import { getGithubAccountEnvironment } from "../github-repositories.js";

const PROJECT_CLONE_TIMEOUT_MS = 20 * 60 * 1000;

function normalizeProjectSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
    .replace(/-+$/u, "");
  return slug || "project";
}

function normalizeRemoteUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "").replace(/\.git$/u, "").toLowerCase();
}

export function resolveProjectCloneDefaultPath(
  dataDir: string,
  projectSlug: string,
): string {
  return path.resolve(dataDir, "checkouts", normalizeProjectSlug(projectSlug));
}

async function requireEmptyOrMissingTarget(targetPath: string): Promise<void> {
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory() || (await fs.readdir(targetPath)).length > 0) {
      throw new ExpectedCommandDispatchError(
        "target_not_empty",
        `Clone target is not empty: ${targetPath}`,
      );
    }
  } catch (error) {
    if (error instanceof ExpectedCommandDispatchError) {
      throw error;
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export async function inspectProjectPath(projectPath: string): Promise<{
  path: string;
  gitRemoteUrl: string | null;
}> {
  const resolvedPath = path.resolve(projectPath);
  const result = await runGit(["remote", "get-url", "origin"], {
    cwd: resolvedPath,
    allowFailure: true,
  });
  const gitRemoteUrl = result.exitCode === 0 ? result.stdout.trim() : "";
  return {
    path: resolvedPath,
    gitRemoteUrl: gitRemoteUrl || null,
  };
}

export async function cloneProject(args: {
  dataDir: string;
  githubAccountLogin?: string | null;
  projectSlug: string;
  remoteUrl: string;
  targetPath?: string;
}): Promise<{ path: string; gitRemoteUrl: string | null }> {
  const targetPath = path.resolve(
    args.targetPath ??
      resolveProjectCloneDefaultPath(args.dataDir, args.projectSlug),
  );
  const existingTarget = await inspectProjectPath(targetPath).catch(() => null);
  if (
    existingTarget?.gitRemoteUrl !== null &&
    existingTarget?.gitRemoteUrl !== undefined &&
    normalizeRemoteUrl(existingTarget.gitRemoteUrl) ===
      normalizeRemoteUrl(args.remoteUrl)
  ) {
    return existingTarget;
  }
  await requireEmptyOrMissingTarget(targetPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  // Clone into a sibling staging directory. `git clone` can leave a partial
  // checkout behind when authentication or the network fails; staging keeps
  // that failed attempt from making every retry look like a user-owned,
  // non-empty destination.
  const stagingRoot = await fs.mkdtemp(
    path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.clone-`),
  );
  const stagingPath = path.join(stagingRoot, "checkout");
  try {
    const githubAccountEnvironment = await getGithubAccountEnvironment({
      env: process.env,
      login: args.githubAccountLogin ?? null,
    });
    await runGit(["clone", args.remoteUrl, stagingPath], {
      cwd: stagingRoot,
      ...(githubAccountEnvironment ? { env: githubAccountEnvironment } : {}),
      timeoutMs: PROJECT_CLONE_TIMEOUT_MS,
    });
    // Preserve the existing safety rule if the destination changes while the
    // potentially long-running clone is in progress. Empty directories are
    // safe to replace; anything with contents is not.
    await requireEmptyOrMissingTarget(targetPath);
    try {
      await fs.rmdir(targetPath);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        throw error;
      }
    }
    await fs.rename(stagingPath, targetPath);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw new ExpectedCommandDispatchError(error.code, error.message);
    }
    throw error;
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
  return inspectProjectPath(targetPath);
}
