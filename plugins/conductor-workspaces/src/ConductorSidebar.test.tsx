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
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

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
  it("selects repositories and moves them into an empty Space", async () => {
    const moveProject = vi.fn();
    const moveProjects = vi.fn();
    renderSlot(
      sidebar,
      {
        activeThreadId: null,
        activeProjectId: null,
        experimental_spaces: {
          activeSpaceId: "space-empty",
          spaces: [
            { id: "space-main", name: "Main", projectIds: ["project-1"] },
            { id: "space-empty", name: "Planning", projectIds: [] },
          ],
          moveProject,
          moveProjects,
        },
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
      },
      {
        sidebarThreads: {
          status: "ready",
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
          threads: [thread("Repository conversation")],
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

    expect(
      await screen.findByRole("heading", {
        name: "This Space has no repositories",
      }),
    ).toBeDefined();
    expect(screen.queryByRole("region", { name: "BB" })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: /BB.*From Main/u }));
    fireEvent.click(screen.getByRole("button", { name: "Move 1 repository" }));
    expect(moveProjects).toHaveBeenCalledWith(["project-1"], "space-empty");
    expect(moveProject).not.toHaveBeenCalled();
  });

  it("selects all available repositories for one batch move", async () => {
    const moveProjects = vi.fn();
    renderSlot(
      sidebar,
      {
        activeThreadId: null,
        activeProjectId: null,
        experimental_spaces: {
          activeSpaceId: "space-empty",
          spaces: [
            {
              id: "space-main",
              name: "Main",
              projectIds: ["project-1", "project-2"],
            },
            { id: "space-empty", name: "Planning", projectIds: [] },
          ],
          moveProject: vi.fn(),
          moveProjects,
        },
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
      },
      {
        sidebarThreads: {
          status: "ready",
          projects: [
            { id: "project-1", name: "BB", isPersonal: false },
            { id: "project-2", name: "Vault", isPersonal: false },
          ],
          threads: [
            thread("BB conversation"),
            thread("Vault conversation", {
              projectId: "project-2",
              environment: {
                id: "environment-2",
                name: "Vault workspace",
                branchName: "feature/vault",
                workspaceDisplayKind: "managed-worktree",
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

    fireEvent.click(await screen.findByRole("button", { name: "Select all" }));
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Move 2 repositories" }),
    );
    expect(moveProjects).toHaveBeenCalledWith(
      ["project-1", "project-2"],
      "space-empty",
    );
  });

  it("moves a repository from its right-click menu", async () => {
    const moveProject = vi.fn();
    renderSlot(
      sidebar,
      {
        activeThreadId: null,
        activeProjectId: null,
        experimental_spaces: {
          activeSpaceId: "space-main",
          spaces: [
            { id: "space-main", name: "Main", projectIds: ["project-1"] },
            { id: "space-planning", name: "Planning", projectIds: [] },
          ],
          moveProject,
          moveProjects: vi.fn(),
        },
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
      },
      {
        sidebarThreads: {
          status: "ready",
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
          threads: [thread("Repository conversation")],
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

    const project = await screen.findByRole("region", { name: "BB" });
    fireEvent.contextMenu(within(project).getByRole("button", { name: "BB" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move to Space" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Planning" }));
    expect(moveProject).toHaveBeenCalledWith("project-1", "space-planning");
  });

  it("shows live Git and pull request details on workspace cards", async () => {
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
          threads: [thread("Repo conversation")],
        },
        sidebarPullRequests: {
          "Repo conversation": {
            number: 82,
            title: "Restore workspace Git details",
            url: "https://github.com/budah1987/bb/pull/82",
            state: "open",
            attention: "ready_to_merge",
          },
        },
        rpc: {
          readWorkspaceGitSummaries: () => ({
            summaries: [
              {
                environmentId: "environment-1",
                workspacePath: "/worktrees/sidebar",
                gitAvailable: true,
                aheadCount: 2,
                behindCount: 1,
                changedFiles: 4,
              },
            ],
          }),
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
          recordReconciliation: () => ({ recorded: false }),
        },
      },
    );

    const card = await screen.findByRole("button", {
      name: /feature\/sidebar.*↑2.*↓1.*4 changes.*PR #82 ✓/u,
    });
    expect(within(card).getByText("feature/sidebar")).toBeDefined();
    expect(within(card).getByText("↑2 ↓1")).toBeDefined();
    expect(within(card).getByText("4 changes")).toBeDefined();
    expect(within(card).getByText("PR #82 ✓")).toBeDefined();
    const metadata = card.querySelector(".conductor-workspace-meta");
    expect(metadata).not.toBeNull();
    expect(metadata?.querySelector(".conductor-status-label")).toBeNull();
    expect(metadata?.querySelectorAll("svg")).toHaveLength(1);
    expect(metadata?.querySelector('[data-kind="branch"] svg')).not.toBeNull();
  });

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
            thread("Idle one-off", {
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
    expect(repoSection.getAttribute("data-expanded")).toBe("true");
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
    expect(
      within(threadsSection).queryByText("Dormant", { exact: true }),
    ).toBeNull();
    expect(
      threadsSection.querySelector(".conductor-pixel-matrix--working"),
    ).not.toBeNull();
    const readyLabel = screen.getByText("Ready");
    expect(readyLabel.className).toContain("conductor-status-label");
    expect(readyLabel.getAttribute("data-signal")).toBe("ready");
    expect(readyLabel.parentElement?.className).toContain(
      "conductor-workspace-meta",
    );
    expect(readyLabel.parentElement?.firstElementChild).toBe(readyLabel);
    expect(screen.queryByText("Needs attention")).toBeNull();

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

  it("lifts a pinned workspace into Focus without duplicating it", async () => {
    const rendered = renderSlot(
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
          threads: [thread("Focused conversation", { isPinned: true })],
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

    const focus = await screen.findByRole("region", { name: "Focus" });
    expect(within(focus).getByText("Repository workspace")).toBeDefined();
    expect(screen.queryByRole("region", { name: "BB" })).toBeNull();

    const focusToggle = within(focus).getByRole("button", { name: "Focus" });
    fireEvent.click(focusToggle);
    expect(focusToggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      document
        .getElementById(
          focusToggle.getAttribute("aria-controls") ?? "missing-focus",
        )
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    fireEvent.click(focusToggle);

    fireEvent.contextMenu(
      within(focus).getByRole("button", { name: /Repository workspace/u }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Remove from Focus" }),
    );
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "setPinned",
      threadId: "Focused conversation",
      pinned: false,
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
              lastReadAt: 2,
              latestAttentionAt: 1,
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as read" }));
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "setRead",
      threadId: "Mobile personal",
      read: true,
    });
  });

  it("shows safe workspace actions on local checkouts without worktree renames", async () => {
    const rendered = renderSlot(
      sidebar,
      {
        activeThreadId: null,
        activeProjectId: "project-1",
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
      },
      {
        sidebarThreads: {
          status: "ready",
          projects: [{ id: "project-1", name: "Ghost", isPersonal: false }],
          threads: [
            thread("Branch workspace", {
              lastReadAt: 2,
              latestAttentionAt: 1,
              environment: {
                id: "environment-branch",
                name: "budah1987/user-activation-fix",
                branchName: "budah1987/user-activation-fix",
                workspaceDisplayKind: "other",
              },
            }),
          ],
        },
        rpc: {
          readWorkspaceGitSummaries: () => ({
            summaries: [
              {
                environmentId: "environment-branch",
                workspacePath: "/repos/ghost",
                gitAvailable: true,
                aheadCount: 0,
                behindCount: 0,
                changedFiles: 0,
              },
            ],
          }),
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
          recordReconciliation: () => ({ recorded: false }),
        },
      },
    );

    fireEvent.contextMenu(
      await screen.findByRole("button", {
        name: /budah1987\/user-activation-fix/u,
      }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Open workspace" }),
    ).toBeDefined();
    expect(
      screen.getByRole("menuitem", { name: "Open in split" }),
    ).toBeDefined();
    expect(
      screen.getByRole("menuitem", { name: "New conversation" }),
    ).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeDefined();
    expect(
      screen.getByRole("menuitem", { name: "Rename sidebar label…" }),
    ).toBeDefined();
    expect(
      screen.getByRole("menuitem", { name: "Archive workspace" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("menuitem", { name: /Rename branch/u }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: /Rename folder/u }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in split" }));

    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "Branch workspace",
      options: { split: true },
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
    const betaToggle = beta.querySelector<HTMLButtonElement>(
      "button[aria-controls]",
    );
    const alphaToggle = alpha.querySelector<HTMLButtonElement>(
      "button[aria-controls]",
    );
    expect(betaToggle?.getAttribute("aria-roledescription")).toBe("sortable");
    expect(alphaToggle?.getAttribute("aria-roledescription")).toBe("sortable");
    expect(screen.queryByRole("button", { name: /Reorder/u })).toBeNull();
    expect(
      within(threads).queryByRole("button", { name: /Reorder/u }),
    ).toBeNull();
  });

  it("uses persisted workspace order within each repository", async () => {
    window.localStorage.setItem(
      "bb.conductor.workspace-order.v1",
      JSON.stringify({
        "project-1": ["project-1:environment-2", "project-1:environment-1"],
      }),
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
          projects: [{ id: "project-1", name: "Alpha", isPersonal: false }],
          threads: [
            thread("Alpha workspace", {
              environment: {
                id: "environment-1",
                name: "Alpha workspace",
                branchName: "feature/alpha",
                workspaceDisplayKind: "managed-worktree",
              },
            }),
            thread("Beta workspace", {
              environment: {
                id: "environment-2",
                name: "Beta workspace",
                branchName: "feature/beta",
                workspaceDisplayKind: "managed-worktree",
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

    const repository = await screen.findByRole("region", { name: "Alpha" });
    const beta = within(repository).getByRole("button", {
      name: /Beta workspace/u,
    });
    const alpha = within(repository).getByRole("button", {
      name: /Alpha workspace/u,
    });
    expect(
      beta.compareDocumentPosition(alpha) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(beta.getAttribute("aria-roledescription")).toBe("sortable");
    expect(
      within(repository).queryByTitle("Reorder Beta workspace"),
    ).toBeNull();
  });

  it("jumps to visible workspaces with Command+1-9, skipping collapsed sections", async () => {
    let navigated = 0;
    const rendered = renderSlot(
      sidebar,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => (navigated += 1),
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
            thread("Alpha newest", {
              updatedAt: 30,
              environment: {
                id: "environment-1a",
                name: "Alpha newest workspace",
                branchName: "feature/newest",
                workspaceDisplayKind: "managed-worktree",
              },
            }),
            thread("Alpha older", {
              updatedAt: 20,
              environment: {
                id: "environment-1b",
                name: "Alpha older workspace",
                branchName: "feature/older",
                workspaceDisplayKind: "managed-worktree",
              },
            }),
            thread("Beta one", {
              projectId: "project-2",
              updatedAt: 10,
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

    const alpha = await screen.findByRole("region", { name: "Alpha" });
    const competingHandler = vi.fn();
    window.addEventListener("keydown", competingHandler);

    // Digits follow the rendered workspace order across repositories.
    fireEvent.keyDown(window, { key: "2", code: "Digit2", metaKey: true });
    expect(rendered.sidebarActionCalls.at(-1)).toEqual({
      method: "open",
      threadId: "Alpha older",
      options: undefined,
    });

    // Command+9 reaches the last visible workspace.
    fireEvent.keyDown(window, { key: "9", code: "Digit9", metaKey: true });
    expect(rendered.sidebarActionCalls.at(-1)).toEqual({
      method: "open",
      threadId: "Beta one",
      options: undefined,
    });

    // A digit without a matching workspace is consumed, not forwarded to the
    // app-level thread-jump binding.
    const callCount = rendered.sidebarActionCalls.length;
    fireEvent.keyDown(window, { key: "5", code: "Digit5", metaKey: true });
    expect(rendered.sidebarActionCalls.length).toBe(callCount);

    // Collapsing a repository removes its workspaces from the digit order.
    const alphaToggle = alpha.querySelector<HTMLButtonElement>(
      "button[aria-controls]",
    );
    if (!alphaToggle) throw new Error("Alpha collapse toggle missing");
    fireEvent.click(alphaToggle);
    fireEvent.keyDown(window, { key: "1", code: "Digit1", metaKey: true });
    expect(rendered.sidebarActionCalls.at(-1)).toEqual({
      method: "open",
      threadId: "Beta one",
      options: undefined,
    });

    window.removeEventListener("keydown", competingHandler);
    expect(competingHandler).not.toHaveBeenCalled();
    expect(navigated).toBeGreaterThan(0);
  });

  it("reveals workspace jump shortcuts while the chord modifier is held", async () => {
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
          ],
          threads: [
            thread("Alpha newest", {
              updatedAt: 30,
              environment: {
                id: "environment-1a",
                name: "Alpha newest workspace",
                branchName: "feature/newest",
                workspaceDisplayKind: "managed-worktree",
              },
            }),
            thread("Alpha older", {
              updatedAt: 20,
              environment: {
                id: "environment-1b",
                name: "Alpha older workspace",
                branchName: "feature/older",
                workspaceDisplayKind: "managed-worktree",
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

    // jsdom is not a Mac platform, so the chord modifier is Control.
    const row = await screen.findByRole("button", {
      name: /Alpha newest workspace/u,
    });
    expect(row.getAttribute("aria-keyshortcuts")).toBe("Control+1");
    expect(screen.queryByText("Ctrl + 1")).toBeNull();

    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByText("Ctrl + 1")).toBeDefined();
    expect(screen.getByText("Ctrl + 2")).toBeDefined();

    fireEvent.keyUp(window, { key: "Control" });
    expect(screen.queryByText("Ctrl + 1")).toBeNull();
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

  it("requires confirmation before archiving a workspace with uncommitted work", async () => {
    const archiveWorkspace = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "confirmation_required" as const })
      .mockResolvedValueOnce({
        outcome: "archived" as const,
        archivedThreadIds: ["Repo work"],
      });
    renderSlot(
      sidebar,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: true,
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
          archiveWorkspace,
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
          recordReconciliation: () => ({ recorded: false }),
        },
      },
    );

    const workspace = await screen.findByRole("button", {
      name: /Repository workspace/u,
    });
    fireEvent.contextMenu(workspace);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Archive workspace" }),
    );

    expect(
      await screen.findByRole("dialog", {
        name: "Archive workspace with uncommitted work?",
      }),
    ).toBeDefined();
    expect(archiveWorkspace).toHaveBeenNthCalledWith(1, {
      environmentId: "environment-1",
      confirmUncommittedChanges: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Archive anyway" }));
    await waitFor(() => {
      expect(archiveWorkspace).toHaveBeenNthCalledWith(2, {
        environmentId: "environment-1",
        confirmUncommittedChanges: true,
      });
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
