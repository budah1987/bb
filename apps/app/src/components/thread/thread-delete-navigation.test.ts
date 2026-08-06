import { describe, expect, it } from "vitest";
import { resolveThreadDeleteNavigationTarget } from "./thread-delete-navigation";

describe("resolveThreadDeleteNavigationTarget", () => {
  it("keeps active deletion in the workspace when a fallback tab exists", () => {
    expect(
      resolveThreadDeleteNavigationTarget({
        viewedThreadId: "thread-deleted",
        deletedThread: { id: "thread-deleted", projectId: "project-1" },
        fallbackThread: { id: "thread-next", projectId: "project-1" },
      }),
    ).toEqual({
      path: "/projects/project-1/threads/thread-next",
      replace: true,
    });
  });

  it("does not move the route when an inactive tab is deleted", () => {
    expect(
      resolveThreadDeleteNavigationTarget({
        viewedThreadId: "thread-active",
        deletedThread: { id: "thread-deleted", projectId: "project-1" },
        fallbackThread: { id: "thread-next", projectId: "project-1" },
      }),
    ).toBeNull();
  });

  it("uses the compose route only when no workspace fallback exists", () => {
    expect(
      resolveThreadDeleteNavigationTarget({
        viewedThreadId: "thread-deleted",
        deletedThread: { id: "thread-deleted", projectId: "project-1" },
      }),
    ).toEqual({ path: "/", replace: false });
  });
});
