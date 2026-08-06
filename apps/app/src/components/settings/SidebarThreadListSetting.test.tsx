// @vitest-environment jsdom

import { getDefaultStore } from "jotai";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILT_IN_THREAD_LIST_PROVIDER,
  threadListProviderAtom,
} from "@/components/sidebar/threadListProvider";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { SidebarThreadListSetting } from "./SidebarThreadListSetting";

function ConductorSidebar() {
  return null;
}

afterEach(() => {
  cleanup();
  getDefaultStore().set(threadListProviderAtom, BUILT_IN_THREAD_LIST_PROVIDER);
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
});

describe("SidebarThreadListSetting", () => {
  it("keeps sidebar providers available as a touch-friendly PWA drawer", async () => {
    setPluginSlotRegistrations("conductor-workspaces", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [],
      threadPanelActions: [],
      sidebarFooterActions: [],
      threadLists: [
        {
          id: "conductor",
          title: "Conductor",
          description: "Repositories, workspaces, and conversation tabs.",
          component: ConductorSidebar,
        },
      ],
      fileOpeners: [],
      messageDirectives: [],
    });

    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarThreadListSetting />
      </CompactViewportOverrideProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "Sidebar thread list",
    });
    expect(trigger.className).toContain("w-full");
    expect(trigger.className).toContain("max-md:pointer-coarse:h-11");

    fireEvent.click(trigger);
    expect(
      await screen.findByRole("dialog", { name: "Sidebar layout" }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("menuitem", { name: /Conductor/ }));

    expect(trigger.textContent).toContain("Conductor");
    expect(
      JSON.parse(
        window.localStorage.getItem("bb.sidebar.threadListProvider") ?? '""',
      ),
    ).toBe("conductor-workspaces/conductor");
  });
});
