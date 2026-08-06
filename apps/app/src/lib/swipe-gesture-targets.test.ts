// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { isBlockingOverlayOpen } from "./swipe-gesture-targets";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(html: string) {
  document.body.innerHTML = html;
}

describe("isBlockingOverlayOpen", () => {
  it("recognizes every overlay that owns the screen", () => {
    for (const html of [
      '<div role="dialog" data-state="open"></div>',
      '<div role="alertdialog" data-state="open"></div>',
      '<div data-vaul-drawer data-state="open"></div>',
      // The mobile sidebar drawer, in each visual variant it can render with.
      '<div data-sidebar="panel" data-variant="sidebar" data-state="open"></div>',
      '<div data-sidebar="panel" data-variant="floating" data-state="open"></div>',
      '<div data-sidebar="panel" data-variant="inset" data-state="open"></div>',
      "<div data-radix-popper-content-wrapper></div>",
    ]) {
      mount(html);
      expect(isBlockingOverlayOpen(document)).toBe(true);
    }
  });

  it("is quiet once nothing is open", () => {
    mount(
      [
        '<div role="dialog" data-state="closed"></div>',
        '<div data-vaul-drawer data-state="closed"></div>',
        // A desktop sidebar panel is page furniture, not an overlay: it carries
        // no open state of its own.
        '<div data-sidebar="panel"></div>',
        '<main data-sidebar="inset"><p>page</p></main>',
      ].join(""),
    );

    expect(isBlockingOverlayOpen(document)).toBe(false);
  });
});
