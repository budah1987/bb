import { describe, expect, it } from "vitest";
import {
  BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
  bbDesktopBrowserAttachRequestSchema,
  bbDesktopBrowserAnnotationDraftSchema,
  bbDesktopBrowserSetAnnotationModeRequestSchema,
  bbDesktopBrowserSyncAnnotationsRequestSchema,
  bbDesktopBrowserSetBoundsRequestSchema,
  bbDesktopBrowserStateSchema,
  clampBbDesktopBrowserViewBounds,
  type BbDesktopBrowserViewBounds,
  type BbDesktopBrowserViewportBounds,
} from "../src/index.js";

interface BrowserBoundsClampTestCase {
  bounds: BbDesktopBrowserViewBounds;
  expected: BbDesktopBrowserViewBounds;
  label: string;
  viewport: BbDesktopBrowserViewportBounds;
}

const browserBoundsClampTestCases: BrowserBoundsClampTestCase[] = [
  {
    label: "anchors the left edge and trims overflow at the right and bottom",
    bounds: { x: 180, y: 48, width: 400, height: 420 },
    viewport: { width: 500, height: 360 },
    expected: { x: 180, y: 48, width: 320, height: 312 },
  },
  {
    label: "clamps negative origins to the host content edge",
    bounds: { x: -24, y: -10, width: 200, height: 120 },
    viewport: { width: 500, height: 360 },
    expected: { x: 0, y: 0, width: 176, height: 110 },
  },
  {
    label: "collapses bounds that start outside the host content area",
    bounds: { x: 640, y: 400, width: 120, height: 90 },
    viewport: { width: 500, height: 360 },
    expected: { x: 500, y: 360, width: 0, height: 0 },
  },
  {
    label: "leaves bounds that already fit the viewport untouched",
    bounds: { x: 100, y: 50, width: 300, height: 250 },
    viewport: { width: 500, height: 360 },
    expected: { x: 100, y: 50, width: 300, height: 250 },
  },
];

describe("desktop browser bounds containment", () => {
  it.each(browserBoundsClampTestCases)("$label", (testCase) => {
    expect(
      clampBbDesktopBrowserViewBounds({
        bounds: testCase.bounds,
        viewport: testCase.viewport,
      }),
    ).toEqual(testCase.expected);
  });
});

describe("desktop browser IPC schemas", () => {
  it("accepts a well-formed attach request and rejects bad shapes", () => {
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
      }).success,
    ).toBe(true);

    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserSetBoundsRequestSchema.safeParse({
        tabId: "browser:abc",
        bounds: { x: 0, y: 0, width: -1, height: 600 },
      }).success,
    ).toBe(false);
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: "",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: false,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("accepts a well-formed state push and rejects non-integer bounds", () => {
    expect(
      bbDesktopBrowserStateSchema.safeParse({
        tabId: "browser:abc",
        url: "https://example.com",
        title: "Example",
        isLoading: false,
        canGoBack: true,
        canGoForward: false,
        errorText: null,
      }).success,
    ).toBe(true);

    expect(
      bbDesktopBrowserSetBoundsRequestSchema.safeParse({
        tabId: "browser:abc",
        bounds: { x: 0.5, y: 0, width: 800, height: 600 },
      }).success,
    ).toBe(false);
  });

  it("rejects oversized URLs beyond the length cap", () => {
    const longUrl = `https://example.com/${"a".repeat(
      BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
    )}`;
    expect(
      bbDesktopBrowserAttachRequestSchema.safeParse({
        tabId: "browser:abc",
        url: longUrl,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        visible: true,
      }).success,
    ).toBe(false);
  });

  it("validates annotation mode commands and structured drafts", () => {
    expect(
      bbDesktopBrowserSetAnnotationModeRequestSchema.safeParse({
        tabId: "browser:abc",
        enabled: true,
      }).success,
    ).toBe(true);
    expect(
      bbDesktopBrowserSyncAnnotationsRequestSchema.safeParse({
        tabId: "browser:abc",
        annotations: [
          {
            id: "annotation-1",
            number: 1,
            selector: "main > button",
            comment: "Use the primary button style here.",
            rectangle: { x: 32, y: 80, width: 140, height: 40 },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      bbDesktopBrowserAnnotationDraftSchema.safeParse({
        tabId: "browser:abc",
        selector: "main > button:nth-of-type(2)",
        url: "http://localhost:3000/settings",
        viewport: { width: 1440, height: 900 },
        rectangle: { x: 32, y: 80, width: 140, height: 40 },
        comment: "Use the primary button style here.",
      }).success,
    ).toBe(true);
    expect(
      bbDesktopBrowserAnnotationDraftSchema.safeParse({
        tabId: "browser:abc",
        selector: "button",
        url: "http://localhost:3000",
        viewport: { width: 1440, height: 900 },
        rectangle: { x: 0, y: 0, width: 10, height: 10 },
        comment: "   ",
      }).success,
    ).toBe(false);
  });
});
