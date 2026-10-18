// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-path">{location.pathname}</output>;
}

function renderMobileSidebarHarness(initialPath = "/") {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarProvider>
          <SidebarTrigger />
          <Sidebar>Sidebar content</Sidebar>
          <SidebarInset>
            <div>Selectable message prose</div>
            <LocationProbe />
          </SidebarInset>
        </SidebarProvider>
      </CompactViewportOverrideProvider>
    </MemoryRouter>,
  );
}

function fireWindowPointer(
  type: "pointermove" | "pointerup" | "pointercancel",
  clientX: number,
  clientY: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
    pointerId: { value: 1 },
    pointerType: { value: "touch" },
  });
  fireEvent(window, event);
  return event;
}

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

describe("Sidebar", () => {
  it("keeps regular viewport content inside the safe area", () => {
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <SidebarProvider>
          <Sidebar>Sidebar content</Sidebar>
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    const sidebar = screen
      .getByText("Sidebar content")
      .closest('[data-sidebar="sidebar"]');

    expect(sidebar?.className).toContain("pt-[env(safe-area-inset-top)]");
  });
});

describe("mobile sidebar access", () => {
  it("does not open from touch, pointer, or wheel gestures", () => {
    renderMobileSidebarHarness();
    const prose = screen.getByText("Selectable message prose");

    fireTouch(prose, "touchstart", createTouch(120, 160));
    fireTouch(window, "touchmove", createTouch(260, 164));
    fireEvent.pointerDown(prose, {
      button: 0,
      clientX: 120,
      clientY: 160,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerMove(window, {
      clientX: 260,
      clientY: 164,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerUp(window, {
      clientX: 260,
      clientY: 164,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.wheel(prose, {
      clientX: 200,
      deltaX: 140,
      deltaY: 0,
    });

    expect(document.querySelector('[data-sidebar="panel"]')).toBeNull();
  });

  it("keeps the explicit sidebar button available", () => {
    renderMobileSidebarHarness();

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    const panel = document.querySelector('[data-sidebar="panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("data-vaul-drawer-direction")).toBe("left");
  });

  it("opens from a rightward swipe anywhere on Recent in the standalone app", () => {
    stubStandaloneDisplayMode();
    renderMobileSidebarHarness();
    const prose = screen.getByText("Selectable message prose");

    fireEvent.pointerDown(prose, {
      button: 0,
      clientX: 120,
      clientY: 160,
      pointerId: 1,
      pointerType: "touch",
    });
    const move = fireWindowPointer("pointermove", 190, 162);

    expect(move.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-sidebar="panel"]')).toBeNull();

    fireWindowPointer("pointerup", 190, 162);

    expect(document.querySelector('[data-sidebar="panel"]')).not.toBeNull();
  });

  it("always routes a rightward swipe to Recent instead of browser history", () => {
    stubStandaloneDisplayMode();
    renderMobileSidebarHarness("/projects/project-a/threads/thread-a");
    const prose = screen.getByText("Selectable message prose");

    fireEvent.pointerDown(prose, {
      button: 0,
      clientX: 80,
      clientY: 160,
      pointerId: 1,
      pointerType: "touch",
    });
    fireWindowPointer("pointermove", 150, 162);
    fireWindowPointer("pointerup", 150, 162);

    expect(screen.getByTestId("location-path").textContent).toBe("/");
    expect(document.querySelector('[data-sidebar="panel"]')).toBeNull();
  });
});
