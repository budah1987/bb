// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePullRequestArchiveAction } from "./usePullRequestArchiveAction";

const mocks = vi.hoisted(() => ({
  archive: vi.fn(),
  errorToast: vi.fn(),
  loadingToast: vi.fn(() => "archive-toast"),
  successToast: vi.fn(),
}));

vi.mock("@/hooks/mutations/environment-mutations", () => ({
  useArchiveEnvironmentThreads: () => ({
    isPending: false,
    mutateAsync: mocks.archive,
  }),
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    error: mocks.errorToast,
    loading: mocks.loadingToast,
    success: mocks.successToast,
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function ArchiveHarness() {
  const location = useLocation();
  const archiveAction = usePullRequestArchiveAction({
    environmentId: "env_archive",
    projectId: "proj_archive",
  });

  return (
    <div>
      <button type="button" onClick={() => void archiveAction.archive()}>
        Archive
      </button>
      <span data-testid="location">{location.pathname}</span>
      {archiveAction.errorMessage ? (
        <span role="alert">{archiveAction.errorMessage}</span>
      ) : null}
    </div>
  );
}

function renderHarness() {
  render(
    <MemoryRouter
      initialEntries={["/projects/proj_archive/threads/thr_archive"]}
    >
      <ArchiveHarness />
    </MemoryRouter>,
  );
}

describe("usePullRequestArchiveAction", () => {
  it("navigates to the project after archiving every environment thread", async () => {
    mocks.archive.mockResolvedValueOnce({
      ok: true,
      archivedThreadIds: ["thr_archive", "thr_related"],
    });
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj_archive",
      );
    });
    expect(mocks.archive).toHaveBeenCalledWith({ id: "env_archive" });
    expect(mocks.successToast).toHaveBeenCalledWith("Archived 2 threads", {
      id: "archive-toast",
    });
  });

  it("shows an inline error and clears it when a retry succeeds", async () => {
    mocks.archive
      .mockRejectedValueOnce(new Error("Archive service unavailable"))
      .mockResolvedValueOnce({ ok: true, archivedThreadIds: ["thr_archive"] });
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "Archive service unavailable",
      );
    });
    expect(screen.getByTestId("location").textContent).toBe(
      "/projects/proj_archive/threads/thr_archive",
    );

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj_archive",
      );
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.archive).toHaveBeenCalledTimes(2);
  });
});
