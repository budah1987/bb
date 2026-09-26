// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { defaultAppSettings } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { PaneContext, type PaneContextValue } from "./PaneContext";
import { ThreadCopyPullRequestUrlCommandHandler } from "./ThreadCopyPullRequestUrlCommandHandler";

const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/components/ui/app-toast", () => ({ appToast: mocks }));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: defaultAppSettings,
      keybindings: [
        {
          command: "thread.copyPullRequestUrl",
          desktopOnly: false,
          shortcut: {
            key: "c",
            mod: true,
            meta: false,
            control: false,
            alt: false,
            shift: true,
          },
          when: { all: ["mainSurface"], none: ["modalOpen"] },
        },
      ],
    },
  }),
}));
vi.mock("@/lib/bb-desktop", () => ({ getBbDesktopInfo: () => null }));

function pane(isFocused: boolean): PaneContextValue {
  return {
    beginPaneDrag: undefined,
    isBoundedPane: true,
    isFocused,
    isMaximized: false,
    isSplitPane: true,
    isTopRow: true,
    navigateInPane: vi.fn(),
    onMoveToSide: undefined,
    onRequestClose: vi.fn(),
    onToggleMaximize: vi.fn(),
    ownsWindowTopLeft: isFocused,
    paneId: isFocused ? "focused" : "other",
    reservesWindowPanelToggle: false,
    secondaryPanelHost: null,
  };
}

function Handlers({
  focusedUrl,
  otherUrl,
}: {
  focusedUrl: string | null;
  otherUrl: string | null;
}) {
  return (
    <AppCommandProvider>
      <PaneContext.Provider value={pane(true)}>
        <ThreadCopyPullRequestUrlCommandHandler url={focusedUrl} />
      </PaneContext.Provider>
      <PaneContext.Provider value={pane(false)}>
        <ThreadCopyPullRequestUrlCommandHandler url={otherUrl} />
      </PaneContext.Provider>
    </AppCommandProvider>
  );
}

function pressShortcut() {
  fireEvent.keyDown(window, {
    key: "C",
    code: "KeyC",
    metaKey: true,
    shiftKey: true,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ThreadCopyPullRequestUrlCommandHandler", () => {
  it("copies only the focused thread's PR URL and shows a success toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      platform: "MacIntel",
      clipboard: { writeText },
    });
    render(
      <Handlers
        focusedUrl="https://github.com/bb/repo/pull/1"
        otherUrl="https://github.com/bb/repo/pull/2"
      />,
    );
    pressShortcut();
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("https://github.com/bb/repo/pull/1");
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith("Pull request URL copied"),
    );
  });

  it("does not copy when the focused thread has no PR", () => {
    vi.stubGlobal("navigator", { ...navigator, platform: "MacIntel" });
    render(
      <Handlers
        focusedUrl={null}
        otherUrl="https://github.com/bb/repo/pull/2"
      />,
    );
    pressShortcut();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
