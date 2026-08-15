// @vitest-environment jsdom

import type { ThreadListEntry } from "@bb/domain";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RootComposeMobileSessions,
  buildMobileSessionGroups,
  getActiveMobileSessionAncestorIds,
  getMobileSessionGroupKind,
  isAwaitingReplyThread,
} from "./RootComposeMobileSessions";

const threadActions = vi.hoisted(() => ({
  archiveThreadAndChildren: vi.fn(),
  requestDelete: vi.fn(),
  requestRename: vi.fn(),
  togglePin: vi.fn(),
  toggleRead: vi.fn(),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    ...threadActions,
    togglePin: threadActions.togglePin,
    toggleRead: threadActions.toggleRead,
    unarchiveThread: vi.fn(),
  }),
}));

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return {
    id: "thr_mobile",
    projectId: "proj_mobile",
    environmentId: null,
    providerId: "codex",
    title: "Mobile activity",
    titleFallback: "Mobile activity",
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 2,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

const projectNames = new Map([
  ["proj_mobile", "BB"],
  ["proj_other", "Ghost"],
]);

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("mobile session grouping", () => {
  it("keeps waiting threads ahead of running threads until their interaction resolves", () => {
    const waiting = makeThread({
      id: "thr_waiting",
      title: "Approve deployment",
      hasPendingInteraction: true,
      status: "active",
      runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
    });
    const running = makeThread({
      id: "thr_running",
      title: "Build command center",
      status: "active",
      runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
    });

    expect(getMobileSessionGroupKind(waiting)).toBe("waiting");
    expect(getMobileSessionGroupKind(running)).toBe("working");
    expect(
      buildMobileSessionGroups({
        filter: "active",
        projectNamesById: projectNames,
        query: "",
        threads: [running, waiting],
      }).map((group) => group.kind),
    ).toEqual(["waiting", "working"]);
  });

  it("keeps completed unread threads active until they are read", () => {
    const completedUnread = makeThread({
      id: "thr_completed_unread",
      title: "Completed unread",
      lastReadAt: 1,
      latestAttentionAt: 2,
    });

    expect(getMobileSessionGroupKind(completedUnread)).toBe("ready");
    expect(
      buildMobileSessionGroups({
        filter: "active",
        projectNamesById: projectNames,
        query: "",
        threads: [completedUnread],
      }).map((group) => group.kind),
    ).toEqual(["ready"]);
    expect(
      buildMobileSessionGroups({
        filter: "inactive",
        projectNamesById: projectNames,
        query: "",
        threads: [completedUnread],
      }),
    ).toEqual([]);
  });

  it("identifies viewed agent output that has not received a reply", () => {
    const awaitingReply = makeThread({
      id: "thr_awaiting_reply",
      lastReadAt: 3,
      latestAttentionAt: 2,
      updatedAt: 2,
    });

    expect(isAwaitingReplyThread(awaitingReply)).toBe(true);
    expect(getMobileSessionGroupKind(awaitingReply)).toBe("awaiting-reply");
    expect(
      buildMobileSessionGroups({
        filter: "all",
        projectNamesById: projectNames,
        query: "",
        threads: [awaitingReply],
      }),
    ).toEqual([]);
    expect(
      isAwaitingReplyThread(
        makeThread({ lastReadAt: 2, latestAttentionAt: 2 }),
      ),
    ).toBe(false);
  });

  it("keeps an idle parent running while a descendant agent is active", () => {
    const parent = makeThread({
      id: "thr_parent",
      title: "Coordinate agents",
    });
    const child = makeThread({
      id: "thr_child",
      parentThreadId: parent.id,
      status: "active",
      runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
    });
    const grandchild = makeThread({
      id: "thr_grandchild",
      parentThreadId: child.id,
    });
    const threads = [parent, child, grandchild];
    const activeAncestorIds = getActiveMobileSessionAncestorIds(threads);

    expect(activeAncestorIds).toEqual(new Set([parent.id]));
    expect(getMobileSessionGroupKind(parent, activeAncestorIds)).toBe(
      "working",
    );
    expect(
      buildMobileSessionGroups({
        filter: "inactive",
        projectNamesById: projectNames,
        query: "",
        threads,
      }).flatMap((group) => group.threads.map((thread) => thread.id)),
    ).toEqual([grandchild.id]);
  });

  it("searches title, project, environment, and branch metadata", () => {
    const groups = buildMobileSessionGroups({
      filter: "all",
      projectNamesById: projectNames,
      query: "ghost",
      threads: [
        makeThread({ id: "thr_bb" }),
        makeThread({ id: "thr_ghost", projectId: "proj_other" }),
      ],
    });

    expect(
      groups.flatMap((group) => group.threads.map((thread) => thread.id)),
    ).toEqual(["thr_ghost"]);
  });
});

describe("RootComposeMobileSessions", () => {
  it("stays available on compact screens and wider touch devices", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileSessions
          highlightedThreadId={null}
          projectNamesById={projectNames}
          showCreatingRow={false}
          threads={[]}
        />
      </MemoryRouter>,
    );

    const sessions = screen.getByRole("region", { name: "Command Center" });
    expect(sessions.className).toContain("max-md:flex");
    expect(sessions.className).toContain("pointer-coarse:flex");
  });

  it("shows every active session without a recent-session limit", () => {
    const runningThreads = Array.from({ length: 8 }, (_, index) =>
      makeThread({
        id: `thr_running_${index}`,
        title: `Running session ${index + 1}`,
        status: "active",
        latestAttentionAt: index,
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    );

    render(
      <MemoryRouter>
        <RootComposeMobileSessions
          highlightedThreadId={null}
          projectNamesById={projectNames}
          showCreatingRow={false}
          threads={runningThreads}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link")).toHaveLength(8);
    expect(screen.queryByRole("heading", { name: "Sessions" })).toBeNull();
    expect(screen.queryByText(/running ·/u)).toBeNull();
  });

  it("keeps focused workspaces large and outside the secondary filters", () => {
    const focused = makeThread({
      id: "thr_focused",
      environmentId: "env_focus",
      environmentName: "Activity workspace",
      environmentBranchName: "budah1987/activity",
      pinnedAt: 10,
      status: "active",
      runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
    });
    const sibling = makeThread({
      id: "thr_sibling",
      environmentId: "env_focus",
      environmentName: "Activity workspace",
      environmentBranchName: "budah1987/activity",
      title: "Research tab",
    });

    render(
      <MemoryRouter>
        <RootComposeMobileSessions
          highlightedThreadId={null}
          projectNamesById={projectNames}
          showCreatingRow={false}
          threads={[focused, sibling]}
        />
      </MemoryRouter>,
    );

    const focusTab = screen.getByRole("tab", { name: "Focus (1)" });
    fireEvent.click(focusTab);
    expect(screen.getByText("Activity workspace")).not.toBeNull();
    expect(screen.getByText(/2 conversations/u)).not.toBeNull();
    expect(screen.getByRole("link").className.includes("min-h-16")).toBe(true);
    expect(screen.queryByText("Research tab")).toBeNull();
  });

  it("shows a passive parent as working while its sub-agent runs", () => {
    const parent = makeThread({
      id: "thr_parent",
      title: "Coordinate agents",
    });
    const child = makeThread({
      id: "thr_child",
      parentThreadId: parent.id,
      status: "active",
      runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
    });

    render(
      <MemoryRouter>
        <RootComposeMobileSessions
          highlightedThreadId={null}
          projectNamesById={projectNames}
          showCreatingRow={false}
          threads={[parent, child]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: "Active (2)" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Recall (0)" })).not.toBeNull();
    expect(
      screen.getByRole("link", {
        name: /Open Coordinate agents — Working/,
      }),
    ).not.toBeNull();
  });

  it("keeps work that needs attention above the workspace views", () => {
    const awaitingReply = makeThread({
      id: "thr_awaiting_reply",
      title: "Review mobile navigation",
      lastReadAt: 3,
      latestAttentionAt: 2,
      updatedAt: 2,
    });

    render(
      <MemoryRouter>
        <RootComposeMobileSessions
          highlightedThreadId={null}
          projectNamesById={projectNames}
          showCreatingRow={false}
          threads={[awaitingReply]}
        />
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", { name: "Attention" });
    expect(screen.getByText("Review mobile navigation")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Focus (0)" })).not.toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      toggle
        .closest("section")
        ?.querySelector(".mobile-priority-section__content")
        ?.hasAttribute("data-collapsed"),
    ).toBe(true);
  });

  it("uses the existing activity glyph animation with semantic session colors", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileSessions
          highlightedThreadId={null}
          projectNamesById={projectNames}
          showCreatingRow={false}
          threads={[
            makeThread({
              id: "thr_waiting",
              title: "Waiting",
              hasPendingInteraction: true,
            }),
            makeThread({
              id: "thr_running",
              title: "Running",
              status: "active",
              runtime: {
                displayStatus: "active",
                hostReconnectGraceExpiresAt: null,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    const waitingGlyph = screen.getByLabelText("Waiting");
    const runningGlyph = screen.getByLabelText("Working");
    expect(waitingGlyph.className).toContain("mobile-activity-matrix--waiting");
    expect(runningGlyph.className).toContain("mobile-activity-matrix--working");
    expect(
      runningGlyph.querySelectorAll(".mobile-activity-pixel"),
    ).toHaveLength(25);
  });

  it("labels completed unread work as ready without a badge", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileSessions
          highlightedThreadId={null}
          projectNamesById={projectNames}
          showCreatingRow={false}
          threads={[
            makeThread({
              title: "Review completed work",
              lastReadAt: 1,
              latestAttentionAt: 2,
            }),
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Ready")).not.toBeNull();
    expect(screen.getByLabelText("Ready")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Active (0)" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Recall (0)" })).not.toBeNull();
  });

  it("switches between active, recall, and focus workspaces", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileSessions
          highlightedThreadId={null}
          projectNamesById={projectNames}
          showCreatingRow={false}
          threads={[
            makeThread({ id: "thr_idle", title: "Idle session" }),
            makeThread({
              id: "thr_focus",
              title: "Focused session",
              pinnedAt: 4,
            }),
            makeThread({
              id: "thr_running",
              title: "Running session",
              status: "active",
              runtime: {
                displayStatus: "active",
                hostReconnectGraceExpiresAt: null,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Idle session")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Recall (1)" }));
    expect(screen.getByText("Idle session")).not.toBeNull();
    expect(screen.queryByText("Running session")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Focus (1)" }));
    expect(screen.getByText("Focused session")).not.toBeNull();
    expect(screen.queryByText("Running session")).toBeNull();
  });

  it("swipes deliberately through session categories in both directions", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileSessions
          highlightedThreadId={null}
          projectNamesById={projectNames}
          showCreatingRow={false}
          threads={[
            makeThread({ id: "thr_idle", title: "Idle session" }),
            makeThread({
              id: "thr_running",
              title: "Running session",
              status: "active",
              runtime: {
                displayStatus: "active",
                hostReconnectGraceExpiresAt: null,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    const swipe = (startX: number, endX: number) => {
      const page = document.querySelector<HTMLElement>(".mobile-session-page");
      if (page === null) throw new Error("Expected the mobile session page");
      fireEvent.pointerDown(page, {
        button: 0,
        clientX: startX,
        clientY: 20,
        pointerId: 1,
        pointerType: "touch",
      });
      fireEvent.pointerMove(page, {
        clientX: endX,
        clientY: 22,
        pointerId: 1,
        pointerType: "touch",
      });
      fireEvent.pointerUp(page, {
        clientX: endX,
        clientY: 22,
        pointerId: 1,
        pointerType: "touch",
      });
    };

    swipe(100, 20);
    expect(
      screen
        .getByRole("tab", { name: "Recall (1)" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("Idle session")).not.toBeNull();

    swipe(20, 100);
    expect(
      screen
        .getByRole("tab", { name: "Active (1)" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("Running session")).not.toBeNull();
  });

  it("leaves vertical scrolling and short horizontal movement on the current category", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileSessions
          highlightedThreadId={null}
          projectNamesById={projectNames}
          showCreatingRow={false}
          threads={[
            makeThread({ id: "thr_idle", title: "Idle session" }),
            makeThread({
              id: "thr_running",
              title: "Running session",
              status: "active",
              runtime: {
                displayStatus: "active",
                hostReconnectGraceExpiresAt: null,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    const page = document.querySelector<HTMLElement>(".mobile-session-page");
    if (page === null) throw new Error("Expected the mobile session page");

    fireEvent.pointerDown(page, {
      button: 0,
      clientX: 100,
      clientY: 20,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerMove(page, {
      clientX: 96,
      clientY: 70,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerUp(page, {
      clientX: 96,
      clientY: 70,
      pointerId: 1,
      pointerType: "touch",
    });

    fireEvent.pointerDown(page, {
      button: 0,
      clientX: 100,
      clientY: 20,
      pointerId: 2,
      pointerType: "touch",
    });
    fireEvent.pointerMove(page, {
      clientX: 70,
      clientY: 21,
      pointerId: 2,
      pointerType: "touch",
    });
    fireEvent.pointerUp(page, {
      clientX: 70,
      clientY: 21,
      pointerId: 2,
      pointerType: "touch",
    });

    expect(
      screen
        .getByRole("tab", { name: "Active (1)" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(page.hasAttribute("data-no-workspace-swipe")).toBe(true);
  });

  it("opens search progressively and filters the visible rows", () => {
    render(
      <MemoryRouter>
        <RootComposeMobileSessions
          highlightedThreadId={null}
          projectNamesById={projectNames}
          showCreatingRow={false}
          threads={[
            makeThread({
              id: "thr_bb",
              title: "BB activity",
              status: "active",
              runtime: {
                displayStatus: "active",
                hostReconnectGraceExpiresAt: null,
              },
            }),
            makeThread({
              id: "thr_ghost",
              projectId: "proj_other",
              title: "Theme work",
              status: "active",
              runtime: {
                displayStatus: "active",
                hostReconnectGraceExpiresAt: null,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search sessions" }));
    const search = screen.getByRole("searchbox", { name: "Search sessions" });
    fireEvent.change(search, { target: { value: "ghost" } });

    expect(screen.getByText("Theme work")).not.toBeNull();
    expect(screen.queryByText("BB activity")).toBeNull();
  });

  it("opens thread actions on touch hold and routes every action through the shared provider", () => {
    vi.useFakeTimers();
    const thread = makeThread({
      lastReadAt: 3,
      latestAttentionAt: 2,
    });
    render(
      <MemoryRouter>
        <RootComposeMobileSessions
          highlightedThreadId={null}
          projectNamesById={projectNames}
          showCreatingRow={false}
          threads={[thread]}
        />
      </MemoryRouter>,
    );

    const session = screen.getByRole("link", {
      name: /Open Mobile activity/,
    });
    const openActions = () => {
      fireEvent.pointerDown(session, {
        button: 0,
        clientX: 20,
        clientY: 20,
        pointerType: "touch",
      });
      act(() => vi.advanceTimersByTime(500));
      expect(
        screen.getByRole("heading", { name: "Mobile activity" }),
      ).not.toBeNull();
    };

    openActions();
    fireEvent.click(screen.getByRole("button", { name: "Add to Focus" }));
    act(() => vi.runOnlyPendingTimers());
    expect(threadActions.togglePin).toHaveBeenCalledWith(thread);

    openActions();
    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    act(() => vi.runOnlyPendingTimers());
    expect(threadActions.toggleRead).toHaveBeenCalledWith(thread);

    openActions();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    act(() => vi.runOnlyPendingTimers());
    expect(threadActions.requestRename).toHaveBeenCalledWith(thread);

    openActions();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    act(() => vi.runOnlyPendingTimers());
    expect(threadActions.archiveThreadAndChildren).toHaveBeenCalledWith(thread);

    openActions();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    act(() => vi.runOnlyPendingTimers());
    expect(threadActions.requestDelete).toHaveBeenCalledWith(thread);
  });

  it("cancels a pending hold when the gesture becomes a scroll", () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter>
        <RootComposeMobileSessions
          highlightedThreadId={null}
          projectNamesById={projectNames}
          showCreatingRow={false}
          threads={[
            makeThread({
              status: "active",
              runtime: {
                displayStatus: "active",
                hostReconnectGraceExpiresAt: null,
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    const session = screen.getByRole("link", {
      name: /Open Mobile activity/,
    });
    fireEvent.pointerDown(session, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerType: "touch",
    });
    fireEvent.pointerMove(session, {
      clientX: 10,
      clientY: 24,
      pointerType: "touch",
    });
    act(() => vi.advanceTimersByTime(500));

    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });
});
