import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getCurrentBranch, runGit } from "../src/git.js";
import { createWorktree } from "../src/provisioning.js";
import { renameWorkspaceBranch, renameWorktreeFolder } from "../src/rename.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function createRepo(): Promise<string> {
  const repoPath = await makeTempDir("bb-rename-repo-");
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  return repoPath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("workspace rename", () => {
  it("renames the checked-out branch and moves its linked worktree metadata", async () => {
    const sourcePath = await createRepo();
    const parentPath = await makeTempDir("bb-rename-worktrees-");
    const originalPath = path.join(parentPath, "original");
    const renamedPath = path.join(parentPath, "renamed");
    await createWorktree({
      sourcePath,
      targetPath: originalPath,
      branchName: "feature/original",
      baseBranch: "main",
      timeoutMs: 30_000,
    });
    const originalRealPath = await fs.realpath(originalPath);

    await expect(
      renameWorkspaceBranch({
        path: originalPath,
        branchName: "feature/renamed",
      }),
    ).resolves.toBe("feature/renamed");
    expect(await getCurrentBranch(originalPath)).toBe("feature/renamed");

    await expect(
      renameWorktreeFolder({ path: originalPath, folderName: "renamed" }),
    ).resolves.toBe(renamedPath);
    await expect(fs.stat(originalPath)).rejects.toThrow();
    await expect(
      fs.readFile(path.join(renamedPath, "README.md"), "utf8"),
    ).resolves.toBe("hello\n");
    const worktrees = await runGit(["worktree", "list", "--porcelain"], {
      cwd: sourcePath,
    });
    expect(worktrees.stdout).toContain(
      `worktree ${await fs.realpath(renamedPath)}`,
    );
    expect(worktrees.stdout).not.toContain(`worktree ${originalRealPath}\n`);
  });
});
