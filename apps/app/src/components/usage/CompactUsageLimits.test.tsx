// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
import {
  buildCompactUsageLimitsModel,
  CompactUsageSummary,
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
        { label: "Sonnet", usedPercent: 10, resetsAt: null },
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
  it("keeps weekly values in detail while the summary shows the requested one-line metrics", () => {
    expect(requiredModel()).toEqual({
      providers: [
        {
          name: "Claude",
          summaryMetrics: [
            {
              label: "5hr",
              usedPercent: 68,
              resetsAt: "2026-08-08T22:00:00.000Z",
            },
            { label: "Fable", usedPercent: 81, resetsAt: null },
          ],
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
          summaryMetrics: [{ label: "5hr", usedPercent: 36, resetsAt: null }],
          detailMetrics: [
            { label: "5hr", usedPercent: 36, resetsAt: null },
            { label: "Weekly", usedPercent: 57, resetsAt: null },
          ],
        },
      ],
    });
  });

  it("omits providers that do not report a current-session summary", () => {
    const usage = usageFixture();
    usage.claudeCode = { status: "unauthenticated" };

    expect(buildCompactUsageLimitsModel(usage)).toEqual({
      providers: [
        {
          name: "Codex",
          summaryMetrics: [{ label: "5hr", usedPercent: 36, resetsAt: null }],
          detailMetrics: [
            { label: "5hr", usedPercent: 36, resetsAt: null },
            { label: "Weekly", usedPercent: 57, resetsAt: null },
          ],
        },
      ],
    });
  });

  it("keeps Codex visible when only its weekly window is available", () => {
    const usage = usageFixture();
    usage.codex = {
      status: "ok",
      accountEmail: "codex@example.com",
      planLabel: "Pro",
      windows: [
        {
          label: "Weekly limit",
          usedPercent: 6,
          resetsAt: "2026-08-15T21:58:24.000Z",
        },
      ],
    };

    const model = buildCompactUsageLimitsModel(usage);
    expect(model?.providers[1]).toEqual({
      name: "Codex",
      summaryMetrics: [
        {
          label: "Weekly",
          usedPercent: 6,
          resetsAt: "2026-08-15T21:58:24.000Z",
        },
      ],
      detailMetrics: [
        { label: "5hr", usedPercent: null, resetsAt: null },
        {
          label: "Weekly",
          usedPercent: 6,
          resetsAt: "2026-08-15T21:58:24.000Z",
        },
      ],
    });

    if (model === null) throw new Error("Expected weekly-only Codex model");
    render(<CompactUsageSummary model={model} />);
    expect(screen.getByText("Weekly")).not.toBeNull();
    expect(screen.getByText("6%")).not.toBeNull();
  });
});

describe("CompactUsageSummary", () => {
  it("renders percentage used in a single non-wrapping line without weekly values", () => {
    render(<CompactUsageSummary model={requiredModel()} />);

    expect(screen.getByText("Claude")).not.toBeNull();
    expect(screen.getByText("Fable")).not.toBeNull();
    expect(screen.getByText("Codex")).not.toBeNull();
    expect(screen.getByText("68%")).not.toBeNull();
    expect(screen.getByText("81%")).not.toBeNull();
    expect(screen.getByText("36%")).not.toBeNull();
    expect(screen.queryByText("Weekly")).toBeNull();
    expect(
      screen.getByLabelText(
        /Claude: 5hr, 68 percent used, Fable, 81 percent used\. Codex: 5hr, 36 percent used/u,
      ),
    ).not.toBeNull();
  });
});

describe("CommandCenterUsageRailContent", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <CommandCenterUsageRailContent
        model={requiredModel()}
        open={open}
        onOpenChange={setOpen}
      />
    );
  }

  it("expands mobile details from a 16px summary rail", () => {
    render(<Harness />);

    const rail = screen.getByTestId("command-center-usage-rail");
    expect(rail.className).toContain("max-md:block");
    const trigger = screen.getByRole("button", { name: /Expand details/u });
    expect(trigger.className).toContain("h-4");
    expect(screen.queryByText("Weekly")).toBeNull();

    fireEvent.click(trigger);

    expect(
      screen
        .getByRole("button", { name: /Collapse details/u })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getAllByText("Weekly")).toHaveLength(2);
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

  it("reveals both weekly values only after the compact row expands", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T20:00:00.000Z");
    render(<Harness />);

    const container = screen.getByTestId("sidebar-usage-limits");
    expect(container.className).toContain("max-md:hidden");
    expect(container.className).toContain("pointer-coarse:hidden");
    const trigger = screen.getByRole("button", {
      name: /Expand details/u,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Weekly")).toBeNull();

    fireEvent.click(trigger);

    expect(
      screen
        .getByRole("button", { name: /Collapse details/u })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getAllByText("Weekly")).toHaveLength(2);
    expect(screen.getByText("Resets in 2 hr")).not.toBeNull();
  });
});
