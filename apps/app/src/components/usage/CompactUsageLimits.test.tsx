// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
import {
  buildCompactUsageLimitsModel,
  CommandCenterUsageRailContent,
  SidebarUsageLimitsContent,
  type CompactUsageLimitsModel,
} from "./CompactUsageLimits";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function usageFixture(): ProviderUsageResponse {
  return {
    claudeCode: {
      status: "ok",
      accountEmail: null,
      planLabel: "Max (5x)",
      windows: [
        {
          label: "Current session",
          usedPercent: 67.6,
          resetsAt: "2026-08-08T22:00:00.000Z",
        },
        { label: "Weekly limit", usedPercent: 42.2, resetsAt: null },
        { label: "Fable", usedPercent: 81.3, resetsAt: null },
      ],
    },
    codex: {
      status: "ok",
      accountEmail: null,
      planLabel: "Plus",
      windows: [
        { label: "Current session", usedPercent: 35.7, resetsAt: null },
        { label: "Weekly limit", usedPercent: 57.1, resetsAt: null },
      ],
    },
    cursor: { status: "not_installed" },
  };
}

function requiredModel(): CompactUsageLimitsModel {
  const model = buildCompactUsageLimitsModel(usageFixture());
  if (model === null) throw new Error("Expected usage model");
  return model;
}

describe("buildCompactUsageLimitsModel", () => {
  it("keeps all detail metrics and uses the first available summary metric", () => {
    expect(requiredModel()).toEqual({
      providers: [
        {
          name: "Claude",
          summaryMetric: {
            label: "5hr",
            usedPercent: 68,
            resetsAt: "2026-08-08T22:00:00.000Z",
          },
          detailMetrics: [
            {
              label: "5hr",
              usedPercent: 68,
              resetsAt: "2026-08-08T22:00:00.000Z",
            },
            { label: "Weekly", usedPercent: 42, resetsAt: null },
            { label: "Fable", usedPercent: 81, resetsAt: null },
          ],
        },
        {
          name: "Codex",
          summaryMetric: {
            label: "5hr",
            usedPercent: 36,
            resetsAt: null,
          },
          detailMetrics: [
            { label: "5hr", usedPercent: 36, resetsAt: null },
            { label: "Weekly", usedPercent: 57, resetsAt: null },
          ],
        },
      ],
    });
  });

  it("uses a weekly summary when a provider has no session window", () => {
    const usage = usageFixture();
    usage.codex = {
      status: "ok",
      accountEmail: null,
      planLabel: "Plus",
      windows: [{ label: "Weekly limit", usedPercent: 26, resetsAt: null }],
    };

    expect(buildCompactUsageLimitsModel(usage)?.providers[1]).toEqual({
      name: "Codex",
      summaryMetric: {
        label: "Weekly",
        usedPercent: 26,
        resetsAt: null,
      },
      detailMetrics: [
        { label: "5hr", usedPercent: null, resetsAt: null },
        { label: "Weekly", usedPercent: 26, resetsAt: null },
      ],
    });
  });

  it("keeps authenticated providers visible when usage becomes unavailable", () => {
    const usage = usageFixture();
    usage.claudeCode = { status: "expired" };
    usage.codex = {
      status: "error",
      message: "Codex usage request failed (HTTP 503).",
      planLabel: "Plus",
      accountEmail: null,
    };

    expect(buildCompactUsageLimitsModel(usage)).toEqual({
      providers: [
        {
          name: "Claude",
          summaryMetric: {
            label: "5hr",
            usedPercent: null,
            resetsAt: null,
          },
          detailMetrics: [
            {
              label: "5hr",
              usedPercent: null,
              resetsAt: null,
            },
          ],
        },
        {
          name: "Codex",
          summaryMetric: {
            label: "5hr",
            usedPercent: null,
            resetsAt: null,
          },
          detailMetrics: [
            {
              label: "5hr",
              usedPercent: null,
              resetsAt: null,
            },
          ],
        },
      ],
    });
  });

  it("omits providers that are signed out", () => {
    const usage = usageFixture();
    usage.claudeCode = { status: "unauthenticated" };

    expect(buildCompactUsageLimitsModel(usage)?.providers).toEqual([
      expect.objectContaining({ name: "Codex" }),
    ]);
  });
});

describe("CommandCenterUsageRailContent", () => {
  it("expands inside the dock without a caret and closes from its content", () => {
    render(<CommandCenterUsageRailContent model={requiredModel()} />);

    const rail = screen.getByTestId("command-center-usage-rail");
    const dock = rail.querySelector<HTMLElement>(".compact-usage-dock");
    const trigger = screen.getByRole("button", { name: /Expand details/u });
    expect(dock?.style.getPropertyValue("--usage-collapsed-height")).toBe(
      "44px",
    );
    expect(dock?.dataset.open).toBe("false");
    expect(rail.querySelector('[title="Claude"]')).not.toBeNull();
    expect(rail.querySelector('[title="Codex"]')).not.toBeNull();

    fireEvent.click(trigger);

    expect(dock?.dataset.open).toBe("true");
    expect(
      screen.getByRole("button", { name: "Close provider usage" }).className,
    ).toContain("backdrop-blur-[2px]");

    const details = document.getElementById(
      trigger.getAttribute("aria-controls") ?? "",
    );
    expect(details?.getAttribute("aria-hidden")).toBe("false");
    if (details === null) throw new Error("Expected usage details");
    fireEvent.click(details);
    expect(dock?.dataset.open).toBe("false");
  });
});

describe("SidebarUsageLimitsContent", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <SidebarUsageLimitsContent
        model={requiredModel()}
        open={open}
        onOpenChange={setOpen}
      />
    );
  }

  it("expands into provider cards and closes from the blurred background", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T20:00:00.000Z");
    render(<Harness />);

    expect(screen.getByTestId("sidebar-usage-limits").className).toContain(
      "order-[-1]",
    );
    expect(screen.getByTestId("sidebar-usage-limits").className).not.toContain(
      "max-md:hidden",
    );
    expect(screen.getByTestId("sidebar-usage-limits").className).not.toContain(
      "pointer-coarse:hidden",
    );
    const trigger = screen.getByRole("button", { name: /Expand details/u });
    expect(trigger.querySelector("svg")).not.toBeNull();
    fireEvent.click(trigger);

    expect(screen.getByLabelText("Claude usage")).not.toBeNull();
    expect(screen.getByLabelText("Codex usage")).not.toBeNull();
    expect(screen.getByText("Resets in 2 hr")).not.toBeNull();

    const scrim = screen.getByRole("button", {
      name: "Close provider usage",
    });
    expect(scrim.className).toContain("backdrop-blur-[2px]");
    fireEvent.click(scrim);
    expect(
      screen
        .getByRole("button", { name: /Expand details/u })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
