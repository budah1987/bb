import { describe, expect, it } from "vitest";
import type { PaneNode } from "@/lib/split-layout";
import {
  describePaneContent,
  paneRowLabel,
  selectWorkspaceRows,
} from "./compactWorkspaceLabels";

const navPanels = [{ pluginId: "docs", path: "docs", title: "Docs" }];

function threadPane(paneId: string, threadId: string): PaneNode {
  return {
    type: "pane",
    paneId,
    content: { kind: "thread", projectId: "p1", threadId },
  };
}

const panes = [
  threadPane("pane-1", "thr-a"),
  threadPane("pane-2", "thr-b"),
  threadPane("pane-3", "thr-c"),
  threadPane("pane-4", "thr-d"),
  threadPane("pane-5", "thr-e"),
  threadPane("pane-6", "thr-f"),
];

describe("paneRowLabel", () => {
  const titles = new Map([
    ["thr-a", "Refactor the swipe host"],
    ["thr-b", "Ship release notes"],
  ]);

  it("names threads from the cached titles and falls back generically", () => {
    expect(paneRowLabel(panes[0]!.content, navPanels, titles)).toBe(
      "Refactor the swipe host",
    );
    expect(paneRowLabel(panes[1]!.content, navPanels, titles)).toBe(
      "Ship release notes",
    );
    // Still loading, or no longer listed.
    expect(paneRowLabel(panes[2]!.content, navPanels, titles)).toBe("Thread");
  });

  it("keeps plugin and compose labels exactly as the shells describe them", () => {
    const panel = {
      kind: "plugin-panel" as const,
      pluginId: "docs",
      panelPath: "docs",
      subPath: "",
    };
    expect(paneRowLabel(panel, navPanels, titles)).toBe("Docs");
    expect(paneRowLabel({ kind: "new-thread" }, navPanels, titles)).toBe(
      "New thread",
    );
    // The travelling shell's vocabulary is unchanged.
    expect(describePaneContent(panes[0]!.content, navPanels)).toBe("Thread");
  });
});

describe("selectWorkspaceRows", () => {
  it("shows everything it can fit, in workspace order", () => {
    expect(selectWorkspaceRows(panes.slice(0, 4), "pane-1", 4)).toEqual(
      panes.slice(0, 4),
    );
  });

  it("always includes the active pane once the list is capped", () => {
    for (const paneId of panes.map((pane) => pane.paneId)) {
      const rows = selectWorkspaceRows(panes, paneId, 4);
      expect(rows).toHaveLength(4);
      expect(rows.map((row) => row.paneId)).toContain(paneId);
      // Reading order is never rearranged.
      expect(rows.map((row) => row.paneId)).toEqual(
        panes.filter((pane) => rows.includes(pane)).map((pane) => pane.paneId),
      );
    }
  });

  it("centres on the active pane and clamps at both ends", () => {
    expect(
      selectWorkspaceRows(panes, "pane-4", 4).map((row) => row.paneId),
    ).toEqual(["pane-3", "pane-4", "pane-5", "pane-6"]);
    expect(
      selectWorkspaceRows(panes, "pane-1", 4).map((row) => row.paneId),
    ).toEqual(["pane-1", "pane-2", "pane-3", "pane-4"]);
    expect(
      selectWorkspaceRows(panes, "pane-6", 4).map((row) => row.paneId),
    ).toEqual(["pane-3", "pane-4", "pane-5", "pane-6"]);
    // An unknown active pane still yields a stable window.
    expect(
      selectWorkspaceRows(panes, "pane-9", 4).map((row) => row.paneId),
    ).toEqual(["pane-1", "pane-2", "pane-3", "pane-4"]);
  });
});
