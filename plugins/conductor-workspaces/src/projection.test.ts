import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  buildConductorProjection,
  partitionWorkspaceThreads,
  pickWorkspaceThread,
} from "./projection";

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
      name: "Payments",
      branchName: "fix/payments",
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

describe("buildConductorProjection", () => {
  it("keeps personal one-off threads outside repository workspaces", () => {
    const projection = buildConductorProjection(
      [
        thread("repo-thread"),
        thread("older-personal", {
          projectId: "personal",
          environment: null,
          createdAt: 2,
        }),
        thread("newer-personal", {
          projectId: "personal",
          environment: null,
          createdAt: 3,
        }),
      ],
      [
        {
          id: "project-1",
          name: "BB",
          isPersonal: false,
          experimental_gitRemoteUrl: "git@github.com:better-build/bb.git",
        },
        { id: "personal", name: "Personal", isPersonal: true },
      ],
    );

    expect(projection.personalProjectId).toBe("personal");
    expect(projection.personalThreads.map((item) => item.id)).toEqual([
      "newer-personal",
      "older-personal",
    ]);
    expect(projection.projects).toHaveLength(1);
    expect(projection.projects[0]?.name).toBe("BB");
    expect(projection.projects[0]?.repositoryName).toBe("better-build/bb");
    expect(projection.report).toMatchObject({
      version: 2,
      activeConversations: 3,
      missingConversations: 0,
      duplicateConversations: 0,
    });
  });

  it("keeps repositories visible before their first workspace is created", () => {
    const projection = buildConductorProjection(
      [thread("repo-thread")],
      [
        {
          id: "project-1",
          name: "BB",
          isPersonal: false,
          experimental_githubAccountLogin: "amirghst",
        },
        {
          id: "project-2",
          name: "New repository",
          isPersonal: false,
        },
      ],
    );

    expect(projection.projects.map((project) => project.name)).toEqual([
      "BB",
      "New repository",
    ]);
    expect(projection.projects[0]?.githubAccountLogin).toBe("amirghst");
    expect(projection.projects[1]?.workspaces).toEqual([]);
  });

  it("keeps the first conversation title after workspace provisioning", () => {
    const projection = buildConductorProjection(
      [
        thread("first", {
          title: "Fix workspace naming",
          environment: {
            id: "environment-1",
            name: null,
            branchName: "budah1987/fix-workspace-naming-thread-1",
            workspaceDisplayKind: "managed-worktree",
          },
        }),
      ],
      [{ id: "project-1", name: "BB", isPersonal: false }],
    );

    expect(projection.projects[0]?.workspaces[0]?.title).toBe(
      "Fix workspace naming",
    );
  });

  it("keeps an explicit workspace name above the first conversation title", () => {
    const projection = buildConductorProjection(
      [thread("first", { title: "Fix workspace naming" })],
      [{ id: "project-1", name: "BB", isPersonal: false }],
    );

    expect(projection.projects[0]?.workspaces[0]?.title).toBe("Payments");
  });

  it("projects native environments exactly once and preserves legacy organizers", () => {
    const threads = [
      thread("organizer", { originPluginId: "conductor-workspaces" }),
      thread("first", { parentThreadId: "organizer" }),
      thread("second", { createdAt: 2, updatedAt: 3, isUnread: true }),
      thread("local", { environment: null }),
      thread("archived", { isArchived: true }),
    ];
    const legacy = [
      {
        id: "legacy-1",
        projectId: "project-1",
        title: "Payments",
        anchorThreadId: "organizer",
        firstTabThreadId: "first",
        branchName: "fix/payments",
        environmentName: "Payments",
      },
    ];
    const projection = buildConductorProjection(
      threads,
      [{ id: "project-1", name: "BB", isPersonal: false }],
      legacy,
    );

    expect(projection.projects[0]?.workspaces).toHaveLength(2);
    expect(
      projection.projects.flatMap((project) =>
        project.workspaces.flatMap((workspace) =>
          workspace.threads.map((item) => item.id),
        ),
      ),
    ).toEqual(["first", "second", "local"]);
    expect(projection.report).toMatchObject({
      activeConversations: 3,
      archivedConversations: 1,
      legacyOrganizersHidden: 1,
      unassignedConversations: 1,
      missingConversations: 0,
      duplicateConversations: 0,
    });
    expect(
      buildConductorProjection(
        threads,
        [{ id: "project-1", name: "BB", isPersonal: false }],
        legacy,
      ).report.signature,
    ).toBe(projection.report.signature);
  });

  it("opens the oldest unread conversation before the latest idle one", () => {
    const projection = buildConductorProjection(
      [
        thread("old-unread", {
          isUnread: true,
          latestAttentionAt: 10,
          updatedAt: 10,
        }),
        thread("new-unread", {
          isUnread: true,
          latestAttentionAt: 20,
          updatedAt: 20,
        }),
        thread("latest", { updatedAt: 30 }),
      ],
      [{ id: "project-1", name: "BB", isPersonal: false }],
    );
    const workspace = projection.projects[0]?.workspaces[0];
    expect(workspace && pickWorkspaceThread(workspace, null)?.id).toBe(
      "old-unread",
    );
  });
});

describe("partitionWorkspaceThreads", () => {
  it("keeps the active conversation visible within the compact tab limit", () => {
    const threads = [1, 2, 3, 4, 5, 6].map((id) => thread(`thread-${id}`));

    const result = partitionWorkspaceThreads(threads, "thread-6", 2);

    expect(result.visible.map((item) => item.id)).toEqual([
      "thread-1",
      "thread-6",
    ]);
    expect(result.hidden.map((item) => item.id)).toEqual([
      "thread-2",
      "thread-3",
      "thread-4",
      "thread-5",
    ]);
  });
});
