// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ProjectResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import {
  ProjectActionsContextMenu,
  ProjectActionsMenu,
} from "./ProjectActionsMenu";
import { SpaceActionsProvider } from "@/components/sidebar/SpaceActionsContext";

const mockPathPickerHost = vi.hoisted(() => ({
  value: { hostId: null as string | null, hostName: null as string | null },
}));

const mockProjectActions = vi.hoisted(() => ({
  requestRename: vi.fn(),
  requestDelete: vi.fn(),
  requestAddLocalPath: vi.fn(),
}));

vi.mock("@/hooks/useLocalPathPicker", () => ({
  usePathPickerHost: () => mockPathPickerHost.value,
}));

vi.mock("./ProjectActionsProvider", () => ({
  useProjectActions: () => mockProjectActions,
}));

function makeProject(): ProjectResponse {
  return {
    id: "proj_test",
    kind: "standard",
    name: "Test project",
    gitRemoteUrl: null,
    githubAccountLogin: null,
    sources: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function SpacesFixture({ children }: { children: ReactNode }) {
  return (
    <SpaceActionsProvider
      value={{
        activeSpaceId: "space_main",
        moveProject: vi.fn(),
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
      {children}
    </SpaceActionsProvider>
  );
}

describe("ProjectActionsMenu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockPathPickerHost.value = { hostId: null, hostName: null };
  });

  it("closes after selecting an action", async () => {
    const project = makeProject();

    render(
      <MemoryRouter>
        <ProjectActionsMenu project={project} />
      </MemoryRouter>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Test project actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    });
  });

  it("shows the Space submenu when another Space exists", async () => {
    const project = makeProject();

    render(
      <MemoryRouter>
        <SpacesFixture>
          <ProjectActionsMenu project={project} />
        </SpacesFixture>
      </MemoryRouter>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Test project actions" }),
      { button: 0 },
    );

    expect(
      await screen.findByRole("menuitem", { name: "Add to Space" }),
    ).not.toBeNull();
  });

  it("shows the Space submenu on project right-click", async () => {
    const project = makeProject();

    render(
      <MemoryRouter>
        <SpacesFixture>
          <ProjectActionsContextMenu project={project}>
            <button type="button">Project row</button>
          </ProjectActionsContextMenu>
        </SpacesFixture>
      </MemoryRouter>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Project row" }));

    expect(
      await screen.findByRole("menuitem", { name: "Add to Space" }),
    ).not.toBeNull();
  });
});
