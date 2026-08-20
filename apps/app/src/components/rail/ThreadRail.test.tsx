// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRailVisibleStorageKey } from "@/lib/rail-visibility";
import { ThreadRail } from "./ThreadRail";

let isCompactViewport = false;
vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => isCompactViewport,
}));

let isStandaloneCompactPwa = false;
vi.mock("@/hooks/useStandaloneCompactPwa", () => ({
  useStandaloneCompactPwa: () => isStandaloneCompactPwa,
}));

// The rail's content owns data hooks that this composition test should not
// need to provision.
vi.mock("@/components/notes/NotesPanel", () => ({
  NotesPanel: ({
    enabled,
    threadId,
  }: {
    enabled: boolean;
    threadId: string;
  }) => (
    <div data-testid="notes-panel" data-enabled={enabled}>
      {threadId}
    </div>
  ),
}));

vi.mock("./EnvironmentSection", () => ({
  EnvironmentSection: ({
    enabled,
    threadId,
  }: {
    enabled: boolean;
    threadId: string;
  }) => (
    <div data-testid="environment-section" data-enabled={enabled}>
      {threadId}
    </div>
  ),
}));

vi.mock("./AgentActivitySection", () => ({
  AgentActivitySection: ({
    enabled,
    threadId,
  }: {
    enabled: boolean;
    threadId: string;
  }) => (
    <div data-testid="agent-activity-section" data-enabled={enabled}>
      {threadId}
    </div>
  ),
}));

vi.mock("./RepositoryHealthSection", () => ({
  RepositoryHealthSection: ({
    enabled,
    threadId,
  }: {
    enabled: boolean;
    threadId: string;
  }) => (
    <div data-testid="repository-health-section" data-enabled={enabled}>
      {threadId}
    </div>
  ),
}));

vi.mock("./FeedbackReviewSection", () => ({
  FeedbackReviewSection: ({
    enabled,
    threadId,
  }: {
    enabled: boolean;
    threadId: string;
  }) => (
    <div data-testid="feedback-review-section" data-enabled={enabled}>
      {threadId}
    </div>
  ),
}));

vi.mock("@/components/plugin/PluginThreadRailSections", () => ({
  PluginThreadRailSections: ({
    enabled,
    threadId,
  }: {
    enabled: boolean;
    threadId: string;
  }) => (
    <div data-testid="plugin-rail-sections" data-enabled={enabled}>
      {threadId}
    </div>
  ),
}));

function renderRail() {
  const store = createStore();
  window.localStorage.setItem(getRailVisibleStorageKey("thr_1"), "true");
  return render(
    <Provider store={store}>
      <ThreadRail threadId="thr_1" />
    </Provider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  isCompactViewport = false;
  isStandaloneCompactPwa = false;
});

afterEach(() => {
  cleanup();
});

describe("ThreadRail", () => {
  it("renders notes at the pane edge when visible on a wide surface", () => {
    renderRail();

    expect(screen.getByRole("complementary", { name: "Rail" })).not.toBeNull();
    expect(screen.getByTestId("notes-panel").textContent).toBe("thr_1");
    expect(screen.getByTestId("environment-section").textContent).toBe("thr_1");
    expect(screen.getByTestId("agent-activity-section").textContent).toBe(
      "thr_1",
    );
    expect(screen.getByTestId("repository-health-section").textContent).toBe(
      "thr_1",
    );
    expect(screen.getByTestId("feedback-review-section").textContent).toBe(
      "thr_1",
    );
    expect(screen.getByTestId("plugin-rail-sections").textContent).toBe(
      "thr_1",
    );
    for (const testId of [
      "notes-panel",
      "environment-section",
      "agent-activity-section",
      "repository-health-section",
      "feedback-review-section",
      "plugin-rail-sections",
    ]) {
      expect(screen.getByTestId(testId).getAttribute("data-enabled")).toBe(
        "true",
      );
    }
  });

  it("renders nothing in the standalone compact PWA even when visible", () => {
    isStandaloneCompactPwa = true;
    isCompactViewport = true;

    const { container } = renderRail();

    expect(container.innerHTML).toBe("");
    // The preference is untouched: the phone must not hide the rail on the
    // desktop that shares this browser profile.
    expect(window.localStorage.getItem(getRailVisibleStorageKey("thr_1"))).toBe(
      "true",
    );
  });

  it("stays mounted while hidden and pauses child work", () => {
    // Stated, not inherited from the atom's default — this asserts the hidden
    // branch, and must keep asserting it if the default ever flips.
    window.localStorage.setItem(getRailVisibleStorageKey("thr_1"), "false");

    const { container } = render(
      <Provider store={createStore()}>
        <ThreadRail threadId="thr_1" />
      </Provider>,
    );

    // Out of the accessibility tree and out of the tab order — as good as gone
    // for anyone using the app.
    expect(screen.queryByRole("complementary", { name: "Rail" })).toBeNull();

    const card = container.querySelector("[data-thread-rail]");
    expect(card).not.toBeNull();
    expect(card?.getAttribute("data-state")).toBe("closed");
    expect(card?.hasAttribute("inert")).toBe(true);
    // Slid off the right edge rather than removed, which is what lets the
    // toggle animate in both directions.
    expect(card?.className).toContain("translate-x-full");
    expect(card?.className).toContain("opacity-0");
    for (const testId of [
      "notes-panel",
      "environment-section",
      "agent-activity-section",
      "repository-health-section",
      "feedback-review-section",
      "plugin-rail-sections",
    ]) {
      expect(screen.getByTestId(testId).getAttribute("data-enabled")).toBe(
        "false",
      );
    }
  });
});
