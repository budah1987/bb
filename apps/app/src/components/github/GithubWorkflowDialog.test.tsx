// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GithubWorkflowDialog } from "./GithubWorkflowDialog";

const projects = [
  {
    id: "proj_console",
    name: "Console",
    githubRepository: {
      nameWithOwner: "shared/console",
      accessibleBy: ["budah1987", "amirghst"],
      activeAccount: "budah1987",
    },
  },
] as const;

const pullRequest = {
  number: 17,
  title: "Improve navigation",
  url: "https://github.com/shared/console/pull/17",
  isDraft: false,
  headBranch: "feature/navigation",
  headRepository: "budah1987/console",
  baseBranch: "main",
  author: "budah1987",
  updatedAt: "2026-08-05T00:00:00.000Z",
} as const;

afterEach(cleanup);

function renderDialog(
  onApply: ComponentProps<typeof GithubWorkflowDialog>["onApply"],
  overrides: Partial<ComponentProps<typeof GithubWorkflowDialog>> = {},
) {
  render(
    <GithubWorkflowDialog
      open
      onOpenChange={vi.fn()}
      projects={projects}
      projectId="proj_console"
      onProjectChange={vi.fn()}
      branches={["main", "develop"]}
      defaultBranch="main"
      currentBranch="main"
      pullRequests={[pullRequest]}
      onApply={onApply}
      {...overrides}
    />,
  );
}

describe("GithubWorkflowDialog", () => {
  it("applies a user-named branch in a new worktree", () => {
    const onApply = vi.fn();
    renderDialog(onApply);

    fireEvent.click(screen.getByRole("radio", { name: /New branch/u }));
    fireEvent.change(screen.getByLabelText("Branch name"), {
      target: { value: "navigation" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create branch & worktree" }),
    );

    expect(onApply).toHaveBeenCalledWith({
      projectId: "proj_console",
      checkoutMode: "worktree",
      start: {
        kind: "new-branch",
        baseBranch: "main",
        branchName: "feature/navigation",
      },
    });
  });

  it("starts a new worktree from an existing branch", () => {
    const onApply = vi.fn();
    renderDialog(onApply, {
      branches: ["main", "feature/shipments"],
    });

    fireEvent.click(
      screen.getByRole("radio", { name: "feature/shipments" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create worktree" }),
    );

    expect(onApply).toHaveBeenCalledWith({
      projectId: "proj_console",
      checkoutMode: "worktree",
      start: {
        kind: "existing-branch",
        branchName: "feature/shipments",
      },
    });
  });

  it("supports local repositories and disables GitHub-only PR selection", () => {
    const onApply = vi.fn();
    renderDialog(onApply, {
      projects: [{ id: "proj_ecto", name: "Ecto" }],
      projectId: "proj_ecto",
      branches: ["main", "feature/shipments"],
      currentBranch: "main",
      pullRequests: [],
    });

    expect(screen.getAllByText("Ecto").length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("radio", { name: /Pull request/u })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("radio", { name: "feature/shipments" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create worktree" }),
    );

    expect(onApply).toHaveBeenCalledWith({
      projectId: "proj_ecto",
      checkoutMode: "worktree",
      start: {
        kind: "existing-branch",
        branchName: "feature/shipments",
      },
    });
  });

  it("applies the selected pull request head", () => {
    const onApply = vi.fn();
    renderDialog(onApply);

    fireEvent.click(screen.getByRole("radio", { name: /Pull request/u }));
    fireEvent.click(
      screen.getByRole("radio", { name: /#17.*Improve navigation/u }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create worktree" }),
    );

    expect(onApply).toHaveBeenCalledWith({
      projectId: "proj_console",
      checkoutMode: "worktree",
      start: {
        kind: "pull-request",
        pullRequest,
        localBranchName: "pr-17-feature-navigation",
      },
    });
  });

  it("surfaces and blocks an unsafe current checkout", () => {
    const onApply = vi.fn();
    renderDialog(onApply, {
      localDisabledReason: "Checkout blocked by uncommitted changes",
    });

    const localChoice = screen.getByRole("radio", {
      name: /Current checkout/u,
    });
    expect(localChoice.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText("Checkout blocked by uncommitted changes"),
    ).toBeDefined();
  });

  it("does not overwrite an existing branch", () => {
    const onApply = vi.fn();
    renderDialog(onApply, { branches: ["main", "feature/navigation"] });

    fireEvent.click(screen.getByRole("radio", { name: /New branch/u }));
    fireEvent.change(screen.getByLabelText("Branch name"), {
      target: { value: "navigation" },
    });

    expect(
      screen.getByText("This branch already exists. Choose a new name."),
    ).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Create branch & worktree" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
