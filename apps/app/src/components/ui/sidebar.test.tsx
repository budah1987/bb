// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
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

function renderMobileSidebarHarness() {
  render(
    <CompactViewportOverrideProvider isCompactViewport>
      <SidebarProvider>
        <SidebarTrigger />
        <Sidebar>Sidebar content</Sidebar>
        <SidebarInset>
          <div>Selectable message prose</div>
        </SidebarInset>
      </SidebarProvider>
    </CompactViewportOverrideProvider>,
  );
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
});
