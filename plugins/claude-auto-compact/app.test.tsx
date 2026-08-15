// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

describe("Claude auto compact settings", () => {
  it("shows the toggle and threshold slider", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          getSettings: () => ({ enabled: true, autoCompactWindow: 300_000 }),
          updateSettings: (input) => input,
        },
      },
    );

    await waitFor(() =>
      expect(slot.getByText("300k context tokens")).toBeTruthy(),
    );
    expect(
      slot.getByRole("switch", { name: "Automatic compaction" }),
    ).toBeTruthy();
    expect(
      slot.getByRole("slider", { name: "Compaction threshold" }),
    ).toBeTruthy();
  });
});
