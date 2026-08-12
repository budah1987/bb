// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionModePicker } from "./PermissionModePicker";

const permissionOptions = [
  {
    value: "accept-edits",
    label: "Accept Edits",
    description: "Ask before actions outside the workspace.",
  },
  {
    value: "auto",
    label: "Approve for me",
    description: "Review permission requests automatically.",
  },
  {
    value: "full",
    label: "Full Access",
    description: "Allow unrestricted access.",
    tone: "warning",
  },
] as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PermissionModePicker", () => {
  it("can show an effective display override without changing the selected value", () => {
    const onChange = vi.fn();
    render(
      <PermissionModePicker
        value="full"
        options={permissionOptions}
        onChange={onChange}
        supported
        displayOverride={{
          label: "Plan Mode",
          compactLabel: "Plan",
          description:
            "Claude Code will plan without normal full-access execution.",
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Permission mode" });
    expect(trigger.textContent).toContain("Plan Mode");
    expect(trigger.textContent).not.toContain("Full Access");
  });

  it("shows an icon and header text without descriptive subtext", () => {
    render(
      <PermissionModePicker
        value="auto"
        options={permissionOptions}
        onChange={vi.fn()}
        supported
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Permission mode" }),
      { button: 0 },
    );

    expect(screen.getByRole("menuitem", { name: "Accept Edits" })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Approve for me" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Full Access" })).toBeTruthy();
    expect(
      screen.queryByText("Ask before actions outside the workspace."),
    ).toBeNull();
    expect(
      screen.queryByText("Review permission requests automatically."),
    ).toBeNull();
    expect(screen.queryByText("Allow unrestricted access.")).toBeNull();
    expect(document.querySelectorAll('[role="menuitem"] svg')).toHaveLength(6);
  });
});
