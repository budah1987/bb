// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadRail } from "./ThreadRail";

let isCompactViewport = false;
vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => isCompactViewport,
}));

let isStandaloneCompactPwa = false;
vi.mock("@/hooks/useStandaloneCompactPwa", () => ({
  useStandaloneCompactPwa: () => isStandaloneCompactPwa,
}));

// The rail's only content today; its data hooks need a query client it has no
// business owning in this test.
vi.mock("@/components/notes/NotesPanel", () => ({
  NotesPanel: ({ threadId }: { threadId: string }) => (
    <div data-testid="notes-panel">{threadId}</div>
  ),
}));

vi.mock("./LocalServersSection", () => ({
  LocalServersSection: ({ threadId }: { threadId: string }) => (
    <div data-testid="local-servers-section">{threadId}</div>
  ),
}));

vi.mock("./PreviewSection", () => ({
  PreviewSection: ({ threadId }: { threadId: string }) => (
    <div data-testid="preview-section">{threadId}</div>
  ),
}));

vi.mock("@/components/plugin/PluginThreadRailSections", () => ({
  PluginThreadRailSections: ({ threadId }: { threadId: string }) => (
    <div data-testid="plugin-rail-sections">{threadId}</div>
  ),
}));

function renderRail() {
  const store = createStore();
  window.localStorage.setItem("bb.thread.railVisible", "true");
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
    expect(screen.getByTestId("local-servers-section").textContent).toBe(
      "thr_1",
    );
    expect(screen.getByTestId("preview-section").textContent).toBe("thr_1");
    expect(screen.getByTestId("plugin-rail-sections").textContent).toBe(
      "thr_1",
    );
  });

  it("renders nothing in the standalone compact PWA even when visible", () => {
    isStandaloneCompactPwa = true;
    isCompactViewport = true;

    const { container } = renderRail();

    expect(container.innerHTML).toBe("");
    // The preference is untouched: the phone must not hide the rail on the
    // desktop that shares this browser profile.
    expect(window.localStorage.getItem("bb.thread.railVisible")).toBe("true");
  });

  it("presents nothing while hidden, but stays mounted so it can animate out", () => {
    // Stated, not inherited from the atom's default — this asserts the hidden
    // branch, and must keep asserting it if the default ever flips.
    window.localStorage.setItem("bb.thread.railVisible", "false");

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
  });
});
