// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RailSection } from "./RailSection";

afterEach(() => {
  cleanup();
});

describe("RailSection", () => {
  it("keeps collapsed content mounted but inert for the exit transition", () => {
    const { rerender } = render(
      <RailSection isExpanded={false} label="Recap" onToggle={vi.fn()}>
        <button type="button">Review recap</button>
      </RailSection>,
    );

    const toggle = screen.getByRole("button", { name: "Recap" });
    const contentId = toggle.getAttribute("aria-controls");
    const content = contentId ? document.getElementById(contentId) : null;

    expect(content).not.toBeNull();
    expect(content?.getAttribute("aria-hidden")).toBe("true");
    expect(content?.hasAttribute("inert")).toBe(true);
    expect(content?.className).toContain("grid-rows-[0fr]");

    rerender(
      <RailSection isExpanded label="Recap" onToggle={vi.fn()}>
        <button type="button">Review recap</button>
      </RailSection>,
    );

    expect(content?.getAttribute("aria-hidden")).toBe("false");
    expect(content?.hasAttribute("inert")).toBe(false);
    expect(content?.className).toContain("grid-rows-[1fr]");
  });
});
