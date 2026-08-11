// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SpaceResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceDock } from "./SpaceSidebar";

const spaces: SpaceResponse[] = [
  {
    id: "space-main",
    name: "Main",
    icon: "layers",
    color: "sage",
    projectIds: ["project-main"],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "space-personal",
    name: "Personal",
    icon: "star",
    color: "blue",
    projectIds: [],
    createdAt: 0,
    updatedAt: 0,
  },
];

afterEach(cleanup);

describe("SpaceDock", () => {
  it("names the active Space and keeps every Space selectable", () => {
    const onSelect = vi.fn();
    render(
      <SpaceDock
        activeSpaceId="space-main"
        spaces={spaces}
        onSelect={onSelect}
        onNew={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText("Main")).not.toBeNull();
    expect(screen.queryByText("Personal")).toBeNull();
    const activeSpace = screen.getByRole("button", {
      name: "Main, Space 1",
    });
    const inactiveSpace = screen.getByRole("button", {
      name: "Personal, Space 2",
    });
    expect(activeSpace.getAttribute("aria-pressed")).toBe("true");
    expect(activeSpace.className).toContain("w-auto");
    expect(inactiveSpace.className).toContain("size-8");
    expect(inactiveSpace.querySelector("span")?.className).toContain(
      "place-items-center",
    );

    fireEvent.click(inactiveSpace);
    expect(onSelect).toHaveBeenCalledWith("space-personal");
  });

  it("shows a clear create action before Spaces load", () => {
    const onNew = vi.fn();
    render(
      <SpaceDock
        activeSpaceId="space-main"
        spaces={[]}
        onSelect={vi.fn()}
        onNew={onNew}
        onEdit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Space" }));
    expect(screen.getByText("Create Space")).not.toBeNull();
    expect(onNew).toHaveBeenCalledOnce();
  });
});
