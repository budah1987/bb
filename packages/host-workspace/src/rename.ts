import path from "node:path";
import { withCheckoutMutationLock } from "./checkout-mutation-lock.js";
import {
  getCurrentBranch,
  getGitCommonDir,
  runGit,
  WorkspaceError,
} from "./git.js";
import { withWorktreeMetadataLock } from "./worktree-metadata-lock.js";

export interface RenameWorkspaceBranchArgs {
  path: string;
  branchName: string;
}

export interface RenameWorktreeFolderArgs {
  path: string;
  folderName: string;
}

export async function renameWorkspaceBranch(
  args: RenameWorkspaceBranchArgs,
): Promise<string> {
  const workspacePath = path.resolve(args.path);
  return withCheckoutMutationLock(workspacePath, async () => {
    const currentBranch = await getCurrentBranch(workspacePath);
    if (!currentBranch) {
      throw new WorkspaceError(
        "detached_head",
        "Cannot rename the branch of a detached workspace",
      );
    }
    if (currentBranch === args.branchName) return currentBranch;
    const commonDir = await getGitCommonDir(workspacePath);
    await withWorktreeMetadataLock(commonDir, () =>
      runGit(["branch", "--move", args.branchName], { cwd: workspacePath }),
    );
    return args.branchName;
  });
}

export async function renameWorktreeFolder(
  args: RenameWorktreeFolderArgs,
): Promise<string> {
  const sourcePath = path.resolve(args.path);
  const destinationPath = path.join(path.dirname(sourcePath), args.folderName);
  if (destinationPath === sourcePath) return sourcePath;

  return withCheckoutMutationLock(sourcePath, async () => {
    const commonDir = await getGitCommonDir(sourcePath);
    await withWorktreeMetadataLock(commonDir, () =>
      runGit(
        [
          "--git-dir",
          commonDir,
          "worktree",
          "move",
          sourcePath,
          destinationPath,
        ],
        { cwd: path.dirname(sourcePath) },
      ),
    );
    return destinationPath;
  });
}
