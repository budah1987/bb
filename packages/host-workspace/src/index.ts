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
  SquashMergeOptions,
  SquashMergeResult,
  StatusOptions,
} from "./workspace.js";

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
  getPullRequestForBranch,
  parseGitHostPullRequest,
  type GitHostPullRequestLookup,
  type GitHostCommandOptions,
  type GitHostPullRequestCreateOptions,
} from "./git-host.js";
