import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { filterSidebarThreadsForSpace } from "./spaceThreads";

describe("filterSidebarThreadsForSpace", () => {
  const threads = [
    { id: "main", projectId: "proj_main" },
    { id: "other-pinned", projectId: "proj_other" },
    { id: "personal", projectId: PERSONAL_PROJECT_ID },
  ];

  it("keeps only active Space and personal threads", () => {
    expect(
      filterSidebarThreadsForSpace(threads, new Set(["proj_main"])).map(
        (thread) => thread.id,
      ),
    ).toEqual(["main", "personal"]);
  });

  it("keeps every thread when Spaces are unavailable", () => {
    expect(
      filterSidebarThreadsForSpace(threads, undefined).map(
        (thread) => thread.id,
      ),
    ).toEqual(["main", "other-pinned", "personal"]);
  });
});
