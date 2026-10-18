// @vitest-environment jsdom

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useBbNavigate } from "@/lib/plugin-sdk-hooks";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  getActiveThreadPanelOpener,
  resetActiveThreadPanelOpenerForTest,
  usePublishThreadPanelOpener,
  type PluginThreadPanelOpenHandler,
} from "./plugin-thread-panel-navigation";

function Pane({
  opener,
  isFocused,
}: {
  opener: PluginThreadPanelOpenHandler;
  isFocused: boolean;
}) {
  usePublishThreadPanelOpener(opener, isFocused);
  return null;
}

afterEach(() => {
  cleanup();
  resetActiveThreadPanelOpenerForTest();
  resetPluginSlotStoreForTest();
});

function CrossPluginProbe() {
  const navigate = useBbNavigate();
  const [outcome, setOutcome] = useState("idle");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void navigate
            .experimental_openThreadPanel({
              threadId: "thread-a",
              pluginId: "target",
              actionId: "missing",
              params: null,
            })
            .then((result) => setOutcome(result.outcome));
        }}
      >
        Missing action
      </button>
      <button
        type="button"
        onClick={() => {
          void navigate
            .experimental_openThreadPanel({
              threadId: "thread-a",
              pluginId: "target",
              actionId: "details",
              params: Number.POSITIVE_INFINITY,
            })
            .then((result) => setOutcome(result.outcome));
        }}
      >
        Bad params
      </button>
      <span>{outcome}</span>
    </>
  );
}

it("rejects unknown actions and invalid params before route navigation", async () => {
  setPluginSlotRegistrations("target", {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [
      { id: "details", title: "Details", component: () => null },
    ],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <PluginSlotMount pluginId="caller" slotKind="test" slotId="cross">
          <CrossPluginProbe />
        </PluginSlotMount>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Missing action" }));
  expect(await screen.findByText("unknown-action")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bad params" }));
  expect(await screen.findByText("invalid-params")).toBeTruthy();
});

it("publishes only the focused pane's opener", () => {
  const left = vi.fn(() => true);
  const right = vi.fn(() => true);
  const { rerender } = render(
    <>
      <Pane opener={left} isFocused={true} />
      <Pane opener={right} isFocused={false} />
    </>,
  );

  getActiveThreadPanelOpener()?.({ actionId: "a", pluginId: "p" });
  expect(left).toHaveBeenCalledTimes(1);
  expect(right).not.toHaveBeenCalled();

  rerender(
    <>
      <Pane opener={left} isFocused={false} />
      <Pane opener={right} isFocused={true} />
    </>,
  );
  getActiveThreadPanelOpener()?.({ actionId: "a", pluginId: "p" });
  expect(right).toHaveBeenCalledTimes(1);
  expect(left).toHaveBeenCalledTimes(1);
});

it("reports no opener when no thread view is focused", () => {
  render(<Pane opener={vi.fn(() => true)} isFocused={false} />);
  expect(getActiveThreadPanelOpener()).toBeNull();
});
