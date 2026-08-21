// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserAnnotationDraft } from "@/lib/browser-annotations";
import { FeedbackReviewSection } from "./FeedbackReviewSection";

const { draft, removeDraft } = vi.hoisted(() => ({
  removeDraft: vi.fn(),
  draft: {
    id: "annotation-1",
    environmentId: "environment-1",
    threadId: "thread-1",
    tabId: "browser-1",
    selector: "main > button",
    url: "https://preview.example.test/settings",
    viewport: { width: 1440, height: 900 },
    rectangle: { x: 24, y: 48, width: 120, height: 36 },
    comment: "Make this action clearer",
    status: "open",
    revision: 1,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  } satisfies BrowserAnnotationDraft,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/browser-annotations", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/browser-annotations")>();
  return {
    ...original,
    useBrowserAnnotationPersistenceError: () => ({
      clear: vi.fn(),
      error: null,
      errorCount: 0,
      retryAll: vi.fn(),
    }),
    useThreadBrowserAnnotations: () => ({
      drafts: [draft],
      markSentDraft: vi.fn(),
      removeDraft,
      reopenDraft: vi.fn(),
      resolveDraft: vi.fn(),
      selectDraft: vi.fn(),
      selectedId: null,
    }),
  };
});

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({ data: { projectId: "project-1" } }),
  useThreads: () => ({ data: [], isError: false, isLoading: false }),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useCreateThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useSendThreadMessage: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  removeDraft.mockReset();
});

describe("FeedbackReviewSection", () => {
  it("deletes an annotation from the right rail", () => {
    render(<FeedbackReviewSection threadId="thread-1" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Delete annotation 1" }),
    );

    expect(removeDraft).toHaveBeenCalledWith("annotation-1");
  });
});
