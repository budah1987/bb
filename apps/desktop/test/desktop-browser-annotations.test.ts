import { describe, expect, it } from "vitest";
import {
  BB_BROWSER_ANNOTATION_DISABLE_SCRIPT,
  BB_BROWSER_ANNOTATION_ENABLE_SCRIPT,
  buildBrowserAnnotationSyncScript,
  parseBrowserAnnotationDraft,
} from "../src/desktop-browser-annotations.js";

describe("desktop browser annotations", () => {
  it("attributes a valid isolated-world draft to its browser tab", () => {
    expect(
      parseBrowserAnnotationDraft("browser:settings", {
        selector: "main > button:nth-of-type(2)",
        url: "http://localhost:3000/settings",
        viewport: { width: 1200, height: 800 },
        rectangle: { x: 20, y: 30, width: 160, height: 44 },
        comment: "Increase the spacing.",
      }),
    ).toEqual({
      tabId: "browser:settings",
      selector: "main > button:nth-of-type(2)",
      url: "http://localhost:3000/settings",
      viewport: { width: 1200, height: 800 },
      rectangle: { x: 20, y: 30, width: 160, height: 44 },
      comment: "Increase the spacing.",
    });
  });

  it("rejects empty comments and ships isolated controller cleanup", () => {
    expect(
      parseBrowserAnnotationDraft("browser:settings", {
        selector: "button",
        url: "http://localhost:3000",
        viewport: { width: 1200, height: 800 },
        rectangle: { x: 20, y: 30, width: 160, height: 44 },
        comment: "",
      }),
    ).toBeNull();
    expect(BB_BROWSER_ANNOTATION_ENABLE_SCRIPT).toContain(
      "data-bb-annotation-ui",
    );
    for (const mode of [
      "element",
      "text",
      "area",
      "multi",
      "comment",
      "pause",
    ]) {
      expect(BB_BROWSER_ANNOTATION_ENABLE_SCRIPT).toContain(
        `data-mode=\"${mode}\"`,
      );
    }
    expect(BB_BROWSER_ANNOTATION_ENABLE_SCRIPT).toContain(
      'marker.className = "marker"',
    );
    expect(BB_BROWSER_ANNOTATION_ENABLE_SCRIPT).toContain(
      "controller.markers.set(annotation.id, entry)",
    );
    expect(BB_BROWSER_ANNOTATION_DISABLE_SCRIPT).toContain(
      "controller.dispose()",
    );
  });

  it("uses neutral adaptive surfaces and compositor-safe motion", () => {
    expect(
      () => new Function(BB_BROWSER_ANNOTATION_ENABLE_SCRIPT),
    ).not.toThrow();
    expect(BB_BROWSER_ANNOTATION_ENABLE_SCRIPT).toContain("data-scheme");
    expect(BB_BROWSER_ANNOTATION_ENABLE_SCRIPT).toContain(
      "requestAnimationFrame(runLayout)",
    );
    expect(BB_BROWSER_ANNOTATION_ENABLE_SCRIPT).toContain("calc(100vw - 24px)");
    expect(BB_BROWSER_ANNOTATION_ENABLE_SCRIPT).toContain(
      "Control or Command+Shift+Enter",
    );
    expect(BB_BROWSER_ANNOTATION_ENABLE_SCRIPT).not.toContain(
      "backdrop-filter",
    );
    expect(BB_BROWSER_ANNOTATION_ENABLE_SCRIPT).not.toContain("#7c3aed");
    expect(BB_BROWSER_ANNOTATION_ENABLE_SCRIPT).not.toMatch(
      /transition[^;]*(?:left|top|width|height)/,
    );
  });

  it("serializes the authoritative open-marker set for the isolated controller", () => {
    const script = buildBrowserAnnotationSyncScript([
      {
        id: "annotation-1",
        number: 1,
        selector: "main > button",
        comment: "Increase spacing.",
        rectangle: { x: 20, y: 30, width: 160, height: 44 },
      },
    ]);
    expect(script).toContain("controller.syncMarkers");
    expect(script).toContain('"id":"annotation-1"');
  });
});
