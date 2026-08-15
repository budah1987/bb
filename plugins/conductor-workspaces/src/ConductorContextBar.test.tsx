// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

const app = await loadPluginApp(() => import("../app"));
const contextComponent = app.threadLists[0]?.experimental_contextBar;
if (!contextComponent)
  throw new Error("Conductor context bar was not registered");
const contextBar = {
  component: contextComponent,
};
const newThreadContextComponent =
  app.threadLists[0]?.experimental_newThreadContextBar;
if (!newThreadContextComponent)
  throw new Error("Conductor new-thread context bar was not registered");
const newThreadContextBar = {
  component: newThreadContextComponent,
};
const newThreadEmptyStateComponent =
  app.threadLists[0]?.experimental_newThreadEmptyState;
if (!newThreadEmptyStateComponent)
  throw new Error("Conductor new-thread empty state was not registered");
const newThreadEmptyState = {
  component: newThreadEmptyStateComponent,
};

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    }),
  });
});

beforeEach(() => window.localStorage.clear());

function thread(id: number): PluginSidebarThread {
  return {
    id: `thread-${id}`,
    projectId: "project-1",
    title: `Conversation ${id}`,
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
      name: "Mobile workspace",
      branchName: "qa/mobile",
      workspaceDisplayKind: "managed-worktree",
    },
    host: null,
    createdAt: id,
    updatedAt: id,
    lastReadAt: id,
    latestAttentionAt: id,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "startViewTransition");
});

describe("ConductorContextBar compact layout", () => {
  it("keeps three compact tabs and moves the rest into a working overflow", async () => {
    const threads = [1, 2, 3, 4, 5, 6].map(thread);
    const rendered = renderSlot(
      contextBar,
      {
        threadId: "thread-6",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: true,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads,
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Conversation 1" }),
      ).toBeDefined();
    });
    expect(screen.queryByText("Mobile workspace")).toBeNull();
    expect(screen.queryByText("qa/mobile")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Conversation 6" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Conversation 2" }),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "3 more" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Conversation 3" }),
    );
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "thread-3",
      options: undefined,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "New conversation in this workspace",
      }),
    );
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "openNewThread",
      options: {
        projectId: "project-1",
        focusPrompt: true,
        experimental_sameEnvironment: {
          environmentId: "environment-1",
          locked: true,
        },
      },
    });
  });

  it("uses a short swipe to move between workspace conversations", async () => {
    const rendered = renderSlot(
      contextBar,
      {
        threadId: "thread-2",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: true,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread(1), thread(2), thread(3)],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    const rail = await screen.findByRole("navigation", {
      name: "Workspace conversations",
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent("bb:conductor-compact-conversation-cycle", {
          detail: { threadId: "thread-2", direction: "left" },
        }),
      );
    });
    expect(rendered.sidebarActionCalls.at(-1)).toEqual({
      method: "open",
      threadId: "thread-3",
    });

    fireEvent.pointerDown(rail, {
      button: 0,
      clientX: 120,
      clientY: 20,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerMove(rail, {
      clientX: 72,
      clientY: 22,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerUp(rail, {
      clientX: 72,
      clientY: 22,
      pointerId: 1,
      pointerType: "touch",
    });

    expect(rendered.sidebarActionCalls.at(-1)).toEqual({
      method: "open",
      threadId: "thread-3",
      options: undefined,
    });
  });

  it("shows more tabs as the conversation rail grows", async () => {
    let observer: ResizeObserverMock | undefined;
    class ResizeObserverMock implements ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {
        observer = this;
      }

      observe() {}
      unobserve() {}
      disconnect() {}

      trigger() {
        this.callback([], this);
      }
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const threads = [1, 2, 3, 4, 5, 6].map(thread);
    renderSlot(
      contextBar,
      {
        threadId: "thread-6",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: false,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads,
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    const rail = await screen.findByRole("navigation", {
      name: "Workspace conversations",
    });
    Object.defineProperty(rail, "clientWidth", {
      configurable: true,
      value: 360,
    });
    act(() => observer?.trigger());
    expect(screen.getByRole("button", { name: "5 more" })).toBeDefined();

    Object.defineProperty(rail, "clientWidth", {
      configurable: true,
      value: 1_000,
    });
    act(() => observer?.trigger());
    expect(screen.queryByRole("button", { name: /more/u })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Conversation 3" }),
    ).toBeDefined();
  });

  it("renames and requests deletion from a tab context menu", async () => {
    const rendered = renderSlot(
      contextBar,
      {
        threadId: "thread-2",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: false,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread(1), thread(2)],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    const tab = await screen.findByRole("button", { name: "Conversation 1" });
    fireEvent.contextMenu(tab);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename…" }));
    const input = await screen.findByRole("textbox", {
      name: "Conversation name",
    });
    fireEvent.change(input, { target: { value: "Renamed conversation" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => {
      expect(rendered.sidebarActionCalls).toContainEqual({
        method: "rename",
        threadId: "thread-1",
        title: "Renamed conversation",
      });
    });

    fireEvent.contextMenu(tab);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "requestDelete",
      threadId: "thread-1",
      options: { experimental_fallbackThreadId: "thread-2" },
    });
  });

  it("opens a complete conversation as a temporary fork tab", async () => {
    const rendered = renderSlot(
      contextBar,
      {
        threadId: "thread-2",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: false,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread(1), thread(2)],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    fireEvent.contextMenu(
      await screen.findByRole("button", { name: "Conversation 1" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Continue in new tab" }),
    );

    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "experimental_openForkDraft",
      threadId: "thread-1",
    });
  });

  it("opens tab actions on a mobile long press", async () => {
    vi.useFakeTimers();
    const rendered = renderSlot(
      contextBar,
      {
        threadId: "thread-2",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: true,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread(1), thread(2)],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    const tab = screen.getByRole("button", { name: "Conversation 1" });
    fireEvent.pointerDown(tab, {
      pointerType: "touch",
      clientX: 24,
      clientY: 24,
    });
    act(() => vi.advanceTimersByTime(700));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "archive",
      threadId: "thread-1",
    });
  });

  it("keeps workspace tabs visible while composing a new conversation", async () => {
    let closeHandler: (() => boolean) | null = null;
    const rendered = renderSlot(
      newThreadContextBar,
      {
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: false,
        experimental_registerCloseHandler: (handler) => {
          closeHandler = handler;
        },
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread(1), thread(2)],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    expect(
      (
        await screen.findByRole("button", { name: "Conversation 1" })
      ).getAttribute("aria-current"),
    ).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "New conversation" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("button", { name: "Close new conversation" }),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Conversation 2" }));
    expect(rendered.sidebarActionCalls.at(-1)).toEqual({
      method: "open",
      threadId: "thread-2",
      options: undefined,
    });

    await waitFor(() => expect(closeHandler).not.toBeNull());
    let handled = false;
    act(() => {
      handled = closeHandler?.() ?? false;
    });
    expect(handled).toBe(true);
    expect(rendered.sidebarActionCalls.at(-1)).toEqual({
      method: "open",
      threadId: "thread-1",
      options: undefined,
    });

    fireEvent.keyDown(window, {
      key: "]",
      code: "BracketRight",
      metaKey: true,
    });
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "thread-1",
      options: undefined,
    });
  });

  it("keeps unassigned workspace tabs visible while composing", async () => {
    const unassignedThreads = [thread(1), thread(2)].map((candidate) => ({
      ...candidate,
      environment: null,
    }));
    renderSlot(
      newThreadContextBar,
      {
        projectId: "project-1",
        environmentId: null,
        isCompactViewport: false,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: unassignedThreads,
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    expect(
      await screen.findByRole("button", { name: "Conversation 1" }),
    ).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "New conversation" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("cycles left and right through every conversation in the workspace", async () => {
    const threads = [1, 2, 3, 4, 5, 6].map(thread);
    const rendered = renderSlot(
      contextBar,
      {
        threadId: "thread-6",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: true,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads,
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    await screen.findByRole("navigation", { name: "Workspace conversations" });
    fireEvent.keyDown(window, {
      key: "]",
      code: "BracketRight",
      metaKey: true,
    });
    fireEvent.keyDown(window, {
      key: "]",
      code: "BracketRight",
      metaKey: true,
    });
    const composer = document.createElement("textarea");
    document.body.append(composer);
    composer.focus();
    fireEvent.keyDown(composer, {
      key: "[",
      code: "BracketLeft",
      metaKey: true,
    });
    composer.remove();

    expect(rendered.sidebarActionCalls.slice(-3)).toEqual([
      { method: "open", threadId: "thread-1", options: undefined },
      { method: "open", threadId: "thread-2", options: undefined },
      { method: "open", threadId: "thread-1", options: undefined },
    ]);
  });

  it("uses Command+T for a new conversation in the current worktree", async () => {
    const rendered = renderSlot(
      contextBar,
      {
        threadId: "thread-1",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: false,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread(1)],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );
    await screen.findByRole("navigation", { name: "Workspace conversations" });
    const competingHandler = vi.fn();
    window.addEventListener("keydown", competingHandler);

    fireEvent.keyDown(window, {
      key: "t",
      code: "KeyT",
      metaKey: true,
    });
    window.removeEventListener("keydown", competingHandler);

    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "openNewThread",
      options: {
        projectId: "project-1",
        focusPrompt: true,
        experimental_sameEnvironment: {
          environmentId: "environment-1",
          locked: true,
        },
      },
    });
    expect(competingHandler).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("button", {
          name: "New conversation in this workspace",
        })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("Meta+T");
  });

  it("keeps an unassigned workspace when opening a new conversation", async () => {
    const unassignedThread: PluginSidebarThread = {
      ...thread(1),
      environment: null,
    };
    const rendered = renderSlot(
      contextBar,
      {
        threadId: unassignedThread.id,
        projectId: "project-1",
        environmentId: null,
        isCompactViewport: false,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [unassignedThread],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );
    await screen.findByRole("navigation", { name: "Workspace conversations" });

    fireEvent.click(
      screen.getByRole("button", {
        name: "New conversation in this workspace",
      }),
    );

    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "openNewThread",
      options: {
        projectId: "project-1",
        focusPrompt: true,
        experimental_sameEnvironment: {
          environmentId: null,
          locked: false,
        },
      },
    });
  });

  it("opens a pointer-created conversation with a scoped transition", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
      }),
    );
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    const rendered = renderSlot(
      contextBar,
      {
        threadId: "thread-1",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: false,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread(1)],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );
    await screen.findByRole("navigation", { name: "Workspace conversations" });

    fireEvent.click(
      screen.getByRole("button", {
        name: "New conversation in this workspace",
      }),
    );

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "openNewThread",
      options: {
        projectId: "project-1",
        focusPrompt: true,
        experimental_sameEnvironment: {
          environmentId: "environment-1",
          locked: true,
        },
      },
    });
  });

  it("closes a tab from its visible close control", async () => {
    const rendered = renderSlot(
      contextBar,
      {
        threadId: "thread-2",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: false,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread(1), thread(2), thread(3)],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    await screen.findByRole("button", { name: "Close Conversation 2" });
    fireEvent.click(
      screen.getByRole("button", { name: "Close Conversation 2" }),
    );

    expect(rendered.sidebarActionCalls.at(-1)).toEqual({
      method: "open",
      threadId: "thread-3",
      options: undefined,
    });
  });

  it("closes a tab with the middle mouse button", async () => {
    const rendered = renderSlot(
      contextBar,
      {
        threadId: "thread-2",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: false,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread(1), thread(2), thread(3)],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    fireEvent(
      await screen.findByRole("button", { name: "Conversation 2" }),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );

    expect(rendered.sidebarActionCalls.at(-1)).toEqual({
      method: "open",
      threadId: "thread-3",
      options: undefined,
    });
  });

  it("closes the focused tab and reopens it with Shift+Command+W", async () => {
    let closeHandler: (() => boolean) | null = null;
    const rendered = renderSlot(
      contextBar,
      {
        threadId: "thread-2",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: false,
        experimental_registerCloseHandler: (handler) => {
          closeHandler = handler;
        },
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread(1), thread(2), thread(3)],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    await waitFor(() => expect(closeHandler).not.toBeNull());
    let handled = false;
    act(() => {
      handled = closeHandler?.() ?? false;
    });
    expect(handled).toBe(true);
    expect(rendered.sidebarActionCalls.at(-1)).toEqual({
      method: "open",
      threadId: "thread-3",
      options: undefined,
    });

    fireEvent.keyDown(window, {
      key: "W",
      code: "KeyW",
      metaKey: true,
      shiftKey: true,
    });
    expect(rendered.sidebarActionCalls.at(-1)).toEqual({
      method: "open",
      threadId: "thread-2",
      options: undefined,
    });
  });

  it("opens a blank workspace conversation when the final tab closes", async () => {
    let closeHandler: (() => boolean) | null = null;
    const rendered = renderSlot(
      contextBar,
      {
        threadId: "thread-1",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: false,
        experimental_registerCloseHandler: (handler) => {
          closeHandler = handler;
        },
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread(1)],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    await waitFor(() => expect(closeHandler).not.toBeNull());
    let handled = false;
    act(() => {
      handled = closeHandler?.() ?? false;
    });
    expect(handled).toBe(true);
    expect(rendered.sidebarActionCalls).toEqual([
      {
        method: "openNewThread",
        options: {
          projectId: "project-1",
          focusPrompt: true,
          experimental_sameEnvironment: {
            environmentId: "environment-1",
            locked: true,
          },
        },
      },
    ]);
  });

  it("closes a split pane when its final tab closes", async () => {
    const closePane = vi.fn();
    const rendered = renderSlot(
      contextBar,
      {
        threadId: "thread-1",
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: false,
        experimental_closePane: closePane,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread(1)],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    fireEvent(
      await screen.findByRole("button", { name: "Conversation 1" }),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );

    expect(closePane).toHaveBeenCalledOnce();
    expect(rendered.sidebarActionCalls).toEqual([]);
  });

  it("adds a workspace transcript to a blank conversation", async () => {
    const rendered = renderSlot(
      newThreadEmptyState,
      {
        projectId: "project-1",
        environmentId: "environment-1",
        isCompactViewport: false,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread(1), thread(2)],
          projects: [{ id: "project-1", name: "BB", isPersonal: false }],
        },
        rpc: {
          readReconciliation: () => ({
            legacyWorkspaces: [],
            recordedSignature: null,
          }),
        },
      },
    );

    await screen.findByText("Carry forward context");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add transcript from Conversation 1",
      }),
    );

    expect(rendered.composer.mentions).toEqual([
      {
        provider: "conversation-transcript",
        id: "thread-1",
        label: "Conversation 1",
      },
    ]);
  });
});
