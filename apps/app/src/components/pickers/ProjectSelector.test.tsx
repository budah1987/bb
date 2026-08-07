// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSelector } from "./ProjectSelector";

describe("ProjectSelector", () => {
  it("shows repository ownership and every account with access", () => {
    render(
      <ProjectSelector
        projects={[
          {
            id: "proj_ghost",
            name: "Ghost",
            githubRepository: {
              nameWithOwner: "ghosts-inc/ghost",
              accessibleBy: ["budah1987", "amirghst"],
              activeAccount: "budah1987",
            },
          },
        ]}
        value="proj_ghost"
        onChange={vi.fn()}
        defaultOpen
      />,
    );

    expect(screen.getAllByText("ghosts-inc/ghost")).toHaveLength(2);
    expect(screen.getByText("Access")).toBeDefined();
    expect(screen.getByText("@budah1987")).toBeDefined();
    expect(screen.getByText("@amirghst")).toBeDefined();
    expect(screen.getByText("active")).toBeDefined();
  });
});
