import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import { bootstrapOutputSchema, ingestionCaseSchema } from "./contract.js";

function draftInput(caseId: string, markdown = "# Plan") {
  return {
    caseId,
    title: "Planning meeting",
    summary: "The team agreed on the publishing plan.",
    details: {
      date: "2026-08-06",
      project: "Warehouse2",
      attendees: ["Amir", "Spencer Pitts"],
      meetingType: "Working session",
    },
    markdown,
    briefing: {
      decisions: ["Publish after review."],
      insights: ["The project needs one canonical meeting record."],
      actions: [{ action: "Publish the plan.", owner: "Amir" }],
      risks: [],
      openQuestions: [],
      uncertainties: [],
      projectEffects: ["Add the decision to project guidance."],
    },
    outputs: [{ path: "meetings/plan.md", summary: "Canonical note" }],
  };
}

describe("Ingestion Desk", () => {
  const hosts: Array<ReturnType<typeof createFakePluginHost>["harness"]> = [];

  afterEach(async () => {
    await Promise.all(hosts.map((host) => host.dispose()));
    hosts.length = 0;
  });

  async function createHarness() {
    const { bb, harness } = createFakePluginHost({
      pluginId: "ingestion-desk",
      sdk: {
        projects: {
          list: async () => [{ id: "proj_vault", name: "Vault" }],
          get: async () =>
            ({
              id: "proj_vault",
              name: "Vault",
              sources: [
                {
                  id: "source_vault",
                  hostId: "host_vault",
                  isDefault: true,
                  type: "local_path",
                  path: "/Vault",
                },
              ],
            }) as never,
        },
        threads: {
          spawn: async () => ({ id: "thr_draft" }) as never,
          send: async () => ({ ok: true }) as never,
          get: async () =>
            ({ id: "thr_draft", environmentId: "env_vault" }) as never,
        },
      },
    });
    hosts.push(harness);
    await plugin(bb);
    return harness;
  }

  it("creates a case, preserves its source, and rejects duplicates", async () => {
    const harness = await createHarness();
    const created = ingestionCaseSchema.parse(
      await harness.callRpc("createCase", {
        projectId: "proj_vault",
        title: "Warehouse review",
        source: {
          kind: "pasted",
          label: "Meeting notes",
          authority: "primary",
          url: null,
          content: "Decide the owner for inventory reconciliation.",
        },
      }),
    );
    expect(created.status).toBe("inbox");
    expect(created.sources).toMatchObject([
      { label: "Meeting notes", authority: "primary" },
    ]);
    await expect(
      harness.callRpc("addSource", {
        caseId: created.id,
        source: {
          kind: "pasted",
          label: "Duplicate notes",
          authority: "context",
          url: null,
          content: "Decide the owner for inventory reconciliation.",
        },
      }),
    ).rejects.toThrow(/already attached/i);
  });

  it("starts one hidden processing task for a complete meeting intake", async () => {
    const harness = await createHarness();
    const meeting = ingestionCaseSchema.parse(
      await harness.callRpc("ingestMeeting", {
        projectId: "proj_vault",
        context: "Spencer discussed the Warehouse2 allocation table.",
        sources: [
          {
            kind: "granola_paste",
            label: "Granola notes",
            authority: "primary",
            url: null,
            content: "Enhanced notes",
          },
          {
            kind: "pasted",
            label: "Transcript",
            authority: "primary",
            url: null,
            content: "Meeting transcript",
          },
        ],
      }),
    );
    expect(meeting).toMatchObject({
      status: "drafting",
      summary: "Spencer discussed the Warehouse2 allocation table.",
    });
    expect(meeting.sources.map((source) => source.label).sort()).toEqual([
      "Granola notes",
      "Transcript",
    ]);
    expect(harness.sdk.callsTo("threads.spawn")).toHaveLength(1);
    expect(harness.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({
      visibility: "hidden",
      projectId: "proj_vault",
    });
  });

  it("runs drafting through a child thread and accepts only that thread's draft", async () => {
    const harness = await createHarness();
    const created = ingestionCaseSchema.parse(
      await harness.callRpc("createCase", {
        projectId: "proj_vault",
        title: "Planning meeting",
        source: {
          kind: "pasted",
          label: "Transcript",
          authority: "primary",
          url: null,
          content: "Amir will publish the plan.",
        },
      }),
    );
    const caseResult = await harness.callAgentTool("bb_ingestion_get_case", {
      caseId: created.id,
    });
    expect(JSON.parse(caseResult as string)).toMatchObject({
      sources: [{ content: "Amir will publish the plan." }],
    });
    const drafting = await harness.callRpc("startDraft", {
      caseId: created.id,
    });
    expect(drafting).toMatchObject({
      status: "drafting",
      draft: { draftThreadId: "thr_draft" },
    });
    await expect(
      harness.callRpc("addSource", {
        caseId: created.id,
        source: {
          kind: "pasted",
          label: "Late notes",
          authority: "context",
          url: null,
          content: "This source arrived after drafting.",
        },
      }),
    ).rejects.toThrow(/before drafting starts/i);
    expect(harness.sdk.callsTo("threads.spawn")).toHaveLength(1);
    expect(harness.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({
      visibility: "hidden",
      environment: {
        type: "host",
        hostId: "host_vault",
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "named", name: "main" },
        },
      },
    });
    await expect(
      harness.runCli([
        "submit-draft",
        created.id,
        "--markdown",
        "# Plan",
        "--json",
      ]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stdout: expect.stringMatching(/changed Vault path/i),
    });
    const rejected = await harness.callAgentTool(
      "bb_ingestion_submit_draft",
      draftInput(created.id),
      { threadId: "thr_other" },
    );
    expect(rejected).toMatchObject({ isError: true });
    const submitted = await harness.callAgentTool(
      "bb_ingestion_submit_draft",
      draftInput(created.id),
      { threadId: "thr_draft" },
    );
    const publishedDraft = JSON.parse(submitted as string) as {
      status: string;
      outputs: Array<{ path: string }>;
    };
    expect(publishedDraft).toMatchObject({
      status: "ready",
      title: "Planning meeting",
      details: { project: "Warehouse2" },
      outputs: [{ path: "meetings/plan.md" }],
    });
  });

  it("sends approved corrections back through the same hidden task", async () => {
    const harness = await createHarness();
    const drafting = ingestionCaseSchema.parse(
      await harness.callRpc("ingestMeeting", {
        projectId: "proj_vault",
        context: "",
        sources: [
          {
            kind: "granola_paste",
            label: "Granola notes",
            authority: "primary",
            url: null,
            content: "Meeting notes",
          },
        ],
      }),
    );
    await harness.callAgentTool(
      "bb_ingestion_submit_draft",
      draftInput(drafting.id),
      { threadId: "thr_draft" },
    );
    await expect(
      harness.callRpc("reviseCase", {
        caseId: drafting.id,
        title: "Corrected allocation review",
        details: {
          date: "2026-08-07",
          project: "Warehouse3",
          attendees: ["Amir", "Spencer Pitts"],
          meetingType: "Working session",
        },
      }),
    ).resolves.toMatchObject({ status: "drafting" });
    expect(harness.sdk.callsTo("threads.send")).toHaveLength(1);
    expect(harness.sdk.callsTo("threads.send")[0]?.[0]).toMatchObject({
      threadId: "thr_draft",
      mode: "auto",
    });
  });

  it("reports Git parity as blocked when the Vault worktree has no publishable commit", async () => {
    const harness = await createHarness();
    const created = ingestionCaseSchema.parse(
      await harness.callRpc("createCase", {
        projectId: "proj_vault",
        title: "Decision record",
        source: {
          kind: "pasted",
          label: "Notes",
          authority: "primary",
          url: null,
          content: "Use direct main publishing.",
        },
      }),
    );
    await harness.callRpc("startDraft", { caseId: created.id });
    await harness.callAgentTool(
      "bb_ingestion_submit_draft",
      {
        ...draftInput(created.id, "# Decision"),
        outputs: [{ path: "decisions/direct-main.md", summary: "Decision" }],
      },
      { threadId: "thr_draft" },
    );
    const blocked = await harness.callRpc("publishCase", {
      caseId: created.id,
    });
    expect(blocked).toMatchObject({
      status: "sync_blocked",
      git: { state: "blocked" },
    });
    harness.sdk.stub("environments.commit", async () => {
      throw Object.assign(new Error("No changes to commit"), {
        code: "no_changes",
      });
    });
    harness.sdk.stub("environments.publishToMain", async () => ({
      ok: true,
      action: "publish_to_main",
      message: "Published after checkpointing local changes",
      sourceBranch: "bb/ingestion",
      targetBranch: "main",
      sourceCommitSha: "draft_commit_2",
      remoteTargetBeforeSha: "before",
      remoteTargetAfterSha: "merge_commit_2",
      localTargetBeforeSha: "before",
      localTargetAfterSha: "merge_commit_2",
    }));
    await expect(
      harness.callRpc("publishCase", {
        caseId: created.id,
        preserveLocalChanges: true,
      }),
    ).resolves.toMatchObject({
      status: "published",
      git: { publishedCommit: "merge_commit_2" },
    });
    expect(harness.sdk.callsTo("environments.publishToMain").at(-1)).toEqual([
      { environmentId: "env_vault", preserveTargetChanges: true },
    ]);
  });

  it("publishes already-committed drafting work to main", async () => {
    const harness = await createHarness();
    harness.sdk.stub("environments.commit", async () => {
      throw Object.assign(new Error("No changes to commit"), {
        code: "no_changes",
      });
    });
    harness.sdk.stub("environments.publishToMain", async () => ({
      ok: true,
      action: "publish_to_main",
      message: "Published to main",
      sourceBranch: "bb/ingestion",
      targetBranch: "main",
      sourceCommitSha: "commit_1",
      remoteTargetBeforeSha: "before",
      remoteTargetAfterSha: "commit_1",
      localTargetBeforeSha: "before",
      localTargetAfterSha: "commit_1",
    }));
    const created = ingestionCaseSchema.parse(
      await harness.callRpc("createCase", {
        projectId: "proj_vault",
        title: "Publish decision",
        source: {
          kind: "pasted",
          label: "Notes",
          authority: "primary",
          url: null,
          content: "Publish after review.",
        },
      }),
    );
    await harness.callRpc("startDraft", { caseId: created.id });
    await harness.callAgentTool(
      "bb_ingestion_submit_draft",
      {
        ...draftInput(created.id, "# Decision"),
        outputs: [{ path: "decisions/publish.md", summary: "Decision" }],
      },
      { threadId: "thr_draft" },
    );
    await expect(
      harness.callRpc("publishCase", { caseId: created.id }),
    ).resolves.toMatchObject({
      status: "published",
      git: {
        state: "published",
        publishedCommit: "commit_1",
        localHead: "commit_1",
        remoteHead: "commit_1",
      },
    });
    expect(harness.sdk.callsTo("environments.commit")).toEqual([
      [{ environmentId: "env_vault" }],
    ]);
    expect(harness.sdk.callsTo("environments.publishToMain")).toEqual([
      [{ environmentId: "env_vault", preserveTargetChanges: false }],
    ]);
  });

  it("lists cases and projects through bootstrap", async () => {
    const harness = await createHarness();
    await harness.callRpc("createCase", {
      projectId: "proj_vault",
      title: "Shared document",
      source: {
        kind: "drive_link",
        label: "Drive doc",
        authority: "context",
        url: "https://drive.google.com/example",
        content: null,
      },
    });
    await expect(
      harness.callRpc("bootstrap", { projectId: "proj_vault" }),
    ).resolves.toMatchObject({
      projects: [{ id: "proj_vault", name: "Vault" }],
      cases: [{ title: "Shared document" }],
    });
  });

  it("keeps captured source text out of queue summaries", async () => {
    const harness = await createHarness();
    await harness.callRpc("createCase", {
      projectId: "proj_vault",
      title: "Meeting transcript",
      source: {
        kind: "pasted",
        label: "Transcript",
        authority: "primary",
        url: null,
        content: "A captured meeting transcript.",
      },
    });

    const bootstrap = bootstrapOutputSchema.parse(
      await harness.callRpc("bootstrap", { projectId: "proj_vault" }),
    );
    expect(bootstrap.cases[0]?.sources[0]).toMatchObject({
      content: null,
      contentLength: 30,
      description: "30 characters captured",
    });
  });
});
