// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorktreeBranchNameInput } from "./WorktreeBranchNameInput";

describe("WorktreeBranchNameInput", () => {
  it("formats branch-like input without showing a similarity warning", () => {
    const onSlugChange = vi.fn();
    render(
      <WorktreeBranchNameInput
        prefix="feature"
        slug=""
        onPrefixChange={vi.fn()}
        onSlugChange={onSlugChange}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Worktree name" }), {
      target: { value: "Feature/Add Login Flow" },
    });

    expect(onSlugChange).toHaveBeenCalledWith("feature-add-login-flow");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses a full-width touch layout for the mobile PWA", () => {
    render(
      <WorktreeBranchNameInput
        prefix="budah1987"
        slug="mobile-worktree"
        onPrefixChange={vi.fn()}
        onSlugChange={vi.fn()}
        layout="mobile"
      />,
    );

    const groups = screen.getAllByRole("group", {
      name: "Worktree branch name",
    });
    expect(groups.at(-1)?.className).toContain("h-11 w-full");
  });
});
