import type { BbPluginApi } from "@get-bb/plugin-sdk";
import path from "node:path";
import {
  conductorRpcContract,
  updateWorkspaceFromMainResultSchema,
  type WorkspaceGitSummary,
} from "./rpc-contract";

export { conductorRpcContract } from "./rpc-contract";

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

const TRANSCRIPT_SEGMENT_LIMIT = "100";
const TRANSCRIPT_MAX_PAGES = 12;
const TRANSCRIPT_MAX_CHARS = 30_000;

interface TranscriptConversationRow {
  kind: string;
  role?: string;
  text?: string;
}

export function formatConversationTranscript(
  title: string,
  rows: readonly TranscriptConversationRow[],
): string {
  const transcript = rows
    .filter(
      (
        row,
      ): row is TranscriptConversationRow & {
        role: "user" | "assistant";
        text: string;
      } =>
        row.kind === "conversation" &&
        (row.role === "user" || row.role === "assistant") &&
        typeof row.text === "string" &&
        row.text.trim().length > 0,
    )
    .map((row) => {
      const speaker = row.role === "user" ? "User" : "Assistant";
      return `## ${speaker}\n\n${row.text.trim()}`;
    })
    .join("\n\n");
  const clippedTranscript =
    transcript.length <= TRANSCRIPT_MAX_CHARS
      ? transcript
      : `[Earlier transcript omitted]\n\n${transcript.slice(
          -TRANSCRIPT_MAX_CHARS,
        )}`;

  return [
    `# Conversation transcript: ${title}`,
    "",
    clippedTranscript || "(This conversation has no messages yet.)",
  ].join("\n");
}

async function readConversationTranscript(
  bb: BbPluginApi,
  threadId: string,
): Promise<string> {
  const thread = await bb.sdk.threads.get({ threadId });
  const pages = [];
  let page = await bb.sdk.threads.timeline({
    threadId,
    segmentLimit: TRANSCRIPT_SEGMENT_LIMIT,
  });
  pages.unshift(page.rows);

  for (
    let pageCount = 1;
    page.timelinePage.hasOlderRows &&
    page.timelinePage.olderCursor !== null &&
    pageCount < TRANSCRIPT_MAX_PAGES;
    pageCount += 1
  ) {
    const cursor = page.timelinePage.olderCursor;
    page = await bb.sdk.threads.timeline({
      threadId,
      segmentLimit: TRANSCRIPT_SEGMENT_LIMIT,
      beforeAnchorSeq: String(cursor.anchorSeq),
      beforeAnchorId: cursor.anchorId,
    });
    pages.unshift(page.rows);
  }

  return formatConversationTranscript(
    thread.title ?? thread.titleFallback ?? "Conversation",
    pages.flat(),
  );
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

  bb.ui.registerMentionProvider({
    id: "conversation-transcript",
    label: "Conversation transcripts",
    async search({ projectId, query, threadId }) {
      if (projectId === null) return [];
      const normalizedQuery = query.trim().toLocaleLowerCase();
      const threads = await bb.sdk.threads.list({
        projectId,
        limit: 50,
      });
      return threads
        .filter((thread) => thread.id !== threadId)
        .filter((thread) => {
          if (normalizedQuery.length === 0) return true;
          const title = thread.title ?? thread.titleFallback ?? "Conversation";
          return title.toLocaleLowerCase().includes(normalizedQuery);
        })
        .slice(0, 20)
        .map((thread) => ({
          id: thread.id,
          title: thread.title ?? thread.titleFallback ?? "Conversation",
          subtitle: "Conversation transcript",
          icon: "MessageSquareText",
        }));
    },
    async resolve(threadId) {
      return { context: await readConversationTranscript(bb, threadId) };
    },
  });

  bb.rpc.register(conductorRpcContract, {
    async readWorkspaceGitSummaries({ environmentIds }) {
      const summaries = await Promise.all(
        [...new Set(environmentIds)].map(
          async (environmentId): Promise<WorkspaceGitSummary | null> => {
            try {
              const environment = await bb.sdk.environments.get({
                environmentId,
              });
              const mergeBaseBranch =
                environment.mergeBaseBranch ??
                environment.baseBranch ??
                environment.defaultBranch;
              const status = await bb.sdk.environments.status({
                environmentId,
                ...(mergeBaseBranch ? { mergeBaseBranch } : {}),
              });
              if (status.outcome !== "available") {
                return {
                  environmentId,
                  workspacePath: environment.path,
                  gitAvailable: false,
                  aheadCount: 0,
                  behindCount: 0,
                  changedFiles: 0,
                };
              }
              return {
                environmentId,
                workspacePath: environment.path,
                gitAvailable: true,
                aheadCount: status.workspace.mergeBase?.aheadCount ?? 0,
                behindCount: status.workspace.mergeBase?.behindCount ?? 0,
                changedFiles: status.workspace.workingTree.files.length,
              };
            } catch {
              return null;
            }
          },
        ),
      );
      return {
        summaries: summaries.filter(
          (summary): summary is WorkspaceGitSummary => summary !== null,
        ),
      };
    },
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
