// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  SidebarProvider,
  SidebarTrigger,
  useCloseMobileSidebar,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  AppLayoutSidebar,
  type AppLayoutSidebarMode,
} from "./AppLayoutSidebar";

vi.mock("@/components/sidebar/AppSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  return {
    AppSidebar: () => <Sidebar>App sidebar</Sidebar>,
  };
});

vi.mock("@/components/settings/SettingsSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  return {
    SettingsSidebar: () => <Sidebar>Settings sidebar</Sidebar>,
  };
});

vi.mock("@/components/tools/ToolsSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  return {
    ToolsSidebar: () => <Sidebar>Tools sidebar</Sidebar>,
  };
});

/** Matches SIDEBAR_MOBILE_CLOSE_ANIMATION_MS in the sidebar drawer. */
const MOBILE_CLOSE_ANIMATION_MS = 500;

function settleMobileDrawer() {
  act(() => {
    vi.advanceTimersByTime(MOBILE_CLOSE_ANIMATION_MS);
  });
}

// The drawer is modal, so everything outside it leaves the accessibility tree
// while it is open. The harness controls still have to be clickable.
function clickHarnessButton(name: string) {
  fireEvent.click(screen.getByRole("button", { name, hidden: true }));
}

function getMobilePanel(): HTMLElement {
  const panel = document.querySelector('[data-sidebar="panel"]');
  if (!(panel instanceof HTMLElement)) {
    throw new Error("Expected the mobile sidebar panel");
  }
  return panel;
}

function ClosingFlagProbe() {
  const { isMobileSidebarClosing } = useSidebar();
  return (
    <span data-testid="closing-flag">
      {isMobileSidebarClosing ? "closing" : "idle"}
    </span>
  );
}

function SidebarModeHarness() {
  const [mode, setMode] = useState<AppLayoutSidebarMode>("app");
  const closeMobileSidebar = useCloseMobileSidebar();
  const navigate = (nextMode: AppLayoutSidebarMode) => {
    closeMobileSidebar();
    setMode(nextMode);
  };

  return (
    <>
      <button type="button" onClick={() => navigate("settings")}>
        Navigate to settings
      </button>
      <button type="button" onClick={() => setMode("settings")}>
        Change route without closing
      </button>
      <ClosingFlagProbe />
      <AppLayoutSidebar
        mode={mode}
        onResizeMouseDown={() => {}}
        isResizing={false}
        appRoutePath="/"
        settingsRoutePath="/settings"
        toolsBackRoutePath="/"
      />
      <SidebarTrigger />
    </>
  );
}

function renderHarness() {
  render(
    <CompactViewportOverrideProvider isCompactViewport>
      <SidebarProvider>
        <SidebarModeHarness />
      </SidebarProvider>
    </CompactViewportOverrideProvider>,
  );
  clickHarnessButton("Toggle Sidebar");
  settleMobileDrawer();
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AppLayoutSidebar mobile mode transitions", () => {
  // AppLayoutSidebar holds the current mode for exactly as long as the drawer
  // reports itself closing, so that flag is the contract worth pinning. The
  // held frame itself is not observable here: the drawer unmounts its panel
  // as soon as it closes and only a real compositor keeps it painted.
  it("reports the drawer as closing for one animation window", () => {
    vi.useFakeTimers();
    renderHarness();

    clickHarnessButton("Navigate to settings");
    expect(screen.getByTestId("closing-flag").textContent).toBe("closing");

    settleMobileDrawer();
    expect(screen.getByTestId("closing-flag").textContent).toBe("idle");
  });

  it("swaps modes immediately when navigation does not close the drawer", () => {
    vi.useFakeTimers();
    renderHarness();

    const appPanel = getMobilePanel();
    expect(appPanel.dataset.state).toBe("open");
    expect(appPanel.textContent).toContain("App sidebar");

    clickHarnessButton("Change route without closing");

    const settingsPanel = getMobilePanel();
    expect(settingsPanel.dataset.state).toBe("open");
    expect(settingsPanel.textContent).toContain("Settings sidebar");
  });
});
