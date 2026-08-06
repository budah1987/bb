// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  loadCollapsedSections,
  loadClosedTabIds,
  loadProjectOrder,
  moveProjectId,
  orderProjectIds,
  saveCollapsedSections,
  saveClosedTabIds,
  saveProjectOrder,
} from "./sidebar-preferences";

beforeEach(() => window.localStorage.clear());

describe("sidebar preferences", () => {
  it("keeps known projects in the preferred order and appends new projects", () => {
    expect(orderProjectIds(["a", "b", "c"], ["c", "missing", "a"])).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("validates persisted arrays before returning them", () => {
    window.localStorage.setItem(
      "bb.conductor.project-order.v1",
      JSON.stringify(["b", 4, "b", "a"]),
    );
    expect(loadProjectOrder()).toEqual(["b", "a"]);

    window.localStorage.setItem("bb.conductor.collapsed-sections.v1", "nope");
    expect([...loadCollapsedSections()]).toEqual([]);
  });

  it("persists project order and collapsed section ids", () => {
    saveProjectOrder(["b", "a"]);
    saveCollapsedSections(new Set(["project:a", "threads"]));
    expect(loadProjectOrder()).toEqual(["b", "a"]);
    expect([...loadCollapsedSections()]).toEqual(["project:a", "threads"]);
  });

  it("persists a last-closed-first tab stack per workspace", () => {
    saveClosedTabIds("project-1:environment-1", ["thread-2", "thread-1"]);
    saveClosedTabIds("project-1:environment-2", ["thread-3"]);

    expect(loadClosedTabIds("project-1:environment-1")).toEqual([
      "thread-2",
      "thread-1",
    ]);
    expect(loadClosedTabIds("project-1:environment-2")).toEqual(["thread-3"]);

    saveClosedTabIds("project-1:environment-1", []);
    expect(loadClosedTabIds("project-1:environment-1")).toEqual([]);
    expect(loadClosedTabIds("project-1:environment-2")).toEqual(["thread-3"]);
  });

  it("drops invalid closed-tab persistence without affecting other settings", () => {
    window.localStorage.setItem(
      "bb.conductor.closed-tabs.v1",
      JSON.stringify({
        valid: ["thread-1", 4, "thread-1", "thread-2"],
        invalid: "thread-3",
      }),
    );

    expect(loadClosedTabIds("valid")).toEqual(["thread-1", "thread-2"]);
    expect(loadClosedTabIds("invalid")).toEqual([]);
  });

  it("moves a dragged repository relative to its drop target", () => {
    expect(moveProjectId(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveProjectId(["a", "b"], "missing", "a")).toEqual(["a", "b"]);
  });
});
