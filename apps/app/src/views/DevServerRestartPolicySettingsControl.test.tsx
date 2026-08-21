// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevServerRestartPolicySettingsControl } from "./SettingsView";

afterEach(cleanup);

describe("DevServerRestartPolicySettingsControl", () => {
  it("maps the switch to the until-stopped policy", () => {
    const onPolicyChange = vi.fn();
    render(
      <DevServerRestartPolicySettingsControl
        disabled={false}
        policy="never"
        onPolicyChange={onPolicyChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Keep dev servers running",
      }),
    );

    expect(onPolicyChange).toHaveBeenCalledWith("until_stopped");
  });

  it("uses an accurate persistence label and a 40px minimum hit area", () => {
    render(
      <DevServerRestartPolicySettingsControl
        disabled={false}
        policy="until_stopped"
        onPolicyChange={vi.fn()}
      />,
    );

    const control = screen.getByRole("switch", {
      name: "Keep dev servers running",
    });
    expect(control.className).toContain("after:-inset-y-3");
    expect(
      screen.getByText(
        "Restores declared dev servers after exits and bb restarts. One-shot commands stay stopped unless explicitly supervised.",
      ),
    ).not.toBeNull();
  });
});
