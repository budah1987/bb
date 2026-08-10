// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginThreadRailSectionProps } from "@bb/plugin-sdk";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { PluginThreadRailSections } from "./PluginThreadRailSections";

const state = vi.hoisted<{
  component: ComponentType<PluginThreadRailSectionProps>;
}>(() => ({ component: () => null }));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({
    data: {
      id: "thr_1",
      projectId: "proj_1",
      environmentId: "env_1",
    },
  }),
}));

vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({
    threadRailSections: [
      {
        id: "checks",
        title: "Checks",
        component: state.component,
        pluginId: "demo",
        generation: 1,
      },
    ],
  }),
}));

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("PluginThreadRailSections", () => {
  it("passes the active thread context through a labelled plugin boundary", () => {
    let received: PluginThreadRailSectionProps | null = null;
    state.component = (props) => {
      received = props;
      return <div>Plugin checks</div>;
    };

    const { container } = render(<PluginThreadRailSections threadId="thr_1" />);

    expect(screen.getByRole("region", { name: "Checks" })).not.toBeNull();
    expect(screen.getByText("Plugin checks")).not.toBeNull();
    expect(received).toEqual({
      threadId: "thr_1",
      projectId: "proj_1",
      environmentId: "env_1",
    });
    expect(container.querySelector("[data-bb-plugin='demo']")).not.toBeNull();
  });

  it("contains a crashing section and removes its rail content", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.component = () => {
      throw new Error("broken section");
    };

    const { container } = render(<PluginThreadRailSections threadId="thr_1" />);

    expect(container.textContent).toBe("");
  });
});
