import { describe, expect, it } from "vitest";
import {
  buildWorktreeBranchName,
  formatWorktreeBranchSlug,
} from "./worktree-branch-name";

describe("formatWorktreeBranchSlug", () => {
  it("formats user input as lowercase kebab-case", () => {
    expect(formatWorktreeBranchSlug("  Improve PR + Worktree Naming  ")).toBe(
      "improve-pr-worktree-naming",
    );
  });

  it("flattens pasted branch paths into one slug", () => {
    expect(formatWorktreeBranchSlug("feature/nested/name")).toBe(
      "feature-nested-name",
    );
  });
});

describe("buildWorktreeBranchName", () => {
  it("joins the selected prefix and formatted slug", () => {
    expect(buildWorktreeBranchName("fix", "Login Flow")).toBe(
      "fix/login-flow",
    );
  });

  it("defers empty names to the server-generated default", () => {
    expect(buildWorktreeBranchName("budah1987", "")).toBeNull();
  });
});
