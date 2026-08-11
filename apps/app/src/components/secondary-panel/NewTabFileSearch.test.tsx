// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { NewTabActions, NewTabFileSearch } from "./NewTabFileSearch";

vi.mock("@/hooks/useFileSearchSuggestions", () => ({
  useFileSearchSuggestions: () => ({
    suggestions: [],
    isLoading: false,
    fileSearchError: false,
    isDebouncing: false,
    isUnavailable: false,
  }),
}));

vi.mock("./threadRecentItems", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./threadRecentItems")>();
  return {
    ...actual,
    useThreadRecentItems: () => [],
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockPointerCoarse(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === POINTER_COARSE_QUERY && matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function renderFileSearch({
  autoFocus,
  onAutoFocusHandled = () => undefined,
}: {
  autoFocus: boolean;
  onAutoFocusHandled?: () => void;
}) {
  render(
    <NewTabFileSearch
      autoFocus={autoFocus}
      projectId="proj_1"
      environmentId="env_1"
      currentThreadId="thr_1"
      idleActions={null}
      onAutoFocusHandled={onAutoFocusHandled}
      onSelect={() => {}}
    />,
  );
}

describe("NewTabFileSearch", () => {
  it("opens the simulator from Actions and marks a live session", () => {
    const onOpenSimulator = vi.fn();
    render(
      <NewTabActions onOpenSimulator={onOpenSimulator} simulatorRunning />,
    );

    expect(screen.getByText("Running")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open simulator/u }));
    expect(onOpenSimulator).toHaveBeenCalledTimes(1);
  });

  // BBamir's earlier coarse/fine autofocus cases are dropped rather than
  // ported: they called renderFileSearch() before autofocus became an explicit
  // request, and the two "explicit request" cases below now cover both pointer
  // kinds under the current API.
  it("does not autofocus when passively remounted", () => {
    mockPointerCoarse(false);
    const focusSpy = vi
      .spyOn(HTMLInputElement.prototype, "focus")
      .mockImplementation(() => {});

    renderFileSearch({ autoFocus: false });

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("consumes an explicit request without focusing on coarse pointers", () => {
    mockPointerCoarse(true);
    const focusSpy = vi
      .spyOn(HTMLInputElement.prototype, "focus")
      .mockImplementation(() => {});
    const onAutoFocusHandled = vi.fn();

    renderFileSearch({ autoFocus: true, onAutoFocusHandled });

    expect(focusSpy).not.toHaveBeenCalled();
    expect(onAutoFocusHandled).toHaveBeenCalledTimes(1);
  });

  it("autofocuses for an explicit request and consumes it", () => {
    mockPointerCoarse(false);
    const focusSpy = vi
      .spyOn(HTMLInputElement.prototype, "focus")
      .mockImplementation(() => {});
    const onAutoFocusHandled = vi.fn();
    let nextFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      nextFrame = callback;
      return 1;
    });

    renderFileSearch({ autoFocus: true, onAutoFocusHandled });

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(onAutoFocusHandled).toHaveBeenCalledTimes(1);

    act(() => nextFrame?.(0));

    expect(focusSpy).toHaveBeenCalledTimes(2);
  });
});
