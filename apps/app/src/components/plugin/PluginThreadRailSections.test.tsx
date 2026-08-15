// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginThreadRailSectionProps } from "@get-bb/plugin-sdk";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { PluginThreadRailSections } from "./PluginThreadRailSections";

const state = vi.hoisted<{
  component: ComponentType<PluginThreadRailSectionProps>;
  threadQueryOptions: unknown[];
}>(() => ({ component: () => null, threadQueryOptions: [] }));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: (_threadId: string, options: unknown) => {
    state.threadQueryOptions.push(options);
    return {
      data: {
        id: "thr_1",
        projectId: "proj_1",
        environmentId: "env_1",
      },
    };
  },
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
  state.threadQueryOptions = [];
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

  it("does not mount plugin content or load its thread while disabled", () => {
    state.component = () => <div>Plugin checks</div>;

    const { container } = render(
      <PluginThreadRailSections threadId="thr_1" enabled={false} />,
    );

    expect(container.textContent).toBe("");
    expect(state.threadQueryOptions).toEqual([{ enabled: false }]);
  });
});
