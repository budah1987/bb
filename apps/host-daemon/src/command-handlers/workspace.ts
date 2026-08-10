import type { HostDaemonCommandResult } from "@bb/host-daemon-contract";
import {
  renameWorkspaceBranch,
  renameWorktreeFolder,
} from "@bb/host-workspace";
import { Workspace } from "@bb/host-workspace";
import { ExpectedCommandDispatchError } from "../command-dispatch-support.js";
import {
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";
import { requireResolvedWorkspaceForCommand } from "../workspace-resolution.js";

export async function squashMerge(
  command: CommandOf<"workspace.squash_merge">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"workspace.squash_merge">> {
  const entry = await requireResolvedWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    requireGit: true,
    requireManagedWorktree: true,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  const result = await entry.workspace.squashMerge({
    targetBranch: command.targetBranch,
    commitMessage: command.commitMessage,
  });
  return {
    merged: result.merged,
    commitSha: result.commitSha,
    commitSubject: result.commitSubject,
  };
}

export async function publishCommittedBranch(
  command: CommandOf<"workspace.publish_committed_branch">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"workspace.publish_committed_branch">> {
  const entry = await requireResolvedWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    requireGit: true,
    requireManagedWorktree: true,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  return new Workspace(entry.workspace.path).publishCommittedBranchToTarget({
    targetBranch: command.targetBranch,
    preserveTargetChanges: command.preserveTargetChanges,
  });
}

export async function updateFromTarget(
  command: CommandOf<"workspace.update_from_target">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"workspace.update_from_target">> {
  const entry = await requireResolvedWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    requireGit: true,
    requireManagedWorktree: true,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  return new Workspace(entry.workspace.path).updateFromTarget({
    targetBranch: command.targetBranch,
  });
}

export async function renameWorkspace(
  command: CommandOf<"workspace.rename">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"workspace.rename">> {
  const entry = await requireResolvedWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    requireGit: true,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  if (entry.runtime.getLiveThreadIds().length > 0) {
    throw new ExpectedCommandDispatchError(
      "environment_busy",
      "Wait for active work in this workspace to finish before renaming it",
    );
  }

  if (command.target === "branch") {
    const branchName = await renameWorkspaceBranch({
      path: command.workspaceContext.workspacePath,
      branchName: command.value,
    });
    return { target: "branch", branchName };
  }

  await options.terminalManager?.closeEnvironmentTerminals({
    environmentId: command.environmentId,
    reason: "user",
  });
  await options.runtimeManager.forgetEnvironment(command.environmentId);
  const renamedPath = await renameWorktreeFolder({
    path: command.workspaceContext.workspacePath,
    folderName: command.value,
  });
  return { target: "folder", path: renamedPath };
}
