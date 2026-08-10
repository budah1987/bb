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
import { ProjectActionsMenu } from "./ProjectActionsMenu";
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
                projectIds: [project.id],
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
          <ProjectActionsMenu project={project} />
        </SpaceActionsProvider>
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
});
