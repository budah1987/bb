import type {
  BbPluginApi,
  PluginAgentToolResult,
  PluginCliContext,
} from "@get-bb/plugin-sdk";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  addSourceInputSchema,
  bootstrapInputSchema,
  bootstrapOutputSchema,
  caseIdInputSchema,
  createCaseInputSchema,
  ingestMeetingInputSchema,
  ingestionCaseSchema,
  publishCaseInputSchema,
  reviseCaseInputSchema,
  submitDraftInputSchema,
  updateCaseInputSchema,
  type IngestionCase,
} from "./contract.js";
import { registerIngestionCli } from "./cli.js";
import { publishMain } from "./publish-main.js";
import { IngestionStore, migrations } from "./store.js";

export const ingestionRpcContract = defineRpcContract({
  bootstrap: { input: bootstrapInputSchema, output: bootstrapOutputSchema },
  ingestMeeting: {
    input: ingestMeetingInputSchema,
    output: ingestionCaseSchema,
  },
  createCase: { input: createCaseInputSchema, output: ingestionCaseSchema },
  updateCase: { input: updateCaseInputSchema, output: ingestionCaseSchema },
  addSource: { input: addSourceInputSchema, output: ingestionCaseSchema },
  startDraft: { input: caseIdInputSchema, output: ingestionCaseSchema },
  submitDraft: { input: submitDraftInputSchema, output: ingestionCaseSchema },
  reviseCase: { input: reviseCaseInputSchema, output: ingestionCaseSchema },
  refreshCase: { input: caseIdInputSchema, output: ingestionCaseSchema },
  publishCase: { input: publishCaseInputSchema, output: ingestionCaseSchema },
});

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
  return `Process this meeting inside Ingestion Desk. This hidden task must replace the old Meeting Ingestion task. First call bb_ingestion_get_case with this exact caseId: ${caseItem.id}. Read every captured source. Treat Granola notes and transcripts as one meeting. Open Google Drive links with connected Google Drive tools. Use GitHub links as project context. Inspect the Vault's meeting, project, person, and synthesis conventions. Infer the meeting title, date, Vault project, people, meeting type, and speaker names. State every uncertainty clearly. Create the full Vault package: verbatim raw sources, canonical synthesis, project links and indexes, people updates, project guidance, and synthesis log updates. Do not commit or push. Then call bb_ingestion_submit_draft once with this exact caseId: ${caseItem.id}. Supply the inferred title, summary, details, structured briefing, review Markdown, and every changed Vault path. The briefing must include decisions, insights, actions with owners, risks, open questions, uncertainties, and project effects.\n\nOptional user context:\n${caseItem.summary || "None provided"}\n\nSource previews:\n\n${sources}`;
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
      visibility: "hidden",
      prompt: draftPrompt(caseItem),
    });
    return changed(store.beginDraft(caseId, child.id));
  };

  const submitDraft = (
    input: Parameters<IngestionStore["submitDraft"]>[1] & { caseId: string },
    threadId?: string,
  ) =>
    changed(
      store.submitDraft(input.caseId, {
        title: input.title,
        summary: input.summary,
        details: input.details,
        markdown: input.markdown,
        briefing: input.briefing,
        outputs: input.outputs,
        ...(threadId === undefined ? {} : { threadId }),
      }),
    );

  const ingestMeeting = async (input: {
    projectId: string | null;
    context: string;
    sources: Parameters<IngestionStore["createMeeting"]>[0]["sources"];
  }) => {
    const projects = await projectSummaries(bb);
    const projectId = input.projectId ?? projects[0]?.id;
    if (projectId === undefined)
      throw new Error("Add a BB project with a Vault source before ingestion");
    if (!projects.some((project) => project.id === projectId))
      throw new Error("The selected BB project is unavailable");
    const created = changed(
      store.createMeeting({
        projectId,
        context: input.context,
        sources: input.sources,
      }),
    );
    return startDraft(created.id, { projectId });
  };

  const revise = async (
    caseId: string,
    input: { title: string; details: IngestionCase["details"] },
  ) => {
    const existing = store.get(caseId);
    const threadId = existing.draft?.draftThreadId;
    if (threadId === null || threadId === undefined)
      throw new Error("This meeting has no processing task");
    const revising = changed(store.beginRevision(caseId, input));
    await bb.sdk.threads.send({
      threadId,
      mode: "auto",
      input: [
        {
          type: "text",
          mentions: [],
          text: `Apply these approved corrections to every proposed Vault file. Then call bb_ingestion_submit_draft again with a fully updated briefing and output list.\n\nTitle: ${input.title}\nDate: ${input.details.date ?? "Unknown"}\nVault project: ${input.details.project ?? "Unknown"}\nPeople: ${input.details.attendees.join(", ") || "Unknown"}\nMeeting type: ${input.details.meetingType ?? "Unknown"}`,
        },
      ],
    });
    return revising;
  };

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
    ingestMeeting,
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
      return submitDraft(input);
    },
    reviseCase(input) {
      return revise(input.caseId, {
        title: input.title,
        details: input.details,
      });
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
    ingestMeeting,
    submitDraft: (caseId, markdown, outputs) => {
      const existing = store.get(caseId);
      return submitDraft({
        caseId,
        title: existing.title,
        summary: existing.summary || "Meeting ingestion draft",
        details: existing.details,
        markdown,
        briefing: {
          decisions: [],
          insights: [],
          actions: [],
          risks: [],
          openQuestions: [],
          uncertainties: [],
          projectEffects: [],
        },
        outputs,
      });
    },
    publish,
  });

  bb.agents.registerTool({
    name: "bb_ingestion_ingest_meeting",
    description:
      "Start one complete meeting ingestion from unclassified notes, transcripts, files, or links.",
    parameters: ingestMeetingInputSchema,
    async execute(input) {
      try {
        return result(await ingestMeeting(input));
      } catch (error) {
        return failure(error);
      }
    },
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
        return result(submitDraft(input, context.threadId));
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
      "bb_ingestion_ingest_meeting",
      "bb_ingestion_create_case",
      "bb_ingestion_add_source",
      "bb_ingestion_get_case",
      "bb_ingestion_submit_draft",
      "bb_ingestion_publish_case",
    ],
    skills: [],
    instructions:
      "Use bb_ingestion_ingest_meeting for new meeting material. Ingestion Desk handles review and publication.",
  }));
}
