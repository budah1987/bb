// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import type { WorkspaceFileStatus } from "@bb/domain";
import { BbHttpError } from "@/lib/sdk";
import {
  COMMIT_SELECTION_STALE_MESSAGE,
  ThreadGitActionDialog,
  type ThreadGitActionDialogTarget,
} from "./ThreadGitActionDialog";
import type { WorkspaceChangedFilesSection } from "@/components/workspace/workspace-change-summary";

const files: WorkspaceFileStatus[] = [
  { path: "apps/app/src/a.ts", status: "M", insertions: 4, deletions: 1 },
  { path: "apps/app/src/b.ts", status: "A", insertions: 9, deletions: 0 },
  { path: "docs/c.md", status: "??", insertions: null, deletions: null },
];

function section(
  sectionFiles: WorkspaceFileStatus[] = files,
): WorkspaceChangedFilesSection {
  return {
    kind: "uncommitted",
    label: "Uncommitted",
    files: sectionFiles,
    mergeBaseRef: null,
    stats: {
      files: sectionFiles,
      insertions: 13,
      deletions: 1,
      lineStatsComplete: true,
    },
  };
}

interface RenderOptions {
  changedFilesSection?: WorkspaceChangedFilesSection;
  hasUncommittedChanges?: boolean;
  onCommit?: (request: { selectedPaths: string[] }) => Promise<void>;
  target?: ThreadGitActionDialogTarget;
  wrapper?: (children: ReactNode) => ReactNode;
}

function renderDialog(options: RenderOptions = {}) {
  const onCommit = options.onCommit ?? vi.fn(async () => {});
  const onOpenChange = vi.fn();
  const onChangeTarget = vi.fn();
  const onSquashMerge = vi.fn(async () => {});
  const renderElement = (changedFilesSection: WorkspaceChangedFilesSection) => {
    const element = (
      <ThreadGitActionDialog
        target={options.target ?? { kind: "commit" }}
        branchName="feature/selective-commit"
        worktreeName="bb-feature"
        worktreePath="/Users/dev/worktrees/bb-feature"
        changedFilesSection={changedFilesSection}
        hasUncommittedChanges={options.hasUncommittedChanges ?? true}
        showMergeBaseDetails
        mergeBaseBranch="main"
        mergeBaseBranchRef={{ name: "main", kind: "local" }}
        mergeBaseBranchOptions={["main"]}
        onMergeBaseBranchChange={() => {}}
        onOpenChange={onOpenChange}
        onChangeTarget={onChangeTarget}
        onCommit={onCommit}
        onSquashMerge={onSquashMerge}
      />
    );
    return <>{options.wrapper ? options.wrapper(element) : element}</>;
  };
  const initialSection = options.changedFilesSection ?? section();
  const view = render(renderElement(initialSection));
  return {
    onChangeTarget,
    onCommit,
    onOpenChange,
    onSquashMerge,
    refreshWith: (nextSection: WorkspaceChangedFilesSection) =>
      view.rerender(renderElement(nextSection)),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadGitActionDialog commit target", () => {
  it("selects every changed file by default and commits only the selected paths", async () => {
    const { onCommit, onOpenChange } = renderDialog();

    expect(screen.getByText("bb-feature")).not.toBeNull();
    expect(screen.getByText("feature/selective-commit")).not.toBeNull();
    for (const file of files) {
      expect(
        screen.getByRole("checkbox", { name: new RegExp(file.path) }),
      ).toHaveProperty("checked", true);
    }
    expect(screen.getByText("3 of 3 files selected")).not.toBeNull();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Untracked, docs/c.md" }),
    );

    const submit = screen.getByRole("button", { name: "Commit 2 files" });
    expect(screen.getByText("2 of 3 files selected")).not.toBeNull();
    expect(
      screen.getByText(
        "Deselected files stay changed in this worktree. Any staged files stay staged.",
      ),
    ).not.toBeNull();

    fireEvent.click(submit);

    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    expect(onCommit).toHaveBeenCalledWith({
      selectedPaths: ["apps/app/src/a.ts", "apps/app/src/b.ts"],
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("toggles every file from the master checkbox and disables submit at zero", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all files" }));

    expect(screen.getByText("0 of 3 files selected")).not.toBeNull();
    const submit = screen.getByRole("button", { name: "Commit 0 files" });
    expect(submit).toHaveProperty("disabled", true);
    expect(screen.getByText("Select at least one file")).not.toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all files" }));

    expect(screen.getByText("3 of 3 files selected")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Commit 3 files" }),
    ).toHaveProperty("disabled", false);
  });

  it("stays open and announces the failure when the commit is rejected", async () => {
    const onCommit = vi.fn(async () => {
      throw new Error("Selected files changed since you loaded them");
    });
    const { onOpenChange } = renderDialog({ onCommit });

    fireEvent.click(screen.getByRole("button", { name: "Commit 3 files" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Selected files changed since you loaded them",
      );
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(
      screen.getByRole("button", { name: "Commit 3 files" }),
    ).toHaveProperty("disabled", false);
  });

  it("explains a server-side stale selection instead of the raw git paths", async () => {
    const onCommit = vi.fn(async () => {
      throw new BbHttpError({
        status: 409,
        code: "stale_selection",
        message: "Selected paths are no longer changed: docs/c.md",
        body: {
          code: "stale_selection",
          message: "Selected paths are no longer changed: docs/c.md",
          details: { kind: "commit_selection_stale" },
        },
      });
    });
    renderDialog({ onCommit });

    fireEvent.click(screen.getByRole("button", { name: "Commit 3 files" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        COMMIT_SELECTION_STALE_MESSAGE,
      );
    });
  });

  it("flags a selected file that disappears from a background refresh", () => {
    const { refreshWith } = renderDialog();

    refreshWith(section(files.slice(0, 2)));

    expect(screen.getByRole("alert").textContent).toContain(
      COMMIT_SELECTION_STALE_MESSAGE,
    );
    expect(
      screen.getByRole("button", { name: "Commit 2 files" }),
    ).not.toBeNull();
  });

  it("keeps the same capabilities in the compact drawer", async () => {
    renderDialog({
      wrapper: (children) => (
        <CompactViewportOverrideProvider isCompactViewport>
          {children}
        </CompactViewportOverrideProvider>
      ),
    });

    expect(
      await screen.findByRole("checkbox", { name: "Select all files" }),
    ).not.toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(files.length + 1);
    expect(
      screen.getByRole("button", { name: "Commit 3 files" }),
    ).not.toBeNull();
  });
});

describe("ThreadGitActionDialog squash merge target", () => {
  it("blocks a dirty worktree and routes to the commit dialog", () => {
    const { onChangeTarget, onSquashMerge } = renderDialog({
      target: { kind: "squash_merge" },
      hasUncommittedChanges: true,
    });

    expect(screen.queryByRole("button", { name: "Squash merge" })).toBeNull();
    expect(
      screen.getByText(
        "Squash merge uses commits already on this branch. It never includes uncommitted changes.",
      ),
    ).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Commit changes first" }),
    );

    expect(onChangeTarget).toHaveBeenCalledWith({ kind: "commit" });
    expect(onSquashMerge).not.toHaveBeenCalled();
  });

  it("submits a squash merge when the worktree is clean", () => {
    const { onSquashMerge } = renderDialog({
      target: { kind: "squash_merge" },
      hasUncommittedChanges: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Squash merge" }));

    expect(onSquashMerge).toHaveBeenCalledWith({ mergeBaseBranch: "main" });
  });
});
