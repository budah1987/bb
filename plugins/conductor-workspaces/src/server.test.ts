import { describe, expect, it } from "vitest";
import { workspaceArchiveGuard } from "./server";

describe("workspaceArchiveGuard", () => {
  it("requires confirmation when the workspace has uncommitted changes", () => {
    expect(
      workspaceArchiveGuard({
        outcome: "available",
        workspace: {
          workingTree: { hasUncommittedChanges: true },
        },
      }),
    ).toBe("uncommitted");
  });

  it("allows a clean workspace and refuses an unavailable status", () => {
    expect(
      workspaceArchiveGuard({
        outcome: "available",
        workspace: {
          workingTree: { hasUncommittedChanges: false },
        },
      }),
    ).toBe("clean");
    expect(() => workspaceArchiveGuard({ outcome: "unavailable" })).toThrow(
      "Nothing was archived",
    );
  });
});
