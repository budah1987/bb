import { opendir, lstat } from "node:fs/promises";
import path from "node:path";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";

const MAX_SCAN_DEPTH = 12;
const MAX_SCANNED_FILES = 20_000;
const MAX_SCAN_MS = 2_000;

type DockerPathActivityResult =
  HostDaemonOnlineRpcResult<"workspace.docker_path_activity">;

interface InspectWorkspaceDockerPathActivityArgs {
  paths: readonly string[];
  workspacePath: string;
}

function safeRelativePath(value: string): string | null {
  if (path.isAbsolute(value)) return null;
  const normalized = path.normalize(value);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    return null;
  }
  return normalized;
}

async function containsSymlink(
  workspacePath: string,
  relativePath: string,
): Promise<boolean> {
  let currentPath = workspacePath;
  for (const segment of relativePath.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    try {
      if ((await lstat(currentPath)).isSymbolicLink()) return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }
  return false;
}

async function scanNewestFile(
  rootPath: string,
  displayPath: string,
): Promise<
  Extract<DockerPathActivityResult, { outcome: "available" }>["paths"][number]
> {
  const startedAt = Date.now();
  let limited = false;
  let newestFileMtimeMs: number | null = null;
  let newestFilePath: string | null = null;
  let scannedFiles = 0;
  const pending = [{ depth: 0, path: rootPath }];

  while (pending.length > 0) {
    if (Date.now() - startedAt >= MAX_SCAN_MS) {
      limited = true;
      break;
    }
    const current = pending.pop();
    if (current === undefined) break;
    let directory;
    try {
      directory = await opendir(current.path);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    for await (const entry of directory) {
      if (Date.now() - startedAt >= MAX_SCAN_MS) {
        limited = true;
        break;
      }
      const entryPath = path.join(current.path, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (current.depth < MAX_SCAN_DEPTH) {
          pending.push({ depth: current.depth + 1, path: entryPath });
        } else {
          limited = true;
        }
        continue;
      }
      if (!entry.isFile()) continue;
      scannedFiles += 1;
      if (scannedFiles > MAX_SCANNED_FILES) {
        limited = true;
        break;
      }
      const file = await lstat(entryPath);
      if (!file.isFile() || file.isSymbolicLink()) continue;
      if (newestFileMtimeMs === null || file.mtimeMs > newestFileMtimeMs) {
        newestFileMtimeMs = file.mtimeMs;
        newestFilePath = entryPath;
      }
    }
    if (limited) break;
  }

  return {
    limited,
    newestFileMtimeMs,
    newestFilePath,
    path: displayPath,
    scannedFiles: Math.min(scannedFiles, MAX_SCANNED_FILES),
  };
}

export async function inspectWorkspaceDockerPathActivity({
  paths,
  workspacePath,
}: InspectWorkspaceDockerPathActivityArgs): Promise<DockerPathActivityResult> {
  const normalizedPaths: string[] = [];
  for (const inputPath of paths) {
    const normalizedPath = safeRelativePath(inputPath);
    if (normalizedPath === null) {
      return {
        outcome: "unavailable",
        reason: "invalid_path",
        message: "Docker activity paths must stay inside the environment.",
      };
    }
    normalizedPaths.push(normalizedPath);
  }

  try {
    for (const relativePath of normalizedPaths) {
      if (await containsSymlink(workspacePath, relativePath)) {
        return {
          outcome: "unavailable",
          reason: "invalid_path",
          message: "Docker activity paths cannot contain symbolic links.",
        };
      }
    }
    return {
      outcome: "available",
      paths: await Promise.all(
        normalizedPaths.map((relativePath) =>
          scanNewestFile(
            path.resolve(workspacePath, relativePath),
            relativePath,
          ),
        ),
      ),
    };
  } catch (error) {
    return {
      outcome: "unavailable",
      reason: "scan_failed",
      message: error instanceof Error ? error.message : "File scan failed.",
    };
  }
}
