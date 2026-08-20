// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

const app = await loadPluginApp(() => import("../app"));
const detailsPanel = app.navPanels.find(
  (panel) => panel.id === "repository-details",
);
const sidebar = app.threadLists[0];
if (!detailsPanel) throw new Error("Repository Details was not registered");
if (!sidebar) throw new Error("Conductor sidebar was not registered");

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
      name: "Feature workspace",
      branchName: "feature/details",
      workspaceDisplayKind: "managed-worktree",
    },
    host: { id: "host-1", name: "Amir’s Mac" },
    createdAt: 1,
    updatedAt: Date.now(),
    lastReadAt: 2,
    latestAttentionAt: 1,
    ...overrides,
  };
}

const sidebarState = {
  status: "ready" as const,
  projects: [
    { id: "personal", name: "Personal", isPersonal: true },
    {
      id: "project-1",
      name: "BB",
      isPersonal: false,
      experimental_gitRemoteUrl: "https://github.com/get-bb/bb",
      experimental_githubAccountLogin: "amir",
    },
  ],
  threads: [
    thread("Primary conversation", {
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
    thread("Review conversation", {
      environment: {
        id: "environment-2",
        name: "Review workspace",
        branchName: "review/details",
        workspaceDisplayKind: "managed-worktree",
      },
      isUnread: true,
      indicator: "unread-success",
      updatedAt: Date.now() - 60_000,
    }),
  ],
};

const reconciliationRpc = {
  readReconciliation: () => ({
    legacyWorkspaces: [],
    recordedSignature: null,
  }),
  recordReconciliation: () => ({ recorded: false }),
  readProjectManager: () => ({
    enabled: true,
    providerId: "codex",
    model: "gpt-5.4-mini",
    reasoningLevel: "medium" as const,
    serviceTier: "default" as const,
    permissionMode: "auto" as const,
  }),
  updateProjectManager: vi.fn(() => ({
    enabled: true,
    providerId: "codex",
    model: "gpt-5.4-mini",
    reasoningLevel: "medium" as const,
    serviceTier: "default" as const,
    permissionMode: "auto" as const,
  })),
  runProjectManager: vi.fn(() => ({ threadId: "manager-thread" })),
  updateWorkspaceFromMain: vi.fn(() => ({
    message: "Updated feature/details from main.",
    outcome: "updated" as const,
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("RepositoryDetailsPane", () => {
  it("renders live repository and workspace state with native actions", async () => {
    const rendered = renderSlot(
      detailsPanel,
      { subPath: "project-1" },
      {
        sidebarThreads: sidebarState,
        sidebarPullRequests: {
          "Review conversation": {
            number: 42,
            title: "Review repository details",
            url: "https://github.com/get-bb/bb/pull/42",
            state: "open",
            attention: "review_requested",
          },
        },
        rpc: reconciliationRpc,
      },
    );

    expect(
      await screen.findByRole("heading", { name: "get-bb/bb" }),
    ).toBeDefined();
    const summary = screen.getByRole("region", { name: "Repository summary" });
    expect(
      within(summary).getByText("Workspaces").previousElementSibling
        ?.textContent,
    ).toBe("2");
    expect(
      within(summary).getByText("Working").previousElementSibling?.textContent,
    ).toBe("1");
    expect(
      within(summary).getByText("Need attention").previousElementSibling
        ?.textContent,
    ).toBe("1");

    fireEvent.click(
      screen.getAllByRole("button", { name: "Open workspace" })[0]!,
    );
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "Primary conversation",
    });

    fireEvent.click(screen.getByRole("button", { name: "New workspace" }));
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "openNewThread",
      options: {
        projectId: "project-1",
        focusPrompt: true,
        experimental_startGithubWorkflow: true,
      },
    });
  });

  it("shows live Git state and delegates GitHub reads to the native tab", async () => {
    renderSlot(
      detailsPanel,
      { subPath: "project-1" },
      {
        sidebarThreads: sidebarState,
        rpc: reconciliationRpc,
      },
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Git" }));
    expect(screen.getByRole("link", { name: "get-bb/bb" })).toBeDefined();
    expect(screen.getByText("@amir")).toBeDefined();
    expect(screen.getByText("review/details")).toBeDefined();
    expect(screen.queryByRole("link", { name: /#42/u })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "GitHub" }));
    expect(
      screen.getByText("Native GitHub details are unavailable."),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Git" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Update from main" })[0]!,
    );
    await waitFor(() =>
      expect(reconciliationRpc.updateWorkspaceFromMain).toHaveBeenCalledWith({
        environmentId: "environment-1",
      }),
    );
    expect(
      await screen.findByText("Updated feature/details from main."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Check again" })).toBeDefined();
  });

  it("moves between detail tabs with the keyboard", async () => {
    renderSlot(
      detailsPanel,
      { subPath: "project-1" },
      { sidebarThreads: sidebarState, rpc: reconciliationRpc },
    );

    const overviewTab = await screen.findByRole("tab", { name: "Overview" });
    overviewTab.focus();
    fireEvent.keyDown(overviewTab, { key: "ArrowRight" });

    const gitTab = screen.getByRole("tab", { name: "Git" });
    expect(gitTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(gitTab);
    expect(screen.getByText("Branches and pull requests")).toBeDefined();
  });

  it("keeps the update action available after a failure", async () => {
    reconciliationRpc.updateWorkspaceFromMain.mockRejectedValueOnce(
      new Error("The workspace has uncommitted changes."),
    );
    renderSlot(
      detailsPanel,
      { subPath: "project-1" },
      { sidebarThreads: sidebarState, rpc: reconciliationRpc },
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Git" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Update from main" })[0]!,
    );

    expect(
      await screen.findByText("The workspace has uncommitted changes."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry update" })).toBeDefined();
  });

  it("runs an enabled repository manager and opens its root thread", async () => {
    const rendered = renderSlot(
      detailsPanel,
      { subPath: "project-1" },
      { sidebarThreads: sidebarState, rpc: reconciliationRpc },
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Manager" }));
    const settingsDisclosure = (
      await screen.findByText("Agent settings")
    ).closest("details");
    expect(settingsDisclosure?.hasAttribute("open")).toBe(false);
    expect(await screen.findByDisplayValue("gpt-5.4-mini")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Briefing focus"), {
      target: { value: "Review release risk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run briefing" }));

    await waitFor(() =>
      expect(reconciliationRpc.runProjectManager).toHaveBeenCalledWith({
        projectId: "project-1",
        prompt: "Review release risk",
      }),
    );
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "manager-thread",
    });
  });

  it("shows manager save failures without discarding edited settings", async () => {
    reconciliationRpc.updateProjectManager.mockRejectedValueOnce(
      new Error("The selected model is not available."),
    );
    renderSlot(
      detailsPanel,
      { subPath: "project-1" },
      { sidebarThreads: sidebarState, rpc: reconciliationRpc },
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Manager" }));
    const modelInput = await screen.findByDisplayValue("gpt-5.4-mini");
    fireEvent.change(modelInput, { target: { value: "gpt-5.4-mini-test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(
      await screen.findByText("The selected model is not available."),
    ).toBeDefined();
    expect(screen.getByDisplayValue("gpt-5.4-mini-test")).toBeDefined();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDefined();
  });

  it("opens Repository Details from a repository context menu", async () => {
    const rendered = renderSlot(
      sidebar,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
      },
      { sidebarThreads: sidebarState, rpc: reconciliationRpc },
    );

    const repository = await screen.findByRole("region", { name: "get-bb/bb" });
    const repositoryToggle = repository.querySelector(
      ".conductor-section-toggle",
    );
    if (!(repositoryToggle instanceof HTMLButtonElement)) {
      throw new Error("Repository toggle was not rendered");
    }
    fireEvent.contextMenu(repositoryToggle);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Details" }));

    await waitFor(() => {
      expect(rendered.navigateCalls).toContainEqual({
        method: "toPluginPanel",
        path: "repository-details",
        options: { subPath: "project-1" },
      });
    });
  });
});
