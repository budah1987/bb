import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import path from "node:path";
import { z } from "zod";

// Migration zero is the orphaned prototype's exact schema. Keeping its index
// stable lets an existing conductor-workspaces data.db upgrade in place.
const migrations = [
  `CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      anchor_thread_id TEXT NOT NULL UNIQUE,
      first_tab_thread_id TEXT NOT NULL,
      branch_name TEXT,
      environment_name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  `CREATE TABLE projection_backfill (
      version INTEGER PRIMARY KEY,
      signature TEXT NOT NULL,
      projects_scanned INTEGER NOT NULL,
      environments_projected INTEGER NOT NULL,
      active_conversations INTEGER NOT NULL,
      archived_conversations INTEGER NOT NULL,
      legacy_organizers_hidden INTEGER NOT NULL,
      unassigned_conversations INTEGER NOT NULL,
      missing_conversations INTEGER NOT NULL,
      duplicate_conversations INTEGER NOT NULL,
      reconciled_at INTEGER NOT NULL
    )`,
];

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

const updateWorkspaceFromMainResultSchema = z.object({
  message: z.string().min(1),
  outcome: z.enum(["updated", "already_current"]),
});

export const conductorRpcContract = defineRpcContract({
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

interface LegacyWorkspaceRow {
  id: string;
  project_id: string;
  title: string;
  anchor_thread_id: string;
  first_tab_thread_id: string;
  branch_name: string | null;
  environment_name: string | null;
}

interface WorkspaceArchiveStatus {
  outcome: string;
  workspace?: {
    workingTree: {
      hasUncommittedChanges: boolean;
    };
  };
}

export function workspaceArchiveGuard(
  status: WorkspaceArchiveStatus,
): "clean" | "uncommitted" {
  if (status.outcome !== "available" || !status.workspace) {
    throw new Error(
      "Couldn’t check this workspace for uncommitted changes. Nothing was archived.",
    );
  }
  return status.workspace.workingTree.hasUncommittedChanges
    ? "uncommitted"
    : "clean";
}

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);

  bb.rpc.register(conductorRpcContract, {
    async readWorkspaceRenameDetails({ environmentId }) {
      const environment = await bb.sdk.environments.get({ environmentId });
      return {
        displayName: environment.name,
        branchName: environment.branchName,
        folderName: environment.path ? path.basename(environment.path) : null,
      };
    },
    async renameWorkspace({ environmentId, scope, value }) {
      if (scope === "display") {
        await bb.sdk.environments.update({
          environmentId,
          name: value,
        });
      } else {
        await bb.sdk.environments.rename({
          environmentId,
          target: scope,
          value,
        });
      }
      return { renamed: true as const };
    },
    async archiveWorkspace({ environmentId, confirmUncommittedChanges }) {
      if (!confirmUncommittedChanges) {
        const status = await bb.sdk.environments.status({ environmentId });
        if (workspaceArchiveGuard(status) === "uncommitted") {
          return { outcome: "confirmation_required" as const };
        }
      }

      const result = await bb.sdk.environments.archiveThreads({
        environmentId,
      });
      return {
        outcome: "archived" as const,
        archivedThreadIds: result.archivedThreadIds,
      };
    },
    async readReconciliation() {
      const legacyRows = db
        .prepare(
          `SELECT id, project_id, title, anchor_thread_id,
                  first_tab_thread_id, branch_name, environment_name
             FROM workspaces
         ORDER BY created_at ASC`,
        )
        .all() as LegacyWorkspaceRow[];
      const recorded = db
        .prepare(
          `SELECT signature FROM projection_backfill
           ORDER BY version DESC LIMIT 1`,
        )
        .get() as { signature: string } | undefined;
      return {
        legacyWorkspaces: legacyRows.map((row) => ({
          id: row.id,
          projectId: row.project_id,
          title: row.title,
          anchorThreadId: row.anchor_thread_id,
          firstTabThreadId: row.first_tab_thread_id,
          branchName: row.branch_name,
          environmentName: row.environment_name,
        })),
        recordedSignature: recorded?.signature ?? null,
      };
    },
    async recordReconciliation(report) {
      if (
        report.missingConversations !== 0 ||
        report.duplicateConversations !== 0
      ) {
        throw new Error(
          "BBamir reconciliation refused an incomplete projection.",
        );
      }
      const previous = db
        .prepare(`SELECT signature FROM projection_backfill WHERE version = ?`)
        .get(report.version) as { signature: string } | undefined;
      if (previous?.signature === report.signature) {
        return { recorded: false };
      }
      db.prepare(
        `INSERT INTO projection_backfill (
           version, signature, projects_scanned, environments_projected,
           active_conversations, archived_conversations,
           legacy_organizers_hidden, unassigned_conversations,
           missing_conversations, duplicate_conversations, reconciled_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(version) DO UPDATE SET
           signature = excluded.signature,
           projects_scanned = excluded.projects_scanned,
           environments_projected = excluded.environments_projected,
           active_conversations = excluded.active_conversations,
           archived_conversations = excluded.archived_conversations,
           legacy_organizers_hidden = excluded.legacy_organizers_hidden,
           unassigned_conversations = excluded.unassigned_conversations,
           missing_conversations = excluded.missing_conversations,
           duplicate_conversations = excluded.duplicate_conversations,
           reconciled_at = excluded.reconciled_at`,
      ).run(
        report.version,
        report.signature,
        report.projectsScanned,
        report.environmentsProjected,
        report.activeConversations,
        report.archivedConversations,
        report.legacyOrganizersHidden,
        report.unassignedConversations,
        report.missingConversations,
        report.duplicateConversations,
        Date.now(),
      );
      bb.realtime.publish("projection-reconciled", {
        version: report.version,
      });
      return { recorded: true };
    },
    async readGithubCatalog() {
      const hosts = await bb.sdk.hosts.list();
      const host =
        hosts.find((candidate) => candidate.status === "connected") ?? hosts[0];
      if (!host) {
        throw new Error(
          "No BB host is available for GitHub repository discovery",
        );
      }
      const catalog = await bb.sdk.system.githubRepositories({
        hostId: host.id,
      });
      return {
        hostId: host.id,
        accounts: catalog.accounts,
        repositories: catalog.repositories,
      };
    },
    async createGithubProject({ accountLogin, hostId, name, remoteUrl }) {
      const project = await bb.sdk.projects.create({
        name,
        source: {
          hostId,
          remoteUrl,
          type: "clone",
        },
        githubAccountLogin: accountLogin,
      });
      return { projectId: project.id };
    },
    async setProjectGithubAccount({ accountLogin, projectId }) {
      const project = await bb.sdk.projects.update({
        projectId,
        githubAccountLogin: accountLogin,
      });
      return { accountLogin: project.githubAccountLogin };
    },
    async readProjectManager({ projectId }) {
      return bb.sdk.projects.manager.show({ projectId });
    },
    async updateProjectManager({ projectId, settings }) {
      return bb.sdk.projects.manager.settings({ projectId, ...settings });
    },
    async runProjectManager({ projectId, prompt }) {
      const thread = await bb.sdk.projects.manager.run({
        projectId,
        ...(prompt ? { prompt } : {}),
      });
      return { threadId: thread.id };
    },
    async updateWorkspaceFromMain({ environmentId }) {
      const result = updateWorkspaceFromMainResultSchema.parse(
        await bb.sdk.environments.updateFromMain({ environmentId }),
      );
      return { message: result.message, outcome: result.outcome };
    },
  });
}
