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
          "Conductor reconciliation refused an incomplete projection.",
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
  });
}
