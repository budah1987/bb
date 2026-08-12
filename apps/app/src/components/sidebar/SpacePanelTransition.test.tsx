// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpacePanelTransition } from "./SpacePanelTransition";

const matchMedia = vi.fn().mockReturnValue({ matches: false });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", matchMedia);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    ),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((handle: number) => window.clearTimeout(handle)),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SpacePanelTransition", () => {
  it("slides forward spaces from right to left", () => {
    const result = render(
      <SpacePanelTransition activeSpaceId="space-1" direction={1}>
        <span>Space one</span>
      </SpacePanelTransition>,
    );

    result.rerender(
      <SpacePanelTransition activeSpaceId="space-2" direction={1}>
        <span>Space two</span>
      </SpacePanelTransition>,
    );

    const container = screen.getByTestId("space-panel-transition");
    expect(container.getAttribute("data-page")).toBe("1");
    expect(
      screen.getByText("Space one").closest("section")?.dataset.pageId,
    ).toBe("1");
    expect(
      screen.getByText("Space two").closest("section")?.dataset.pageId,
    ).toBe("2");

    act(() => vi.advanceTimersByTime(0));
    expect(container.getAttribute("data-page")).toBe("2");

    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByText("Space one")).toBeNull();
    expect(
      screen.getByText("Space two").closest("section")?.hasAttribute("inert"),
    ).toBe(false);
  });

  it("reverses the page direction for a previous space", () => {
    const result = render(
      <SpacePanelTransition activeSpaceId="space-2" direction={1}>
        <span>Space two</span>
      </SpacePanelTransition>,
    );

    result.rerender(
      <SpacePanelTransition activeSpaceId="space-1" direction={-1}>
        <span>Space one</span>
      </SpacePanelTransition>,
    );

    expect(
      screen.getByText("Space two").closest("section")?.dataset.pageId,
    ).toBe("2");
    expect(
      screen.getByText("Space one").closest("section")?.dataset.pageId,
    ).toBe("1");
  });

  it("switches immediately when reduced motion is active", () => {
    matchMedia.mockReturnValueOnce({ matches: true });
    const result = render(
      <SpacePanelTransition activeSpaceId="space-1" direction={1}>
        <span>Space one</span>
      </SpacePanelTransition>,
    );

    result.rerender(
      <SpacePanelTransition activeSpaceId="space-2" direction={1}>
        <span>Space two</span>
      </SpacePanelTransition>,
    );

    expect(screen.queryByText("Space one")).toBeNull();
    expect(screen.getByText("Space two")).toBeDefined();
  });
});
