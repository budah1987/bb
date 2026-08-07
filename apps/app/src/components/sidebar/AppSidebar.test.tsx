// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SplitLayout } from "@/lib/split-layout";
import {
  createSidebarCommandCenterNavigation,
  MobileCommandCenterSidebarAction,
} from "./AppSidebar";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const layout: SplitLayout = {
  root: {
    type: "pane",
    paneId: "pane-focused",
    content: {
      kind: "thread",
      projectId: "project-1",
      threadId: "thread-1",
    },
  },
  focusedPaneId: "pane-focused",
};

describe("MobileCommandCenterSidebarAction", () => {
  it("is a mobile-only sidebar action with an accessible active state", () => {
    const onSelect = vi.fn();
    const result = render(
      <MobileCommandCenterSidebarAction isActive={true} onSelect={onSelect} />,
    );

    const container = screen.getByTestId("app-sidebar-command-center");
    const action = screen.getByRole("button", { name: "Command Center" });

    expect(container.className).toContain("max-md:block");
    expect(container.className).toContain("pointer-coarse:block");
    expect(action.getAttribute("aria-current")).toBe("page");
    expect(result.container.querySelector('[data-icon="GridView"]')).not.toBe(
      null,
    );

    fireEvent.click(action);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("does not mark the action as current away from the Command Center", () => {
    render(
      <MobileCommandCenterSidebarAction isActive={false} onSelect={vi.fn()} />,
    );

    expect(
      screen
        .getByRole("button", { name: "Command Center" })
        .hasAttribute("aria-current"),
    ).toBe(false);
  });
});

describe("createSidebarCommandCenterNavigation", () => {
  it("carries the focused pane and current route into the swipe navigation contract", () => {
    expect(
      createSidebarCommandCenterNavigation({
        layout,
        returnPath: "/threads/thread-1?view=compact#message-4",
      }),
    ).toEqual({
      kind: "standalone-compact-command-center",
      returnPaneId: "pane-focused",
      returnPath: "/threads/thread-1?view=compact#message-4",
    });
  });

  it("falls back to ordinary root navigation without a workspace layout", () => {
    expect(
      createSidebarCommandCenterNavigation({
        layout: null,
        returnPath: "/settings",
      }),
    ).toBeUndefined();
  });
});
