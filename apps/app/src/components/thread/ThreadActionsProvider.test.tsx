// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { Thread } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ThreadActionsProvider,
  useArchivingThreadIds,
  useThreadActions,
} from "./ThreadActionsProvider";

const mocks = vi.hoisted(() => ({
  archiveMutate: vi.fn(),
  closePanesForThreads: vi.fn(() => ({
    focusedRoute: null,
    removedAny: false,
  })),
  isCompactViewport: false,
  navigate: vi.fn(),
  successToast: vi.fn(),
  threadId: "thr_test" as string | null,
  unarchiveMutate: vi.fn(),
}));

vi.mock("jotai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jotai")>();
  return {
    ...actual,
    useSetAtom: () => mocks.closePanesForThreads,
  };
});

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => mocks.isCompactViewport,
}));

vi.mock("@/hooks/useRouteState", () => ({
  useRouteState: () => ({ threadId: mocks.threadId }),
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    success: mocks.successToast,
  },
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({
  useArchiveThreadAndChildren: () => ({ mutate: mocks.archiveMutate }),
  useDeleteThread: () => ({ isPending: false, mutate: vi.fn() }),
  useMarkThreadRead: () => ({ mutate: vi.fn() }),
  useMarkThreadUnread: () => ({ mutate: vi.fn() }),
  usePinThread: () => ({ mutate: vi.fn() }),
  useUnarchiveThread: () => ({ mutate: mocks.unarchiveMutate }),
  useUnpinThread: () => ({ mutate: vi.fn() }),
  useUpdateThread: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("@/components/dialogs/ThreadRenameDialog", () => ({
  ThreadRenameDialog: () => null,
}));

vi.mock("@/components/dialogs/ThreadDeleteDialog", () => ({
  ThreadDeleteDialog: () => null,
}));

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    archivedAt: null,
    childOrigin: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "env_test",
    id: "thr_test",
    lastReadAt: null,
    latestAttentionAt: 1,
    originKind: null,
    originPluginId: null,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "proj_test",
    providerId: "codex",
    sectionId: null,
    sourceThreadId: null,
    status: "idle",
    title: "Archive behavior",
    titleFallback: "Archive behavior",
    updatedAt: 1,
    visibility: "visible",
    ...overrides,
  };
}

function ArchiveHarness({ thread }: { thread: Thread }) {
  const { archiveThreadAndChildren } = useThreadActions();
  const archivingThreadIds = useArchivingThreadIds();
  return (
    <button
      type="button"
      data-archiving={archivingThreadIds.has(thread.id)}
      onClick={() => archiveThreadAndChildren(thread)}
    >
      Archive
    </button>
  );
}

function renderArchiveHarness(thread = makeThread()) {
  return render(
    <ThreadActionsProvider>
      <ArchiveHarness thread={thread} />
    </ThreadActionsProvider>,
  );
}

function archiveSuccess(archivedThreadIds = ["thr_test"]) {
  const options = mocks.archiveMutate.mock.calls[0]?.[1];
  if (!options) throw new Error("Missing archive mutation options");
  act(() => options.onSuccess({ archivedThreadIds, ok: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.isCompactViewport = false;
  mocks.threadId = "thr_test";
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ThreadActionsProvider archive behavior", () => {
  it("animates the desktop row before archiving and keeps the conversation open", () => {
    renderArchiveHarness();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByRole("button").getAttribute("data-archiving")).toBe(
      "true",
    );
    expect(mocks.archiveMutate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(250));
    expect(mocks.archiveMutate).toHaveBeenCalledWith(
      { id: "thr_test" },
      expect.any(Object),
    );

    archiveSuccess();
    expect(mocks.closePanesForThreads).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("returns mobile to the Command Center when the open conversation is archived", () => {
    mocks.isCompactViewport = true;
    renderArchiveHarness();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(mocks.archiveMutate).toHaveBeenCalledTimes(1);
    archiveSuccess();

    expect(mocks.closePanesForThreads).toHaveBeenCalledWith(["thr_test"]);
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("keeps the current mobile screen when another conversation is archived", () => {
    mocks.isCompactViewport = true;
    mocks.threadId = "thr_other";
    renderArchiveHarness();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    archiveSuccess();

    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("shows undo and close actions for the archive grace period", () => {
    mocks.isCompactViewport = true;
    renderArchiveHarness();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    archiveSuccess(["thr_test", "thr_child"]);

    expect(mocks.successToast).toHaveBeenCalledWith(
      "Conversation archived",
      expect.objectContaining({
        className: "bb-archive-toast",
        duration: 10_000,
        id: "thread-archived-thr_test",
      }),
    );
    const toastOptions = mocks.successToast.mock.calls[0]?.[1];
    expect(toastOptions.action.label).toBe("Undo");
    expect(toastOptions.cancel.label).toBe("Close");

    Reflect.apply(toastOptions.action.onClick, null, [new MouseEvent("click")]);
    expect(mocks.unarchiveMutate).toHaveBeenCalledWith({ id: "thr_test" });
    expect(mocks.unarchiveMutate).toHaveBeenCalledWith({ id: "thr_child" });
  });
});
