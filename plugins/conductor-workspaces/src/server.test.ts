import { describe, expect, it } from "vitest";
import { formatConversationTranscript, workspaceArchiveGuard } from "./server";

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

  it("formats only user and assistant messages as transcript context", () => {
    expect(
      formatConversationTranscript("Build tab controls", [
        { kind: "system", text: "Ignored" },
        { kind: "conversation", role: "user", text: "Add close buttons." },
        {
          kind: "conversation",
          role: "assistant",
          text: "I will add them.",
        },
      ]),
    ).toBe(
      "# Conversation transcript: Build tab controls\n\n## User\n\nAdd close buttons.\n\n## Assistant\n\nI will add them.",
    );
  });
});
