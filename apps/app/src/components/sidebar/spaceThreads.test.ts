import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { filterSidebarThreadsForSpace } from "./spaceThreads";

describe("filterSidebarThreadsForSpace", () => {
  const threads = [
    { id: "main", projectId: "proj_main" },
    { id: "other", projectId: "proj_other" },
    { id: "focused", projectId: "proj_other" },
    { id: "personal", projectId: PERSONAL_PROJECT_ID },
  ];

  it("keeps Pinned and Focus threads global", () => {
    expect(
      filterSidebarThreadsForSpace(
        threads,
        new Set(["proj_main"]),
        new Set(["focused"]),
      ).map((thread) => thread.id),
    ).toEqual(["main", "focused", "personal"]);
  });
});
