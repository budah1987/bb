// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));
const { parseBootstrap } = await import("./app");

const bootstrap = {
  projects: [{ id: "vault", name: "Vault" }],
  cases: [
    {
      id: "ing_1",
      projectId: "vault",
      title: "SKU coverage",
      status: "ready",
      summary: "Review SKU ownership and allocation.",
      sources: [
        {
          id: "ingsrc_meet",
          label: "Google Meet transcript",
          kind: "drive_link",
          authority: "primary",
          url: "https://drive.google.com/file/d/1",
          content: null,
          description: "Speaker attribution · Full transcript",
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
          kind: "source",
          message: "Keep Excel-compatible tables.",
          sourceId: "ingsrc_meet",
        },
      ],
      outputs: [
        { path: "meetings/sku-coverage.md", summary: "Canonical meeting" },
        { path: "projects/warehouse2.md", summary: "Project index update" },
      ],
      git: {
        state: "ready",
        localHead: "1820a81",
        remoteHead: "1820a81",
        publishedCommit: null,
        message: null,
      },
    },
  ],
};

afterEach(cleanup);

describe("Ingestion Desk boundary parsing", () => {
  it("rejects malformed source records instead of passing unknown data into the UI", () => {
    expect(() =>
      parseBootstrap({
        ...bootstrap,
        cases: [
          {
            ...bootstrap.cases[0],
            sources: [{ ...bootstrap.cases[0].sources[0], authority: 7 }],
          },
        ],
      }),
    ).toThrow("invalid source");
  });
});

describe("Ingestion Desk panel", () => {
  it("shows provenance and publishes a ready case directly to main", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          bootstrap: () => bootstrap,
          publishCase: () => ({}),
          refreshCase: () => ({}),
        },
      },
    );
    expect(
      await slot.findByRole("heading", { name: "SKU coverage" }),
    ).toBeTruthy();
    expect(slot.getByText("Google Meet transcript")).toBeTruthy();
    expect(slot.getByRole("link", { name: "Open source" })).toHaveProperty(
      "href",
      "https://drive.google.com/file/d/1",
    );
    expect(slot.getByText("Keep Excel-compatible tables.")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Publish to main" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "publishCase",
        input: { caseId: "ing_1", preserveLocalChanges: false },
      }),
    );
  });

  it("captures a Drive link with project context for a new case", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      { rpc: { bootstrap: () => bootstrap, createCase: () => ({}) } },
    );
    await slot.findByRole("heading", { name: "SKU coverage" });
    fireEvent.click(slot.getByRole("button", { name: "Add sources" }));
    fireEvent.change(slot.getByLabelText("Case title"), {
      target: { value: "Buyer workflow" },
    });
    fireEvent.change(slot.getByLabelText("Source label"), {
      target: { value: "Meet notes" },
    });
    fireEvent.change(slot.getByLabelText("Google Drive or Meet link"), {
      target: { value: "https://drive.google.com/file/d/1" },
    });
    fireEvent.change(slot.getByLabelText("Project"), {
      target: { value: "vault" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Add to inbox" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "createCase",
        input: {
          projectId: "vault",
          title: "Buyer workflow",
          source: {
            kind: "drive_link",
            label: "Meet notes",
            authority: "primary",
            url: "https://drive.google.com/file/d/1",
            content: null,
          },
        },
      }),
    );
  });

  it("blocks direct publication when local Vault changes exist", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          bootstrap: () => ({
            ...bootstrap,
            cases: [
              {
                ...bootstrap.cases[0],
                git: {
                  state: "blocked",
                  localHead: "1820a81",
                  remoteHead: "1820a81",
                  publishedCommit: null,
                  message: "Projects/Warehouse2.md has local changes.",
                },
              },
            ],
          }),
        },
      },
    );
    expect((await slot.findAllByText("Needs review")).length).toBeGreaterThan(
      0,
    );
    expect(
      slot
        .getByRole("button", { name: "Publish to main" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("preserves local work before it retries a sync-blocked case", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          bootstrap: () => ({
            ...bootstrap,
            cases: [
              {
                ...bootstrap.cases[0],
                status: "sync_blocked",
                git: {
                  state: "blocked",
                  localHead: "1820a81",
                  remoteHead: "1820a81",
                  publishedCommit: null,
                  message: "Local Vault files need a checkpoint.",
                },
              },
            ],
          }),
          publishCase: () => ({}),
        },
      },
    );
    await slot.findByRole("button", { name: "Preserve and sync" });
    fireEvent.click(slot.getByRole("button", { name: "Preserve and sync" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "publishCase",
        input: { caseId: "ing_1", preserveLocalChanges: true },
      }),
    );
  });

  it("saves corrected meeting details before it returns a case to the inbox", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          bootstrap: () => ({
            ...bootstrap,
            cases: [{ ...bootstrap.cases[0], status: "needs_context" }],
          }),
          updateCase: () => ({}),
        },
      },
    );
    await slot.findByRole("tab", { name: "Details" });
    fireEvent.click(slot.getByRole("tab", { name: "Details" }));
    fireEvent.click(slot.getByRole("button", { name: "Correct details" }));
    fireEvent.change(slot.getByLabelText("Meeting project"), {
      target: { value: "Warehouse3" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Save details" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "updateCase",
        input: expect.objectContaining({
          caseId: "ing_1",
          status: "inbox",
          details: expect.objectContaining({ project: "Warehouse3" }),
        }),
      }),
    );
  });

  it("adds a supporting source to an unpublished case", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          bootstrap: () => ({
            ...bootstrap,
            cases: [{ ...bootstrap.cases[0], status: "inbox" }],
          }),
          addSource: () => ({}),
        },
      },
    );
    await slot.findByRole("button", { name: "Add source" });
    fireEvent.click(slot.getByRole("button", { name: "Add source" }));
    fireEvent.change(slot.getByLabelText("Additional source label"), {
      target: { value: "Granola notes" },
    });
    fireEvent.change(slot.getByLabelText("Additional source content"), {
      target: { value: "Discussed the SKU rollout." },
    });
    fireEvent.click(slot.getByRole("button", { name: "Add source" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "addSource",
        input: {
          caseId: "ing_1",
          source: {
            kind: "drive_link",
            label: "Granola notes",
            authority: "context",
            url: "Discussed the SKU rollout.",
            content: null,
          },
        },
      }),
    );
  });

  it("refreshes the queue when an ingestion event arrives", async () => {
    const bootstrapRpc = vi.fn(() => bootstrap);
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      { rpc: { bootstrap: bootstrapRpc } },
    );
    await slot.findByRole("heading", { name: "SKU coverage" });
    await slot.emitRealtime("ingestion:changed", {
      caseId: "ing_1",
      status: "ready",
    });
    await waitFor(() => expect(bootstrapRpc).toHaveBeenCalledTimes(2));
  });
});
