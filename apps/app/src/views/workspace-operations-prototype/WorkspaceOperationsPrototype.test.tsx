// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceOperationsPrototype } from "./WorkspaceOperationsPrototype";

afterEach(cleanup);

describe("WorkspaceOperationsPrototype", () => {
  it("uses the Conductor repository hierarchy as its primary navigation", () => {
    render(<WorkspaceOperationsPrototype />);

    const navigation = screen.getByRole("complementary", {
      name: "Conductor navigation",
    });

    expect(navigation.textContent).toContain("BBamir");
    expect(navigation.textContent).toContain("Synara");
    expect(navigation.textContent).toContain("Ghost");
    expect(navigation.textContent).toContain("Helmor");
    expect(navigation.textContent).toContain("Agent Toolkit");
    expect(
      screen.getByRole("tab", { name: "Overview", selected: true }),
    ).not.toBeNull();
  });

  it("opens a workspace from its Conductor card", () => {
    render(<WorkspaceOperationsPrototype />);

    const navigation = screen.getByRole("complementary", {
      name: "Conductor navigation",
    });
    fireEvent.click(
      within(navigation).getByRole("button", {
        name: /feature\/auth.*3 agents/iu,
      }),
    );

    expect(screen.getAllByText("localhost:3000/login").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByRole("button", { name: /^Annotate$/u })).not.toBeNull();
  });

  it("filters the Conductor hierarchy by workspace", () => {
    render(<WorkspaceOperationsPrototype />);

    fireEvent.change(
      screen.getByLabelText("Search repositories and workspaces"),
      { target: { value: "release-preview" } },
    );

    const navigation = screen.getByRole("complementary", {
      name: "Conductor navigation",
    });
    expect(navigation.textContent).toContain("Synara");
    expect(navigation.textContent).toContain("release-preview");
    expect(navigation.textContent).not.toContain("BBamir");
  });

  it("opens Conductor navigation from the compact header", () => {
    render(<WorkspaceOperationsPrototype compact />);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));

    expect(
      screen.getByRole("complementary", { name: "Conductor navigation" }),
    ).not.toBeNull();
  });

  it("keeps annotation drafts private until the user sends the batch", () => {
    render(
      <WorkspaceOperationsPrototype
        initialSurface="workspace"
        initialDrafts={12}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Send 12 to agent" }),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send 12 to agent" }));

    expect(
      screen.getByText("Annotation batch queued after the current task."),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Send 12 to agent" }),
    ).toBeNull();
  });

  it("exposes repository Git actions from Repo Details", () => {
    render(<WorkspaceOperationsPrototype />);

    fireEvent.click(screen.getByRole("tab", { name: "Git" }));

    expect(
      screen.getByRole("button", { name: "Update eligible workspaces" }),
    ).not.toBeNull();
    expect(screen.getAllByText("Agent working").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Conflict").length).toBeGreaterThan(0);
  });
});
