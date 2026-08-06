// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@bb/plugin-sdk/app";

const app = await loadPluginApp(() => import("../app"));
const sidebar = app.threadLists[0];
if (!sidebar) throw new Error("Conductor sidebar was not registered");

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

function thread(
  id: string,
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId: "project-1",
    title: id,
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: {
      id: "environment-1",
      name: "Repository workspace",
      branchName: "feature/sidebar",
      workspaceDisplayKind: "managed-worktree",
    },
    host: null,
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: 1,
    latestAttentionAt: 1,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ConductorSidebar", () => {
  it("shows one-off threads with live attention states and native navigation", async () => {
    let navigated = 0;
    const rendered = renderSlot(
      sidebar,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: true,
        onNavigate: () => (navigated += 1),
        searchQuery: "",
      },
      {
        sidebarThreads: {
          status: "ready",
          projects: [
            { id: "personal", name: "Personal", isPersonal: true },
            { id: "project-1", name: "BB", isPersonal: false },
          ],
          threads: [
            thread("Working one-off", {
              projectId: "personal",
              environment: null,
              createdAt: 3,
              activity: {
                workflows: 0,
                backgroundAgents: 1,
                backgroundCommands: 0,
                planMode: 0,
                goals: 0,
              },
              indicator: "background-agent",
              indicatorLabel: "Background agent working",
            }),
            thread("Dormant one-off", {
              projectId: "personal",
              environment: null,
              createdAt: 2,
            }),
            thread("Repo conversation", { isUnread: true }),
          ],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
          recordReconciliation: () => ({ recorded: false }),
        },
      },
    );

    const threadsSection = await screen.findByRole("region", {
      name: "Threads",
    });
    const repoSection = screen.getByRole("region", { name: "BB" });
    expect(
      repoSection.compareDocumentPosition(threadsSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      screen
        .getByRole("navigation", { name: "BBamir workspaces" })
        .getAttribute("data-compact"),
    ).toBe("true");
    expect(
      screen
        .getByRole("navigation", { name: "BBamir workspaces" })
        .classList.contains("flex-1"),
    ).toBe(true);
    const workingLink = within(threadsSection).getByRole("link", {
      name: "Working one-off",
    });
    expect(
      workingLink.hasAttribute("data-sidebar-thread-shortcut-target"),
    ).toBe(false);
    expect(workingLink.getAttribute("data-sidebar-thread-id")).toBeNull();
    const workspaceButton = within(repoSection).getByRole("button", {
      name: /Repository workspace/u,
    });
    expect(
      workspaceButton.hasAttribute("data-sidebar-thread-shortcut-target"),
    ).toBe(true);
    expect(workspaceButton.getAttribute("data-sidebar-thread-id")).toBe(
      "Repo conversation",
    );
    expect(within(threadsSection).getByText("Working")).toBeDefined();
    expect(within(threadsSection).getByText("Dormant")).toBeDefined();
    expect(
      threadsSection.querySelector(".conductor-pixel-matrix--activity"),
    ).not.toBeNull();
    expect(screen.getByText("Needs attention")).toBeDefined();

    fireEvent.click(workingLink, { metaKey: true });
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "Working one-off",
      options: { split: true },
    });
    expect(navigated).toBe(1);

    fireEvent.click(
      within(threadsSection).getByRole("button", { name: "New thread" }),
    );
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "openNewThread",
      options: { projectId: "personal", focusPrompt: true },
    });
    expect(navigated).toBe(2);

    await waitFor(() => {
      expect(screen.getByText("Repository workspace")).toBeDefined();
    });
  });

  it("renames and requests deletion from a Thread context menu", async () => {
    const rendered = renderSlot(
      sidebar,
      {
        activeThreadId: "Personal one",
        activeProjectId: "personal",
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
      },
      {
        sidebarThreads: {
          status: "ready",
          projects: [{ id: "personal", name: "Personal", isPersonal: true }],
          threads: [
            thread("Personal one", {
              projectId: "personal",
              environment: null,
              createdAt: 2,
            }),
            thread("Personal two", {
              projectId: "personal",
              environment: null,
              createdAt: 1,
            }),
          ],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
          recordReconciliation: () => ({ recorded: false }),
        },
      },
    );

    const row = await screen.findByRole("link", { name: "Personal one" });
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename…" }));
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Conversation name" }),
      { target: { value: "Renamed personal thread" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => {
      expect(rendered.sidebarActionCalls).toContainEqual({
        method: "rename",
        threadId: "Personal one",
        title: "Renamed personal thread",
      });
    });

    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "requestDelete",
      threadId: "Personal one",
      options: { experimental_fallbackThreadId: "Personal two" },
    });
  });

  it("opens Thread actions on a mobile long press", async () => {
    const rendered = renderSlot(
      sidebar,
      {
        activeThreadId: null,
        activeProjectId: "personal",
        isCompactViewport: true,
        onNavigate: () => undefined,
        searchQuery: "",
      },
      {
        sidebarThreads: {
          status: "ready",
          projects: [{ id: "personal", name: "Personal", isPersonal: true }],
          threads: [
            thread("Mobile personal", {
              projectId: "personal",
              environment: null,
            }),
          ],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
          recordReconciliation: () => ({ recorded: false }),
        },
      },
    );

    const row = await screen.findByRole("link", { name: "Mobile personal" });
    vi.useFakeTimers();
    fireEvent.pointerDown(row, {
      pointerType: "touch",
      clientX: 24,
      clientY: 24,
    });
    act(() => vi.advanceTimersByTime(700));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "archive",
      threadId: "Mobile personal",
    });
  });

  it("collapses repositories and Threads while keeping aggregate activity visible", async () => {
    renderSlot(
      sidebar,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
      },
      {
        sidebarThreads: {
          status: "ready",
          projects: [
            { id: "personal", name: "Personal", isPersonal: true },
            { id: "project-1", name: "BB", isPersonal: false },
          ],
          threads: [
            thread("Personal work", {
              projectId: "personal",
              environment: null,
              activity: {
                workflows: 1,
                backgroundAgents: 0,
                backgroundCommands: 0,
                planMode: 0,
                goals: 0,
              },
            }),
            thread("Repo work", {
              activity: {
                workflows: 0,
                backgroundAgents: 1,
                backgroundCommands: 0,
                planMode: 0,
                goals: 0,
              },
            }),
          ],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
          recordReconciliation: () => ({ recorded: false }),
        },
      },
    );

    const repoSection = await screen.findByRole("region", { name: "BB" });
    const repoToggle = repoSection.querySelector<HTMLButtonElement>(
      "button[aria-controls]",
    );
    if (!repoToggle) throw new Error("Repository collapse toggle missing");
    const workspaceButton = within(repoSection).getByRole("button", {
      name: /Repository workspace/u,
    });
    expect(
      workspaceButton.hasAttribute("data-sidebar-thread-shortcut-target"),
    ).toBe(true);
    expect(repoToggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(repoToggle);
    expect(repoToggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      workspaceButton.hasAttribute("data-sidebar-thread-shortcut-target"),
    ).toBe(false);
    const repoContent = document.getElementById(
      repoToggle.getAttribute("aria-controls") ?? "missing",
    );
    expect(repoContent?.getAttribute("aria-hidden")).toBe("true");
    expect(repoToggle.querySelector(".conductor-section-caret")).not.toBeNull();
    expect(repoToggle.querySelector(".conductor-pixel-matrix")).not.toBeNull();

    const threadsSection = screen.getByRole("region", { name: "Threads" });
    const threadsToggle = threadsSection.querySelector<HTMLButtonElement>(
      "button[aria-controls]",
    );
    if (!threadsToggle) throw new Error("Threads collapse toggle missing");
    fireEvent.click(threadsToggle);
    expect(threadsToggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("uses persisted repository order and keeps Threads at the bottom", async () => {
    window.localStorage.setItem(
      "bb.conductor.project-order.v1",
      JSON.stringify(["project-2", "project-1"]),
    );
    renderSlot(
      sidebar,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
      },
      {
        sidebarThreads: {
          status: "ready",
          projects: [
            { id: "personal", name: "Personal", isPersonal: true },
            { id: "project-1", name: "Alpha", isPersonal: false },
            { id: "project-2", name: "Beta", isPersonal: false },
          ],
          threads: [
            thread("Alpha work"),
            thread("Beta work", {
              projectId: "project-2",
              environment: {
                id: "environment-2",
                name: "Beta workspace",
                branchName: "feature/beta",
                workspaceDisplayKind: "managed-worktree",
              },
            }),
            thread("Personal work", {
              projectId: "personal",
              environment: null,
            }),
          ],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
          recordReconciliation: () => ({ recorded: false }),
        },
      },
    );

    const beta = await screen.findByRole("region", { name: "Beta" });
    const alpha = screen.getByRole("region", { name: "Alpha" });
    const threads = screen.getByRole("region", { name: "Threads" });
    expect(
      beta.compareDocumentPosition(alpha) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      alpha.compareDocumentPosition(threads) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(screen.getByRole("button", { name: "Reorder Beta" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Reorder Alpha" })).toBeDefined();
    expect(
      within(threads).queryByRole("button", { name: /Reorder/u }),
    ).toBeNull();
  });

  it("offers separate sidebar, branch, and folder rename actions for worktrees", async () => {
    const renameWorkspace = vi.fn(() => ({ renamed: true as const }));
    renderSlot(
      sidebar,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
      },
      {
        sidebarThreads: {
          status: "ready",
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
          threads: [thread("Repo work")],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
          recordReconciliation: () => ({ recorded: false }),
          readWorkspaceRenameDetails: () => ({
            displayName: "Repository workspace",
            branchName: "feature/sidebar",
            folderName: "sidebar-worktree",
          }),
          renameWorkspace,
        },
      },
    );

    const workspace = await screen.findByRole("button", {
      name: /Repository workspace/u,
    });
    fireEvent.contextMenu(workspace);
    expect(
      await screen.findByRole("menuitem", { name: "Rename branch…" }),
    ).toBeDefined();
    expect(
      screen.getByRole("menuitem", { name: "Rename folder…" }),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Rename sidebar label…" }),
    );

    const input = await screen.findByRole("textbox", { name: "Sidebar label" });
    fireEvent.change(input, { target: { value: "Focused workspace" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => {
      expect(renameWorkspace).toHaveBeenCalledWith({
        environmentId: "environment-1",
        scope: "display",
        value: "Focused workspace",
      });
    });
  });
});
