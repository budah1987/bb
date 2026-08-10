// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTerminalServerStatus } from "@/lib/local-server-status";
import { LocalServerRow } from "./LocalServersSection";

afterEach(cleanup);

const server = {
  id: "term_1",
  initialCwd: "/worktrees/feature",
  state: "running" as const,
  title: "Web dev server",
};

const status = resolveTerminalServerStatus(server.state);

function renderRow(
  overrides: Partial<React.ComponentProps<typeof LocalServerRow>> = {},
) {
  const props: React.ComponentProps<typeof LocalServerRow> = {
    controlsDisabled: false,
    environmentPath: "/worktrees/feature",
    operation: null,
    operationError: null,
    onOpen: vi.fn(),
    onRestart: vi.fn(),
    onRetry: vi.fn(),
    onStop: vi.fn(),
    server,
    status,
    ...overrides,
  };

  return { ...render(<LocalServerRow {...props} />), props };
}

describe("LocalServerRow actions", () => {
  it("requires confirmation before a force stop", () => {
    const onStop = vi.fn();
    renderRow({ onStop });

    fireEvent.click(
      screen.getByRole("button", { name: "Force stop Web dev server" }),
    );
    expect(onStop).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirm force stop Web dev server",
      }),
    );
    expect(onStop).toHaveBeenCalledWith("term_1");
  });

  it("announces a pending operation and disables both actions", () => {
    const { container } = renderRow({
      controlsDisabled: true,
      operation: "restart",
    });

    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Restarting…")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Restart Web dev server" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Force stop Web dev server" }),
    ).toHaveProperty("disabled", true);
  });

  it("shows an inline operation error with a retry action", () => {
    const onRetry = vi.fn();
    renderRow({
      onRetry,
      operationError: {
        message: "Could not restart this server.",
        operation: "restart",
      },
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "Could not restart this server.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledWith("restart", "term_1");
  });
});
