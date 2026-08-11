import type { TerminalSession } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  buildLocalServerDisplay,
  isNamedLocalServerTerminal,
  isPathInsideEnvironment,
} from "@/lib/local-server-status";
import { acquireTerminalOperationLock } from "./LocalServersSection";

function terminal(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    closeReason: null,
    cols: 80,
    createdAt: 1,
    environmentId: "env_1",
    exitCode: null,
    hostId: "host_1",
    id: "term_1",
    initialCwd: "/worktrees/feature/apps/web",
    launchCommand: "pnpm dev",
    lastUserInputAt: null,
    rows: 24,
    restartPolicy: "until_stopped",
    status: "running",
    threadId: null,
    title: "Web dev server",
    updatedAt: 2,
    ...overrides,
  };
}

describe("local server rail state", () => {
  it("rejects overlapping terminal operations", () => {
    const lock = { current: null };

    expect(
      acquireTerminalOperationLock(lock, {
        kind: "restart",
        terminalId: "term_1",
      }),
    ).toBe(true);
    expect(
      acquireTerminalOperationLock(lock, {
        kind: "stop",
        terminalId: "term_2",
      }),
    ).toBe(false);
    expect(lock.current).toEqual({ kind: "restart", terminalId: "term_1" });
  });

  it("accepts the environment root and its subdirectories", () => {
    expect(
      isPathInsideEnvironment("/worktrees/feature", "/worktrees/feature/"),
    ).toBe(true);
    expect(
      isPathInsideEnvironment(
        "/worktrees/feature/apps/web",
        "/worktrees/feature",
      ),
    ).toBe(true);
    expect(
      isPathInsideEnvironment("/worktrees/feature-old", "/worktrees/feature"),
    ).toBe(false);
  });

  it("keeps generic shells out of the server list", () => {
    expect(isNamedLocalServerTerminal(terminal({ title: "Terminal" }))).toBe(
      false,
    );
    expect(isNamedLocalServerTerminal(terminal({ title: "Terminal 2" }))).toBe(
      false,
    );
    expect(
      isNamedLocalServerTerminal(terminal({ title: "API dev server" })),
    ).toBe(true);
    expect(
      isNamedLocalServerTerminal(
        terminal({ status: "exited", title: "API dev server" }),
      ),
    ).toBe(false);
    expect(
      isNamedLocalServerTerminal(
        terminal({ launchCommand: null, title: "API dev server" }),
      ),
    ).toBe(false);
  });

  it("flags a named process started from another checkout", () => {
    expect(
      buildLocalServerDisplay(
        terminal({ initialCwd: "/worktrees/main/apps/api" }),
        "/worktrees/feature",
      ).state,
    ).toBe("wrong_checkout");
  });
});
