import { describe, expect, it } from "vitest";
import type { PaneContent } from "@/lib/split-layout";
import {
  canPopToInAppHistoryEntry,
  COMMAND_CENTER_NAVIGATION_KIND,
  createCommandCenterNavigation,
  parseCommandCenterNavigation,
  shouldPreserveLayoutForCommandCenter,
} from "./command-center-navigation";

const navigation = createCommandCenterNavigation({
  returnPath: "/threads/thr-a",
  returnPaneId: "pane-2",
});

const newThreadContent: PaneContent = { kind: "new-thread" };
const threadContent: PaneContent = {
  kind: "thread",
  projectId: "p1",
  threadId: "thr-a",
};

describe("parseCommandCenterNavigation", () => {
  it("accepts only the complete, correctly tagged entry", () => {
    expect(parseCommandCenterNavigation(navigation)).toEqual(navigation);
  });

  it("rejects arbitrary history state", () => {
    for (const state of [
      null,
      undefined,
      "standalone-compact-command-center",
      { kind: "some-other-intent", returnPath: "/", returnPaneId: "pane-1" },
      // Partially-shaped entries: a stray navigation must not borrow the intent.
      { kind: COMMAND_CENTER_NAVIGATION_KIND },
      { kind: COMMAND_CENTER_NAVIGATION_KIND, returnPath: "/" },
      {
        kind: COMMAND_CENTER_NAVIGATION_KIND,
        returnPath: "threads/thr-a",
        returnPaneId: "pane-2",
      },
      // Protocol-relative: looks rooted, resolves to another origin.
      {
        kind: COMMAND_CENTER_NAVIGATION_KIND,
        returnPath: "//evil.example/threads/thr-a",
        returnPaneId: "pane-2",
      },
      {
        kind: COMMAND_CENTER_NAVIGATION_KIND,
        returnPath: "/threads/thr-a",
        returnPaneId: "",
      },
      {
        kind: COMMAND_CENTER_NAVIGATION_KIND,
        returnPath: 1,
        returnPaneId: "pane-2",
      },
    ]) {
      expect(parseCommandCenterNavigation(state)).toBeNull();
    }
  });
});

describe("canPopToInAppHistoryEntry", () => {
  it("only refuses the pop when this entry is provably the app's first", () => {
    expect(canPopToInAppHistoryEntry({ state: { idx: 0 } })).toBe(false);
    expect(canPopToInAppHistoryEntry({ state: { idx: 3 } })).toBe(true);
    // Unknown shapes keep the in-session default: popping.
    for (const state of [null, undefined, {}, { idx: "2" }, { idx: -1 }]) {
      expect(canPopToInAppHistoryEntry({ state })).toBe(true);
    }
  });
});

describe("shouldPreserveLayoutForCommandCenter", () => {
  it("preserves the layout only for a validated standalone-compact commit", () => {
    expect(
      shouldPreserveLayoutForCommandCenter({
        content: newThreadContent,
        isStandaloneCompactPwa: true,
        navigation,
      }),
    ).toBe(true);

    // A browser tab or desktop window reconciles `/` exactly as it does today.
    expect(
      shouldPreserveLayoutForCommandCenter({
        content: newThreadContent,
        isStandaloneCompactPwa: false,
        navigation,
      }),
    ).toBe(false);
    // A direct `/` in the installed app carries no intent.
    expect(
      shouldPreserveLayoutForCommandCenter({
        content: newThreadContent,
        isStandaloneCompactPwa: true,
        navigation: null,
      }),
    ).toBe(false);
    // The intent is scoped to the Command Center surface, not carried onward.
    expect(
      shouldPreserveLayoutForCommandCenter({
        content: threadContent,
        isStandaloneCompactPwa: true,
        navigation,
      }),
    ).toBe(false);
  });
});
