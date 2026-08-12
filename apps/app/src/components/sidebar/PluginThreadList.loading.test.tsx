// @vitest-environment jsdom

import { lazy, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import { PluginThreadList } from "./PluginThreadList";

vi.mock("@/components/plugin/PluginSlotMount", () => ({
  PluginSlotMount: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/ui/sidebar.js", () => ({
  useSidebar: () => ({ isCompactViewport: false }),
}));

vi.mock("@/hooks/useRouteState", () => ({
  useRouteState: () => ({ projectId: null, threadId: null }),
}));

afterEach(cleanup);

function suspendedSlot(pluginId: string, id: string): PluginThreadListSlot {
  return {
    pluginId,
    generation: 1,
    id,
    title: id,
    component: lazy(
      () => new Promise<{ default: () => null }>(() => undefined),
    ),
  };
}

function renderSlot(slot: PluginThreadListSlot) {
  render(
    <PluginThreadList
      slot={slot}
      builtInFallback={<p>BB fallback</p>}
      searchQuery=""
      onNavigate={() => undefined}
      activeSpaceId="default"
      moveProject={() => undefined}
      moveProjects={() => undefined}
      spaces={[]}
    />,
  );
}

describe("PluginThreadList loading fallback", () => {
  it("keeps Conductor identity while its host chunk loads", () => {
    renderSlot(suspendedSlot("conductor-workspaces", "conductor"));

    expect(screen.getByText("Loading workspaces…")).toBeDefined();
    expect(screen.queryByText("BB fallback")).toBeNull();
  });

  it("keeps the built-in fallback for plugin providers", () => {
    renderSlot(suspendedSlot("t3sidebar", "inbox"));

    expect(screen.getByText("BB fallback")).toBeDefined();
  });
});
