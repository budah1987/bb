import type {
  BbPluginApi,
  PluginAgentToolResult,
  PluginCliContext,
} from "@bb/plugin-sdk";
import { z } from "zod";
import {
  addSourceInputSchema,
  caseIdInputSchema,
  createCaseInputSchema,
  ingestionRpcContract,
  publishCaseInputSchema,
  submitDraftInputSchema,
  updateCaseInputSchema,
  type IngestionCase,
} from "./contract.js";
import { registerIngestionCli } from "./cli.js";
import { publishMain } from "./publish-main.js";
import { IngestionStore, migrations } from "./store.js";

export { ingestionRpcContract } from "./contract.js";

export const INGESTION_DESK_VERSION = "0.1.0";

function result(value: unknown): PluginAgentToolResult {
  return JSON.stringify(value, null, 2);
}

function failure(error: unknown): PluginAgentToolResult {
  return {
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

function isNoChangesError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "no_changes"
  );
}

function draftPrompt(caseItem: IngestionCase): string {
  const sources = caseItem.sources
    .map((source) => {
      const body =
        source.content === null
          ? (source.url ?? "")
          : source.content.slice(0, 4_000);
      return `## ${source.label} (${source.kind}, ${source.authority})\n${body}`;
    })
    .join("\n\n");
  return `Ingest this material into the Vault worktree. First call bb_ingestion_get_case with this exact caseId: ${caseItem.id}. Read every captured source in that response. Open linked sources with the available connected source tools. Then inspect the Vault's existing meeting, project, and person conventions. Make the actual Markdown file changes needed for a canonical meeting record and any related indexes or profiles. Preserve source provenance in the generated notes. State uncertainty clearly. Do not commit or push; BB will review and publish the worktree. After the file changes are complete, call bb_ingestion_submit_draft with this exact caseId: ${caseItem.id}, a concise Markdown review summary, and every changed Vault path.\n\nTitle: ${caseItem.title}\n\nSource previews:\n\n${sources}`;
}

async function projectSummaries(bb: BbPluginApi) {
  const projects = await bb.sdk.projects.list();
  return projects.map((project) => ({ id: project.id, name: project.name }));
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info(`Ingestion Desk ${INGESTION_DESK_VERSION} loaded`);
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);
  const store = new IngestionStore(db);

  const changed = (caseItem: IngestionCase) => {
    bb.realtime.publish("ingestion:changed", {
      caseId: caseItem.id,
      projectId: caseItem.projectId,
      status: caseItem.status,
    });
    return caseItem;
  };

  const startDraft = async (
    caseId: string,
    context: { projectId: string; threadId?: string },
  ) => {
    const caseItem = store.get(caseId);
    if (caseItem.projectId !== context.projectId)
      throw new Error("The current project does not own this ingestion case");
    const project = await bb.sdk.projects.get({
      projectId: caseItem.projectId,
    });
    const source =
      project.sources.find((candidate) => candidate.isDefault) ??
      project.sources[0];
    if (!source) throw new Error("The selected project has no Vault source");
    const child = await bb.sdk.threads.spawn({
      projectId: caseItem.projectId,
      parentThreadId: context.threadId,
      environment: {
        type: "host",
        hostId: source.hostId,
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "named", name: "main" },
        },
      },
      title: `Draft ingestion: ${caseItem.title}`,
      prompt: draftPrompt(caseItem),
    });
    return changed(store.beginDraft(caseId, child.id));
  };

  const submitDraft = (
    caseId: string,
    markdown: string,
    outputs: Array<{ path: string; summary: string }>,
    threadId?: string,
  ) =>
    changed(
      store.submitDraft(caseId, {
        markdown,
        outputs,
        ...(threadId === undefined ? {} : { threadId }),
      }),
    );

  const publish = async (caseId: string, preserveLocalChanges = false) => {
    const caseItem = store.markPublishing(caseId, preserveLocalChanges);
    const draftThreadId = caseItem.draft?.draftThreadId;
    if (draftThreadId === null || draftThreadId === undefined)
      return changed(
        store.markGitBlocked(
          caseId,
          "This case has no drafting thread to identify its Vault environment",
        ),
      );
    try {
      const thread = await bb.sdk.threads.get({ threadId: draftThreadId });
      if (!thread.environmentId)
        return changed(
          store.markGitBlocked(
            caseId,
            "The drafting thread has no Vault environment",
          ),
        );
      try {
        await bb.sdk.environments.commit({
          environmentId: thread.environmentId,
        });
      } catch (error) {
        if (!isNoChangesError(error)) throw error;
      }
      const git = await publishMain(bb, {
        environmentId: thread.environmentId,
        preserveLocalChanges,
      });
      return changed(store.markPublished(caseId, git));
    } catch (error) {
      return changed(
        store.markGitBlocked(
          caseId,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  };

  bb.rpc.register(ingestionRpcContract, {
    async bootstrap({ projectId }) {
      return {
        cases: store.listSummaries(projectId),
        projects: await projectSummaries(bb),
      };
    },
    createCase(input) {
      return changed(store.create(input));
    },
    updateCase(input) {
      const { caseId, ...update } = input;
      return changed(store.update(caseId, update));
    },
    addSource(input) {
      return changed(store.appendSource(input.caseId, input.source));
    },
    async startDraft({ caseId }) {
      return startDraft(caseId, { projectId: store.get(caseId).projectId });
    },
    submitDraft(input) {
      return submitDraft(input.caseId, input.markdown, input.outputs);
    },
    refreshCase({ caseId }) {
      return store.get(caseId);
    },
    publishCase({ caseId, preserveLocalChanges }) {
      return publish(caseId, preserveLocalChanges);
    },
  });

  registerIngestionCli({
    bb,
    store,
    startDraft: (caseId: string, context: PluginCliContext) =>
      startDraft(caseId, {
        projectId: context.projectId ?? store.get(caseId).projectId,
        threadId: context.threadId,
      }),
    submitDraft: (caseId, markdown, outputs) =>
      submitDraft(caseId, markdown, outputs),
    publish,
  });

  bb.agents.registerTool({
    name: "bb_ingestion_create_case",
    description:
      "Create a reviewed ingestion case from a meeting or document source.",
    parameters: createCaseInputSchema,
    execute(input) {
      try {
        return result(changed(store.create(input)));
      } catch (error) {
        return failure(error);
      }
    },
  });
  bb.agents.registerTool({
    name: "bb_ingestion_add_source",
    description:
      "Attach another immutable source before an ingestion case starts drafting.",
    parameters: addSourceInputSchema,
    execute(input) {
      try {
        return result(changed(store.appendSource(input.caseId, input.source)));
      } catch (error) {
        return failure(error);
      }
    },
  });
  bb.agents.registerTool({
    name: "bb_ingestion_get_case",
    description:
      "Read an ingestion case and the complete captured contents of every source.",
    parameters: caseIdInputSchema,
    execute(input) {
      try {
        return result(store.get(input.caseId));
      } catch (error) {
        return failure(error);
      }
    },
  });
  bb.agents.registerTool({
    name: "bb_ingestion_submit_draft",
    description:
      "Submit the canonical meeting draft and proposed Vault outputs for the assigned ingestion case.",
    parameters: submitDraftInputSchema,
    execute(input, context) {
      try {
        return result(
          submitDraft(
            input.caseId,
            input.markdown,
            input.outputs,
            context.threadId,
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  });
  bb.agents.registerTool({
    name: "bb_ingestion_publish_case",
    description:
      "Publish a reviewed ingestion case to the Vault main branch. This stops safely when Vault Git parity is blocked.",
    parameters: publishCaseInputSchema,
    async execute(input) {
      try {
        return result(await publish(input.caseId, input.preserveLocalChanges));
      } catch (error) {
        return failure(error);
      }
    },
  });
  bb.agents.configure(() => ({
    tools: [
      "bb_ingestion_create_case",
      "bb_ingestion_add_source",
      "bb_ingestion_get_case",
      "bb_ingestion_submit_draft",
      "bb_ingestion_publish_case",
    ],
    skills: [],
    instructions:
      "Use Ingestion Desk for meeting and document inputs. Submit drafts with bb_ingestion_submit_draft before publication.",
  }));
}
