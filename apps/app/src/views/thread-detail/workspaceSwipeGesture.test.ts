// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { PaneNode } from "@/lib/split-layout";
import {
  abandonsWorkspaceSwipe,
  decideWorkspaceSwipe,
  describeWorkspacePosition,
  hasWorkspaceSwipeIntent,
  isWorkspaceSwipeTextEditingTarget,
  readReleaseVelocity,
  resolveWorkspaceSwipePaneId,
  shouldIgnoreWorkspaceSwipeTarget,
  WORKSPACE_SWIPE_COMMAND_CENTER_RATIO,
  WORKSPACE_SWIPE_FLING_VELOCITY_PX_PER_SEC,
  WORKSPACE_SWIPE_INTENT_PX,
  WORKSPACE_SWIPE_RIGHT_PANEL_RATIO,
  WORKSPACE_SWIPE_VELOCITY_STALE_MS,
} from "./workspaceSwipeGesture";

const WIDTH = 400;

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
];

function decide(
  deltaX: number,
  velocityX: number,
  allowsCommandCenter = true,
  allowsRightPanel = true,
) {
  return decideWorkspaceSwipe({
    deltaX,
    velocityX,
    width: WIDTH,
    allowsCommandCenter,
    allowsRightPanel,
  });
}

describe("workspace swipe intent", () => {
  it("engages only on dominant horizontal travel", () => {
    expect(hasWorkspaceSwipeIntent(WORKSPACE_SWIPE_INTENT_PX, 2)).toBe(true);
    expect(hasWorkspaceSwipeIntent(WORKSPACE_SWIPE_INTENT_PX - 1, 0)).toBe(
      false,
    );
    // A diagonal drag belongs to the scroller until horizontal clearly wins.
    expect(hasWorkspaceSwipeIntent(20, 18)).toBe(false);
  });

  it("hands the pointer back once travel turns vertical", () => {
    expect(abandonsWorkspaceSwipe(4, 30)).toBe(true);
    expect(abandonsWorkspaceSwipe(30, 4)).toBe(false);
  });
});

describe("decideWorkspaceSwipe", () => {
  it("commits a pane on short distance, or on a deliberate flick", () => {
    expect(decide(WIDTH * 0.18, 0)).toEqual({
      kind: "pane",
      direction: "right",
    });
    expect(decide(-WIDTH * 0.4, 0)).toEqual({
      kind: "pane",
      direction: "left",
    });
    expect(decide(WIDTH * 0.17, 0)).toEqual({ kind: "cancel" });
    expect(
      decide(WIDTH * 0.09, WORKSPACE_SWIPE_FLING_VELOCITY_PX_PER_SEC),
    ).toEqual({ kind: "pane", direction: "right" });
    // Just under the fling distance, and just under its speed.
    expect(decide(WIDTH * 0.07, 900)).toEqual({ kind: "cancel" });
    expect(
      decide(WIDTH * 0.15, WORKSPACE_SWIPE_FLING_VELOCITY_PX_PER_SEC - 1),
    ).toEqual({ kind: "cancel" });
    // A rebounding finger (travelled right, now moving left) is not a fling.
    expect(decide(WIDTH * 0.15, -2_000)).toEqual({ kind: "cancel" });
  });

  it("opens the Command Center on long rightward distance only", () => {
    expect(decide(WIDTH * WORKSPACE_SWIPE_COMMAND_CENTER_RATIO, 0)).toEqual({
      kind: "command-center",
    });
    // The headline rule: a fast short flick stays a pane change forever.
    expect(decide(WIDTH * 0.3, 4_000)).toEqual({
      kind: "pane",
      direction: "right",
    });
    // Leftward distance is never a Command Center, however far it travels.
    expect(decide(-WIDTH * 0.9, -4_000, true, false)).toEqual({
      kind: "pane",
      direction: "left",
    });
    // Where it isn't offered, the same drag is an ordinary pane change.
    expect(decide(WIDTH * 0.8, 0, false)).toEqual({
      kind: "pane",
      direction: "right",
    });
  });

  it("opens the right panel on long leftward distance only", () => {
    expect(decide(-WIDTH * WORKSPACE_SWIPE_RIGHT_PANEL_RATIO, 0)).toEqual({
      kind: "right-panel",
    });
    expect(decide(-WIDTH * 0.3, -4_000)).toEqual({
      kind: "pane",
      direction: "left",
    });
    expect(decide(-WIDTH * 0.8, 0, true, false)).toEqual({
      kind: "pane",
      direction: "left",
    });
  });

  it("cancels without a measurable surface", () => {
    expect(
      decideWorkspaceSwipe({
        deltaX: 300,
        velocityX: 0,
        width: 0,
        allowsCommandCenter: true,
        allowsRightPanel: true,
      }),
    ).toEqual({ kind: "cancel" });
    expect(decide(0, 0)).toEqual({ kind: "cancel" });
  });
});

describe("readReleaseVelocity", () => {
  it("keeps a live sample and drops a stale one", () => {
    expect(readReleaseVelocity(1_200, 0)).toBe(1_200);
    expect(readReleaseVelocity(1_200, WORKSPACE_SWIPE_VELOCITY_STALE_MS)).toBe(
      1_200,
    );
    expect(
      readReleaseVelocity(1_200, WORKSPACE_SWIPE_VELOCITY_STALE_MS + 1),
    ).toBe(0);
  });

  it("turns a paused short drag into a cancel, unlike an immediate release", () => {
    const paused = readReleaseVelocity(2_000, 300);
    const immediate = readReleaseVelocity(2_000, 16);

    expect(decide(WIDTH * 0.15, paused)).toEqual({ kind: "cancel" });
    expect(decide(WIDTH * 0.15, immediate)).toEqual({
      kind: "pane",
      direction: "right",
    });
  });
});

describe("resolveWorkspaceSwipePaneId", () => {
  it("moves toward the physical swipe direction and wraps", () => {
    expect(resolveWorkspaceSwipePaneId(panes, "pane-2", "right")).toBe(
      "pane-3",
    );
    expect(resolveWorkspaceSwipePaneId(panes, "pane-2", "left")).toBe("pane-1");
    expect(resolveWorkspaceSwipePaneId(panes, "pane-1", "right")).toBe(
      "pane-2",
    );
    expect(resolveWorkspaceSwipePaneId(panes, "pane-3", "left")).toBe("pane-2");
  });

  it("has nowhere to go in a single-pane workspace", () => {
    expect(
      resolveWorkspaceSwipePaneId([panes[0]!], "pane-1", "right"),
    ).toBeNull();
  });
});

describe("describeWorkspacePosition", () => {
  it("announces the position, and nothing for an unknown pane", () => {
    expect(describeWorkspacePosition(panes, "pane-2")).toBe("Workspace 2 of 3");
    expect(describeWorkspacePosition(panes, "pane-9")).toBeNull();
  });
});

describe("shouldIgnoreWorkspaceSwipeTarget", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function mount(html: string): HTMLElement {
    document.body.innerHTML = `<div data-workspace-swipe-host>${html}</div>`;
    const target = document.querySelector("[data-target]");
    if (!(target instanceof HTMLElement)) {
      throw new Error("Expected a target element");
    }
    return target;
  }

  it("keeps its hands off controls and overlay surfaces", () => {
    for (const html of [
      "<input data-target />",
      "<textarea data-target></textarea>",
      "<select data-target></select>",
      '<div contenteditable="true"><span data-target>x</span></div>',
      '<div role="slider" data-target></div>',
      '<div role="dialog"><p data-target>x</p></div>',
      '<div role="menu"><p data-target>x</p></div>',
      "<div data-radix-popper-content-wrapper><p data-target>x</p></div>",
      "<div data-vaul-drawer><p data-target>x</p></div>",
      '<div data-sidebar="trigger"><span data-target>x</span></div>',
      "<div data-no-workspace-swipe><p data-target>x</p></div>",
    ]) {
      expect(shouldIgnoreWorkspaceSwipeTarget(mount(html))).toBe(true);
    }
  });

  it("recognizes focused text-editing surfaces and their descendants", () => {
    expect(
      isWorkspaceSwipeTextEditingTarget(
        mount('<div contenteditable="true"><span data-target>x</span></div>'),
      ),
    ).toBe(true);
    expect(
      isWorkspaceSwipeTextEditingTarget(mount("<p data-target>x</p>")),
    ).toBe(false);
  });

  it("owns an ordinary page target", () => {
    expect(
      shouldIgnoreWorkspaceSwipeTarget(mount("<p data-target>x</p>")),
    ).toBe(false);
    expect(shouldIgnoreWorkspaceSwipeTarget(null)).toBe(false);
  });

  it("yields to a horizontal scroller under the finger", () => {
    const target = mount(
      '<div style="overflow-x: auto"><p data-target>wide row</p></div>',
    );
    const scroller = target.parentElement;
    if (scroller === null) {
      throw new Error("Expected a scroller");
    }
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 400 },
    });

    expect(shouldIgnoreWorkspaceSwipeTarget(target)).toBe(true);
  });
});
