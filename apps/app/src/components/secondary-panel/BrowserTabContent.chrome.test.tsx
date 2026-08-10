// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactElement } from "react";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { BrowserTabContent } from "./BrowserTabContent";
import { browserAnnotationStore } from "@/lib/browser-annotations";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

interface BrowserChromeHarness {
  api: BbDesktopBrowserApi;
  emitState: (state: BbDesktopBrowserState) => void;
  goBack: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  setAnnotationMode: ReturnType<typeof vi.fn>;
  syncAnnotations: ReturnType<typeof vi.fn>;
}

function createBrowserChromeHarness(): BrowserChromeHarness {
  const stateListeners = new Set<(state: BbDesktopBrowserState) => void>();
  const goBack = vi.fn();
  const stop = vi.fn();
  const setAnnotationMode = vi.fn();
  const syncAnnotations = vi.fn();
  const api: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    goBack,
    stop,
    setAnnotationMode,
    syncAnnotations,
    onAnnotationDraft() {
      return () => {};
    },
    onState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
  };
  return {
    api,
    emitState(state) {
      for (const listener of stateListeners) listener(state);
    },
    goBack,
    stop,
    setAnnotationMode,
    syncAnnotations,
  };
}

function browserState(
  overrides: Partial<BbDesktopBrowserState> = {},
): BbDesktopBrowserState {
  return {
    tabId: "browser:test",
    url: "https://example.com/docs",
    title: "Example docs",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
    ...overrides,
  };
}

function renderBrowserChrome(harness: BrowserChromeHarness, initialUrl = "") {
  window.bbDesktop = createBbDesktopApi(desktopInfo, harness.api);
  return renderWithQueryClient(
    <>
      <BrowserTabContent
        tabId="browser:test"
        initialUrl={initialUrl}
        addressFocusRequest={null}
        canShowNativeBrowserView={false}
        visibilityCoordinator={null}
        environmentId={null}
        threadId="thread-1"
        onUpdate={() => {}}
      />
      <button type="button">Outside browser</button>
    </>,
  );
}

function renderWithQueryClient(content: ReactElement) {
  const { wrapper } = createQueryClientTestHarness();
  return render(content, { wrapper });
}

function expectChromeVisible(): HTMLElement {
  const chrome = screen.getByTestId("browser-tab-nav-bar");
  expect(chrome.dataset.state).toBe("expanded");
  expect(chrome.classList).toContain("h-11");
  expect(screen.getByTestId("browser-tab-nav-controls").classList).toContain(
    "opacity-100",
  );
  return chrome;
}

describe("BrowserTabContent persistent navigation", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
    delete window.bbDesktop;
  });

  it("keeps the top navigation visible through pointer and focus changes", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");
    const chrome = expectChromeVisible();

    fireEvent.pointerLeave(chrome);
    act(() => screen.getByRole("button", { name: "Outside browser" }).focus());
    expectChromeVisible();
    expect(
      screen.getByLabelText("Address and search bar").hasAttribute("required"),
    ).toBe(true);
  });

  it("keeps navigation visible while loading and preserves the stop action", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");

    act(() => harness.emitState(browserState({ isLoading: true })));
    expectChromeVisible();

    const stopButton = screen.getByRole("button", { name: "Stop loading" });
    expect(screen.getByRole("status").textContent).toBe("Page loading");
    expect(stopButton.classList).toContain("!size-10");
    expect(stopButton.classList).toContain("active:scale-[0.96]");
    fireEvent.click(stopButton);
    expect(harness.stop).toHaveBeenCalledWith("browser:test");
  });

  it("syncs only open annotations into native markers", () => {
    const harness = createBrowserChromeHarness();
    const first = browserAnnotationStore.addDraft("thread-1", {
      tabId: "browser:test",
      selector: "main",
      url: "https://example.com/docs",
      viewport: { width: 1200, height: 800 },
      rectangle: { x: 0, y: 0, width: 100, height: 40 },
      comment: "First",
    });
    browserAnnotationStore.addDraft("thread-1", {
      tabId: "browser:test",
      selector: "footer",
      url: "https://example.com/docs",
      viewport: { width: 1200, height: 800 },
      rectangle: { x: 0, y: 700, width: 100, height: 40 },
      comment: "Second",
    });
    const sent = browserAnnotationStore.addDraft("thread-1", {
      tabId: "browser:test",
      selector: "header",
      url: "https://example.com/docs",
      viewport: { width: 1200, height: 800 },
      rectangle: { x: 0, y: 0, width: 100, height: 40 },
      comment: "Sent",
    });
    const deleted = browserAnnotationStore.addDraft("thread-1", {
      tabId: "browser:test",
      selector: "aside",
      url: "https://example.com/docs",
      viewport: { width: 1200, height: 800 },
      rectangle: { x: 0, y: 80, width: 100, height: 40 },
      comment: "Deleted",
    });
    browserAnnotationStore.resolveDraft("thread-1", "browser:test", first.id);
    browserAnnotationStore.markSent("thread-1", "browser:test", sent.id);
    browserAnnotationStore.removeDraft("thread-1", "browser:test", deleted.id);

    renderBrowserChrome(harness, "https://example.com/docs");

    expect(
      screen.getByRole("button", { name: "Annotate page, 1 drafts" }),
    ).toBeTruthy();
    expect(harness.syncAnnotations).toHaveBeenLastCalledWith({
      tabId: "browser:test",
      annotations: [
        expect.objectContaining({
          number: 1,
          selector: "footer",
          comment: "Second",
        }),
      ],
    });
  });

  it("uses 40px recovery actions with reduced-motion press feedback", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");

    act(() =>
      harness.emitState(browserState({ errorText: "ERR_CONNECTION_REFUSED" })),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "ERR_CONNECTION_REFUSED",
    );

    const buttons = [
      screen
        .getAllByRole("button", { name: "Reload" })
        .find((button) => button.classList.contains("min-h-10")),
      screen.getByRole("button", { name: "Open externally" }),
    ];
    for (const button of buttons) {
      expect(button).toBeDefined();
      if (button === undefined) continue;
      expect(button.classList).toContain("min-h-10");
      expect(button.classList).toContain("active:scale-[0.96]");
      expect(button.classList).toContain("motion-reduce:transition-none");
    }
  });

  it("preserves browser navigation actions", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");
    expectChromeVisible();

    act(() => harness.emitState(browserState({ canGoBack: true })));
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(harness.goBack).toHaveBeenCalledWith("browser:test");
  });

  it("disables annotation capture when the native view hides or unmounts", () => {
    const harness = createBrowserChromeHarness();
    window.bbDesktop = createBbDesktopApi(desktopInfo, harness.api);
    const content = (canShowNativeBrowserView: boolean) => (
      <BrowserTabContent
        tabId="browser:test"
        initialUrl="https://example.com/docs"
        addressFocusRequest={null}
        canShowNativeBrowserView={canShowNativeBrowserView}
        visibilityCoordinator={null}
        environmentId={null}
        threadId="thread-annotation-toggle"
        onUpdate={() => {}}
      />
    );
    const view = renderWithQueryClient(content(true));
    harness.setAnnotationMode.mockClear();

    fireEvent.click(
      screen.getByRole("button", { name: /^Annotate page(?:,|$)/ }),
    );
    expect(harness.setAnnotationMode).toHaveBeenLastCalledWith({
      tabId: "browser:test",
      enabled: true,
    });

    view.rerender(content(false));
    expect(harness.setAnnotationMode).toHaveBeenLastCalledWith({
      tabId: "browser:test",
      enabled: false,
    });
    view.unmount();
    expect(harness.setAnnotationMode).toHaveBeenLastCalledWith({
      tabId: "browser:test",
      enabled: false,
    });
  });
});
