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

function BbamirSidebar() {
  return null;
}

afterEach(() => {
  cleanup();
  getDefaultStore().set(threadListProviderAtom, BUILT_IN_THREAD_LIST_PROVIDER);
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
});

describe("SidebarThreadListSetting", () => {
  it("keeps Conductor available without a plugin registration", async () => {
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarThreadListSetting />
      </CompactViewportOverrideProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "Sidebar thread list",
    });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: /BBamir/ }));

    expect(trigger.textContent).toContain("BBamir");
    expect(
      JSON.parse(
        window.localStorage.getItem("bb.sidebar.threadListProvider") ?? '""',
      ),
    ).toBe("conductor-workspaces/conductor");
  });

  it("keeps plugin providers available in the touch-friendly drawer", async () => {
    setPluginSlotRegistrations("t3sidebar", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [],
      threadPanelActions: [],
      sidebarFooterActions: [],
      threadLists: [
        {
          id: "inbox",
          title: "T3",
          description: "Conversation inbox.",
          component: BbamirSidebar,
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
    fireEvent.click(await screen.findByRole("menuitem", { name: /T3/ }));

    expect(trigger.textContent).toContain("T3");
    expect(
      JSON.parse(
        window.localStorage.getItem("bb.sidebar.threadListProvider") ?? '""',
      ),
    ).toBe("t3sidebar/inbox");
  });
});
