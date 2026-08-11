import { describe, expect, it } from "vitest";
import type { BrowserAnnotationDraft } from "@/lib/browser-annotations";
import {
  browserAnnotationSelectionActionLabel,
  buildBrowserAnnotationMessage,
  toggleBrowserAnnotationSelection,
} from "./FeedbackReviewSection";

function annotation(
  index: number,
  overrides: Partial<BrowserAnnotationDraft> = {},
): BrowserAnnotationDraft {
  return {
    id: `note-${index}`,
    environmentId: null,
    threadId: "thread-1",
    tabId: "tab-1",
    selector: `main > button:nth-of-type(${index})`,
    url: `http://localhost:3000/settings?note=${index}`,
    viewport: { width: 1440, height: 900 },
    rectangle: { x: 24, y: 48, width: 120, height: 36 },
    comment: `Change button ${index}`,
    status: "open",
    revision: 1,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildBrowserAnnotationMessage", () => {
  it("includes stable browser target details", () => {
    const message = buildBrowserAnnotationMessage([annotation(1)]);

    expect(message).toContain("## 1. Change button 1");
    expect(message).toContain("Page: http://localhost:3000/settings?note=1");
    expect(message).toContain("Target: `main > button:nth-of-type(1)`");
    expect(message).toContain("Viewport: 1440 × 900");
    expect(message).toContain("Bounds: x 24, y 48, 120 × 36");
  });

  it("limits one batch to 50 annotations", () => {
    const message = buildBrowserAnnotationMessage(
      Array.from({ length: 53 }, (_, index) => annotation(index + 1)),
    );

    expect(message).toContain("## 50. Change button 50");
    expect(message).not.toContain("## 51.");
    expect(message).toContain("3 more annotations remain in the review list.");
  });

  it("can request review without file changes", () => {
    const message = buildBrowserAnnotationMessage([annotation(1)], "review");

    expect(message).toContain("then wait for confirmation");
    expect(message).toContain("Do not change files yet.");
  });
});

describe("browserAnnotationSelectionActionLabel", () => {
  it("describes the 50-item cap and lets the user clear that capped selection", () => {
    expect(browserAnnotationSelectionActionLabel(51, 0)).toBe(
      "Select first 50",
    );
    expect(browserAnnotationSelectionActionLabel(51, 50)).toBe(
      "Clear selection",
    );
  });

  it("never allows more than 50 selected annotations", () => {
    const selected = new Set(
      Array.from({ length: 50 }, (_, index) => `note-${index + 1}`),
    );

    expect(toggleBrowserAnnotationSelection(selected, "note-51")).toEqual(
      selected,
    );
    expect(toggleBrowserAnnotationSelection(selected, "note-1").size).toBe(49);
  });
});
