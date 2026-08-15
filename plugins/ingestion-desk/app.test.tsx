// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));
const { composerSources } = await import("./app");

const briefing = {
  decisions: ["Use SKU-first allocation rows."],
  insights: ["The review table needs an editing mode."],
  actions: [{ action: "Confirm the table fields.", owner: "Spencer Pitts" }],
  risks: ["Bulk editing may hide allocation errors."],
  openQuestions: ["Should buyers edit approved rows?"],
  uncertainties: ["The speaker named Them may be Spencer Pitts."],
  projectEffects: ["Keep Excel-compatible tables."],
};

const readyCase = {
  id: "ing_1",
  projectId: "vault",
  title: "SKU coverage",
  status: "ready" as const,
  summary: "Review SKU ownership and allocation.",
  sources: [
    {
      id: "ingsrc_meet",
      label: "Google Meet transcript",
      kind: "drive_link" as const,
      authority: "primary" as const,
      url: "https://drive.google.com/file/d/1",
      content: null,
      contentLength: null,
      sha256: null,
      description: "https://drive.google.com/file/d/1",
      createdAt: "2026-08-06T10:00:00.000Z",
    },
  ],
  details: {
    date: "2026-08-06",
    project: "Warehouse2",
    attendees: ["Amir", "Spencer Pitts"],
    meetingType: "Working session",
  },
  provenance: [
    {
      id: "ingprov_1",
      kind: "source" as const,
      message: "Added Google Meet transcript",
      sourceId: "ingsrc_meet",
      createdAt: "2026-08-06T10:00:00.000Z",
    },
  ],
  outputs: [
    { path: "40-meetings/2026/sku-coverage.md", summary: "Canonical meeting" },
    { path: "10-projects/warehouse2/_index.md", summary: "Project index update" },
  ],
  draft: {
    markdown: "# SKU coverage\n\nThe team reviewed allocation ownership.",
    briefing,
    outputs: [
      { path: "40-meetings/2026/sku-coverage.md", summary: "Canonical meeting" },
      { path: "10-projects/warehouse2/_index.md", summary: "Project index update" },
    ],
    draftThreadId: "thr_hidden",
    reviewedAt: "2026-08-06T10:03:00.000Z",
  },
  git: {
    state: "ready" as const,
    localHead: "1820a81",
    remoteHead: "1820a81",
    publishedCommit: null,
    message: null,
  },
  createdAt: "2026-08-06T10:00:00.000Z",
  updatedAt: "2026-08-06T10:03:00.000Z",
};

const bootstrap = {
  projects: [{ id: "vault", name: "Vault" }],
  cases: [readyCase],
};

afterEach(cleanup);

describe("Ingestion Desk intake", () => {
  it("groups pasted notes and Drive links into one meeting", () => {
    expect(
      composerSources(
        "Granola notes\n\nhttps://drive.google.com/document/d/1",
        [{ name: "transcript.txt", content: "Transcript text" }],
      ),
    ).toMatchObject([
      { kind: "granola_paste", content: "Granola notes" },
      { kind: "upload", label: "transcript.txt" },
      { kind: "drive_link", url: "https://drive.google.com/document/d/1" },
    ]);
  });

  it("starts complete ingestion from one paste composer", async () => {
    const drafting = { ...readyCase, status: "drafting" as const, draft: null, outputs: [] };
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {
      rpc: {
        bootstrap: () => bootstrap,
        ingestMeeting: () => drafting,
      },
    });
    const composer = await slot.findByLabelText("Meeting material");
    fireEvent.change(composer, {
      target: { value: "Granola notes\nhttps://drive.google.com/document/d/1" },
    });
    fireEvent.change(slot.getByLabelText(/Context/), {
      target: { value: "Spencer discussed warehouse2." },
    });
    fireEvent.click(slot.getByRole("button", { name: "Ingest meeting" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "ingestMeeting",
        input: {
          projectId: "vault",
          context: "Spencer discussed warehouse2.",
          sources: [
            expect.objectContaining({ kind: "granola_paste", content: "Granola notes" }),
            expect.objectContaining({ kind: "drive_link", url: "https://drive.google.com/document/d/1" }),
          ],
        },
      }),
    );
  });

  it("claims focus before a surrounding conversation pane handles the pointer", async () => {
    const conversationInput = document.createElement("textarea");
    document.body.append(conversationInput);
    conversationInput.focus();
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {
      rpc: { bootstrap: () => bootstrap },
    });
    const meetingInput = await slot.findByLabelText("Meeting material");
    fireEvent.pointerDown(meetingInput);
    expect(document.activeElement).toBe(meetingInput);
    conversationInput.remove();
  });
});

describe("Ingestion Desk approval", () => {
  it("leads with the briefing and approves the full Vault package", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {
      rpc: { bootstrap: () => bootstrap, publishCase: () => readyCase },
    });
    fireEvent.click(await slot.findByRole("button", { name: /SKU coverage/ }));
    expect(slot.getByRole("heading", { name: "Meeting briefing" })).toBeTruthy();
    expect(slot.getAllByText("Use SKU-first allocation rows.").length).toBeGreaterThan(0);
    expect(slot.getByText("The speaker named Them may be Spencer Pitts.")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Approve and write" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "publishCase",
        input: { caseId: "ing_1", preserveLocalChanges: false },
      }),
    );
  });

  it("sends inline corrections back to the same meeting task", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {
      rpc: { bootstrap: () => bootstrap, reviseCase: () => readyCase },
    });
    fireEvent.click(await slot.findByRole("button", { name: /SKU coverage/ }));
    fireEvent.change(slot.getByLabelText("Project"), { target: { value: "Warehouse3" } });
    fireEvent.click(slot.getByRole("button", { name: "Apply corrections" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "reviseCase",
        input: expect.objectContaining({
          caseId: "ing_1",
          title: "SKU coverage",
          details: expect.objectContaining({ project: "Warehouse3" }),
        }),
      }),
    );
  });

  it("shows meeting notes and combined insight inside Projects", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {
      rpc: { bootstrap: vi.fn(() => bootstrap) },
    });
    fireEvent.click(await slot.findByRole("tab", { name: "Projects" }));
    expect(slot.getByRole("heading", { name: "Warehouse2" })).toBeTruthy();
    expect(slot.getByRole("heading", { name: "Meeting notes" })).toBeTruthy();
    expect(slot.getAllByText("Use SKU-first allocation rows.").length).toBeGreaterThan(0);
  });
});
