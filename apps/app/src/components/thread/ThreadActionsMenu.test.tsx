// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Thread } from "@bb/domain";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceActionsProvider } from "@/components/sidebar/SpaceActionsContext";
import { readChildThreadParentFromLocationState } from "@/lib/child-thread-compose";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { ThreadActionsContextMenu } from "./ThreadActionsMenu";

const mockMoveProject = vi.hoisted(() => vi.fn());
const mockSetRootComposeProjectId = vi.hoisted(() => vi.fn());

vi.mock("@/lib/root-compose-selection", () => ({
  useSetRootComposeProjectId: () => mockSetRootComposeProjectId,
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));

vi.mock("./ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    archiveThreadAndChildren: vi.fn(),
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
    unarchiveThread: vi.fn(),
  }),
}));

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: null,
    providerId: "provider_test",
    title: "Test thread",
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: 1,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

let composeLocationState: unknown = undefined;

function ComposeRouteProbe() {
  composeLocationState = useLocation().state;
  return null;
}

function SpacesFixture({ children }: { children: ReactNode }) {
  return (
    <SpaceActionsProvider
      value={{
        activeSpaceId: "space_main",
        moveProject: mockMoveProject,
        spaces: [
          {
            id: "space_main",
            name: "Main",
            icon: "layers",
            color: "sage",
            projectIds: ["proj_test"],
            createdAt: 0,
            updatedAt: 0,
          },
          {
            id: "space_personal",
            name: "Personal",
            icon: "star",
            color: "blue",
            projectIds: [],
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      }}
    >
      <MemoryRouter initialEntries={["/thread"]}>
        <Routes>
          <Route path="/thread" element={children} />
          <Route
            path={getRootComposeRoutePath()}
            element={<ComposeRouteProbe />}
          />
        </Routes>
      </MemoryRouter>
    </SpaceActionsProvider>
  );
}

describe("ThreadActionsContextMenu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    composeLocationState = undefined;
  });

  it("opens the composer with the thread as the new thread's parent", async () => {
    render(
      <SpacesFixture>
        <ThreadActionsContextMenu thread={makeThread()}>
          <button type="button">Pinned thread</button>
        </ThreadActionsContextMenu>
      </SpacesFixture>,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Pinned thread" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New child thread" }),
    );

    expect(mockSetRootComposeProjectId).toHaveBeenCalledWith("proj_test");
    expect(readChildThreadParentFromLocationState(composeLocationState)).toEqual(
      {
        parentThreadId: "thr_test",
        parentThreadTitle: "Test thread",
        projectId: "proj_test",
      },
    );
  });

  it("does not offer a child thread under an archived thread", () => {
    render(
      <SpacesFixture>
        <ThreadActionsContextMenu thread={makeThread({ archivedAt: 2 })}>
          <button type="button">Archived thread</button>
        </ThreadActionsContextMenu>
      </SpacesFixture>,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Archived thread" }),
    );

    expect(screen.queryByRole("menuitem", { name: "New child thread" })).toBe(
      null,
    );
  });

  it("shows the project Space submenu on thread right-click", async () => {
    render(
      <SpacesFixture>
        <ThreadActionsContextMenu thread={makeThread()}>
          <button type="button">Pinned thread</button>
        </ThreadActionsContextMenu>
      </SpacesFixture>,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Pinned thread" }),
    );

    expect(
      await screen.findByRole("menuitem", { name: "Add project to Space" }),
    ).not.toBeNull();
  });
});
