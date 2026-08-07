// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { STANDALONE_DISPLAY_MODE_QUERY } from "@/hooks/useStandaloneCompactPwa";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useOptionalIsSidebarShowing,
} from "./sidebar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createTouch(clientX: number, clientY: number): Touch {
  return { identifier: 1, clientX, clientY } as Touch;
}

function createTouchList(...touches: Touch[]): TouchList {
  const touchList = {
    length: touches.length,
    item: (index: number) => touches[index] ?? null,
  };
  touches.forEach((touch, index) => {
    Object.defineProperty(touchList, index, { value: touch });
  });
  return touchList as unknown as TouchList;
}

function fireTouch(
  target: Element | Document | Window,
  type: "touchstart" | "touchmove",
  touch: Touch,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: createTouchList(touch) },
    changedTouches: { value: createTouchList(touch) },
  });
  fireEvent(target, event);
}

function renderSelectableSwipeHarness() {
  render(
    <CompactViewportOverrideProvider isCompactViewport>
      <SidebarProvider>
        <SidebarTrigger />
        <Sidebar>Sidebar content</Sidebar>
        <SidebarInset>
          <div data-sidebar-swipe-selectable>Selectable message prose</div>
        </SidebarInset>
      </SidebarProvider>
    </CompactViewportOverrideProvider>,
  );
}

/** jsdom's polyfilled matchMedia always reports false, i.e. a browser tab. */
function stubStandaloneDisplayMode() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === STANDALONE_DISPLAY_MODE_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function OptionalSidebarProbe() {
  const isShowing = useOptionalIsSidebarShowing();
  return <div data-sidebar-showing={String(isShowing)} />;
}

describe("useOptionalIsSidebarShowing", () => {
  it("returns null outside SidebarProvider instead of throwing", () => {
    expect(renderToString(<OptionalSidebarProbe />)).toContain(
      'data-sidebar-showing="null"',
    );
  });
});

describe("SidebarTrigger", () => {
  it("uses the shared sidebar icon on every viewport", () => {
    const markup = renderToString(
      <SidebarProvider>
        <SidebarTrigger />
      </SidebarProvider>,
    );

    expect(markup).toContain('data-icon="PanelLeft"');
    expect(markup).not.toContain('data-icon="AlignLeft"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).not.toContain('aria-pressed="');
  });
});

describe("mobile sidebar text-selection arbitration", () => {
  it("opens from a right swipe that starts over selectable message prose", () => {
    renderSelectableSwipeHarness();
    const prose = screen.getByText("Selectable message prose");

    fireTouch(prose, "touchstart", createTouch(120, 160));
    fireTouch(window, "touchmove", createTouch(260, 164));

    expect(document.querySelector('[data-sidebar="panel"]')).not.toBeNull();
  });

  it("opens from a wheel swipe that crosses the browser-tab distance", () => {
    renderSelectableSwipeHarness();

    fireEvent.wheel(screen.getByText("Selectable message prose"), {
      clientX: 200,
      deltaX: 140,
      deltaY: 0,
    });

    expect(document.querySelector('[data-sidebar="panel"]')).not.toBeNull();
  });

  it("cancels a pending prose swipe when native text selection begins", () => {
    let hasSelection = false;
    let selectionNode: Node | null = null;
    vi.spyOn(document, "getSelection").mockImplementation(() =>
      hasSelection
        ? ({
            anchorNode: selectionNode,
            focusNode: selectionNode,
            isCollapsed: false,
          } as Selection)
        : null,
    );
    renderSelectableSwipeHarness();
    const prose = screen.getByText("Selectable message prose");
    selectionNode = prose.firstChild;

    fireTouch(prose, "touchstart", createTouch(120, 160));
    hasSelection = true;
    fireEvent(document, new Event("selectionchange"));
    fireTouch(window, "touchmove", createTouch(260, 164));

    expect(document.querySelector('[data-sidebar="panel"]')).toBeNull();
  });
});

describe("standalone compact PWA sidebar", () => {
  it("keeps every page swipe silent, including the leading edge", () => {
    stubStandaloneDisplayMode();
    renderSelectableSwipeHarness();
    const prose = screen.getByText("Selectable message prose");

    fireTouch(prose, "touchstart", createTouch(120, 160));
    fireTouch(window, "touchmove", createTouch(260, 164));
    fireEvent.wheel(prose, { clientX: 200, deltaX: 140, deltaY: 0 });

    expect(document.querySelector('[data-sidebar="panel"]')).toBeNull();

    fireTouch(prose, "touchstart", createTouch(12, 160));
    fireTouch(window, "touchmove", createTouch(180, 164));

    expect(document.querySelector('[data-sidebar="panel"]')).toBeNull();
  });

  it("keeps the explicit sidebar button available", () => {
    stubStandaloneDisplayMode();
    renderSelectableSwipeHarness();

    // The explicit affordance is unaffected, and the open drawer keeps Vaul's
    // own swipe-to-close.
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    const panel = document.querySelector('[data-sidebar="panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("data-vaul-drawer-direction")).toBe("left");
  });
});
