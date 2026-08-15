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
import { PostMergeArchiveDialog } from "./PostMergeArchiveDialog";
import type {
  PostMergeArchiveOptions,
  PostMergeArchiveResult,
} from "./PostMergeArchiveDialog";

interface RenderOptions {
  onArchive?: (
    options: PostMergeArchiveOptions,
  ) => Promise<PostMergeArchiveResult>;
  wrapper?: (children: ReactNode) => ReactNode;
}

function renderDialog(options: RenderOptions = {}) {
  const onArchive = options.onArchive ?? vi.fn(async () => "archived" as const);
  const onOpenChange = vi.fn();
  const element = (
    <PostMergeArchiveDialog
      open
      worktreeName="bb-feature"
      onOpenChange={onOpenChange}
      onArchive={onArchive}
    />
  );
  render(<>{options.wrapper ? options.wrapper(element) : element}</>);
  return { onArchive, onOpenChange };
}

const keepButton = () =>
  screen.getByRole("button", { name: "Keep conversation" });
const archiveButton = () =>
  screen.getByRole("button", { name: /Archive workspace|Archiving/ });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PostMergeArchiveDialog", () => {
  it("names the worktree and focuses the safe choice", async () => {
    renderDialog();

    expect(
      screen.getByText(
        "Archiving closes all conversations in this worktree (bb-feature) and schedules the worktree for cleanup.",
      ),
    ).not.toBeNull();
    // Both buttons are plain buttons, so Enter on the focused Keep button can
    // never fall through to an implicit Archive submit.
    expect(keepButton()).toHaveProperty("type", "button");
    expect(archiveButton()).toHaveProperty("type", "button");
    await waitFor(() => expect(document.activeElement).toBe(keepButton()));
  });

  it("treats Keep conversation and Escape as the same safe dismissal", () => {
    const { onArchive, onOpenChange } = renderDialog();

    fireEvent.click(keepButton());
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("blocks a second submit and every dismissal while archiving", async () => {
    let resolveArchive = (_result: PostMergeArchiveResult) => {};
    const onArchive = vi.fn(
      () =>
        new Promise<PostMergeArchiveResult>((resolve) => {
          resolveArchive = resolve;
        }),
    );
    const { onOpenChange } = renderDialog({ onArchive });

    fireEvent.click(archiveButton());

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Archiving/ })).toHaveProperty(
        "disabled",
        true,
      ),
    );
    expect(keepButton()).toHaveProperty("disabled", true);

    fireEvent.click(archiveButton());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onArchive).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();

    resolveArchive("archived");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("stays open with a single inline alert when the archive fails", async () => {
    const onArchive = vi.fn(async () => {
      throw new Error("Worktree has uncommitted changes");
    });
    const { onOpenChange } = renderDialog({ onArchive });

    fireEvent.click(archiveButton());

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Worktree has uncommitted changes",
      );
    });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(archiveButton()).toHaveProperty("disabled", false);
    expect(keepButton()).toHaveProperty("disabled", false);
  });

  it("requires a second explicit action before archiving uncommitted work", async () => {
    const onArchive = vi
      .fn()
      .mockResolvedValueOnce("uncommitted_confirmation_required")
      .mockResolvedValueOnce("archived");
    const { onOpenChange } = renderDialog({ onArchive });

    fireEvent.click(archiveButton());

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Archive anyway" }),
      ).not.toBeNull(),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "has uncommitted changes",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onArchive).toHaveBeenNthCalledWith(1, {
      allowUncommittedChanges: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Archive anyway" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onArchive).toHaveBeenNthCalledWith(2, {
      allowUncommittedChanges: true,
    });
  });

  it("shows an archive failure after uncommitted work was confirmed", async () => {
    const onArchive = vi
      .fn()
      .mockResolvedValueOnce("uncommitted_confirmation_required")
      .mockRejectedValueOnce(new Error("Host disconnected"));
    renderDialog({ onArchive });

    fireEvent.click(archiveButton());
    await screen.findByRole("button", { name: "Archive anyway" });
    fireEvent.click(screen.getByRole("button", { name: "Archive anyway" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Host disconnected",
      ),
    );
  });

  it("offers both choices in the compact drawer", async () => {
    renderDialog({
      wrapper: (children) => (
        <CompactViewportOverrideProvider isCompactViewport>
          {children}
        </CompactViewportOverrideProvider>
      ),
    });

    // The shared drawer starts its transform first and realizes content two
    // animation frames later, so the choices arrive after the initial render.
    expect(
      await screen.findByRole("button", { name: "Keep conversation" }),
    ).not.toBeNull();
    expect(archiveButton()).not.toBeNull();
  });
});
