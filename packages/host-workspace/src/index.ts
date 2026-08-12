export {
  getPersonalWorkspaceRoot,
  openWorkspace,
  provisionWorkspace,
  validatePersonalWorkspaceTargetPath,
} from "./provision.js";
export type {
  HostWorkspace,
  PersonalWorkspaceOpts,
  ProvisionWorkspaceArgs,
  UnmanagedCheckoutOpts,
  UnmanagedWorkspaceOpts,
  ManagedWorkspaceBaseOpts,
  ManagedWorktreeOpts,
  ReconnectManagedWorktreeOpts,
} from "./provision.js";

export type {
  CommitOptions,
  CommitResult,
  DiffOptions,
  DiffResult,
  FetchOptions,
  PullRequestActionOptions,
  PublishCommittedBranchBlocked,
  PublishCommittedBranchBlockedReason,
  PublishCommittedBranchOptions,
  PublishCommittedBranchResult,
  PublishCommittedBranchSuccess,
  UpdateFromTargetBlocked,
  UpdateFromTargetBlockedReason,
  UpdateFromTargetOptions,
  UpdateFromTargetResult,
  UpdateFromTargetSuccess,
  SquashMergeOptions,
  SquashMergeResult,
  StatusOptions,
} from "./workspace.js";
export { Workspace } from "./workspace.js";

export { renameWorkspaceBranch, renameWorktreeFolder } from "./rename.js";
export type {
  RenameWorkspaceBranchArgs,
  RenameWorktreeFolderArgs,
} from "./rename.js";

export {
  WorkspaceError,
  detectGitRepo,
  fetchRemoteBranches,
  getCheckoutRef,
  getCurrentBranch,
  getWorkspaceGitOperation,
  getGitCommonDir,
  gitBlobSize,
  hasUncommittedChanges,
  listBranches,
  listRemoteBranches,
  readDefaultBranch,
  readDefaultBranchRefs,
  readGitBlob,
  runGit,
} from "./git.js";
export type {
  DefaultBranchRefs,
  FetchRemoteBranchesResult,
  ReadGitBlobResult,
} from "./git.js";

export {
  createPullRequestForBranch,
  getPullRequestForCurrentBranch,
  rerunPullRequestChecksForCurrentBranch,
  runPullRequestActionForCurrentBranch,
  parseGitHostPullRequest,
  type GitHostPullRequestLookup,
  type GitHostCommandOptions,
  type GitHostPullRequestCreateOptions,
  type GitHostPullRequestChecksRerunResult,
  type GitHostPullRequestChecksRerunTarget,
} from "./git-host.js";
