import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const legacyWorkspaceSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  anchorThreadId: z.string(),
  firstTabThreadId: z.string(),
  branchName: z.string().nullable(),
  environmentName: z.string().nullable(),
});

const backfillReportSchema = z.object({
  version: z.number().int().positive(),
  signature: z.string(),
  projectsScanned: z.number().int().nonnegative(),
  environmentsProjected: z.number().int().nonnegative(),
  activeConversations: z.number().int().nonnegative(),
  archivedConversations: z.number().int().nonnegative(),
  legacyOrganizersHidden: z.number().int().nonnegative(),
  unassignedConversations: z.number().int().nonnegative(),
  missingConversations: z.number().int().nonnegative(),
  duplicateConversations: z.number().int().nonnegative(),
});

const githubAccountSchema = z.object({
  login: z.string().min(1),
  active: z.boolean(),
});

const githubRepositorySchema = z.object({
  name: z.string().min(1),
  nameWithOwner: z.string().min(3),
  owner: z.string().min(1),
  url: z.string().url(),
  isPrivate: z.boolean(),
  defaultBranch: z.string().min(1).nullable(),
  updatedAt: z.string().min(1),
  accessibleBy: z.array(z.string().min(1)).min(1),
  activeAccount: z.string().min(1).nullable(),
});

const githubCatalogSchema = z.object({
  hostId: z.string().min(1),
  accounts: z.array(githubAccountSchema),
  repositories: z.array(githubRepositorySchema),
});

const managerSettingsSchema = z.object({
  enabled: z.boolean(),
  providerId: z.string().min(1),
  model: z.string().min(1),
  reasoningLevel: z.enum([
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "ultracode",
    "max",
    "ultra",
  ]),
  serviceTier: z.enum(["default", "fast"]),
  permissionMode: z.enum(["accept-edits", "auto", "full"]),
});

export const updateWorkspaceFromMainResultSchema = z.object({
  message: z.string().min(1),
  outcome: z.enum(["updated", "already_current"]),
});

const workspaceGitSummarySchema = z.object({
  environmentId: z.string().min(1),
  workspacePath: z.string().min(1).nullable(),
  gitAvailable: z.boolean(),
  aheadCount: z.number().int().nonnegative(),
  behindCount: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
});

export interface WorkspaceGitSummary {
  environmentId: string;
  workspacePath: string | null;
  gitAvailable: boolean;
  aheadCount: number;
  behindCount: number;
  changedFiles: number;
}

export const conductorRpcContract = defineRpcContract({
  readWorkspaceGitSummaries: {
    input: z.object({
      environmentIds: z.array(z.string().min(1)).max(50),
    }),
    output: z.object({ summaries: z.array(workspaceGitSummarySchema) }),
  },
  readWorkspaceRenameDetails: {
    input: z.object({ environmentId: z.string().min(1) }),
    output: z.object({
      displayName: z.string().nullable(),
      branchName: z.string().nullable(),
      folderName: z.string().nullable(),
    }),
  },
  renameWorkspace: {
    input: z.object({
      environmentId: z.string().min(1),
      scope: z.enum(["display", "branch", "folder"]),
      value: z.string().trim().min(1),
    }),
    output: z.object({ renamed: z.literal(true) }),
  },
  archiveWorkspace: {
    input: z.object({
      environmentId: z.string().min(1),
      confirmUncommittedChanges: z.boolean(),
    }),
    output: z.discriminatedUnion("outcome", [
      z.object({ outcome: z.literal("confirmation_required") }),
      z.object({
        outcome: z.literal("archived"),
        archivedThreadIds: z.array(z.string()),
      }),
    ]),
  },
  readReconciliation: {
    input: z.object({}),
    output: z.object({
      legacyWorkspaces: z.array(legacyWorkspaceSchema),
      recordedSignature: z.string().nullable(),
    }),
  },
  recordReconciliation: {
    input: backfillReportSchema,
    output: z.object({ recorded: z.boolean() }),
  },
  readGithubCatalog: {
    input: z.object({}),
    output: githubCatalogSchema,
  },
  createGithubProject: {
    input: z.object({
      accountLogin: z.string().min(1).nullable(),
      hostId: z.string().min(1),
      name: z.string().trim().min(1),
      remoteUrl: z.string().url(),
    }),
    output: z.object({ projectId: z.string().min(1) }),
  },
  setProjectGithubAccount: {
    input: z.object({
      accountLogin: z.string().min(1).nullable(),
      projectId: z.string().min(1),
    }),
    output: z.object({ accountLogin: z.string().min(1).nullable() }),
  },
  readProjectManager: {
    input: z.object({ projectId: z.string().min(1) }),
    output: managerSettingsSchema,
  },
  updateProjectManager: {
    input: z.object({
      projectId: z.string().min(1),
      settings: managerSettingsSchema,
    }),
    output: managerSettingsSchema,
  },
  runProjectManager: {
    input: z.object({
      projectId: z.string().min(1),
      prompt: z.string().trim().min(1).optional(),
    }),
    output: z.object({ threadId: z.string().min(1) }),
  },
  updateWorkspaceFromMain: {
    input: z.object({ environmentId: z.string().min(1) }),
    output: updateWorkspaceFromMainResultSchema,
  },
});
