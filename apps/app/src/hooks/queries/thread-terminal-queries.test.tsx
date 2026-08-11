// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { TerminalSession } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { environmentPreviewsQueryKey, terminalsQueryKey } from "./query-keys";
import {
  useCloseTerminal,
  useRestartTerminal,
} from "./thread-terminal-queries";

vi.mock("@/lib/sdk", () => ({
  sdk: { terminals: { close: vi.fn(), restart: vi.fn() } },
}));

const ENVIRONMENT_ID = "environment-1";
const session: TerminalSession = {
  closeReason: null,
  cols: 120,
  createdAt: 1,
  devServerPort: 4173,
  environmentId: ENVIRONMENT_ID,
  exitCode: null,
  hostId: "host-1",
  id: "terminal-2",
  initialCwd: "/workspace",
  lastUserInputAt: null,
  launchCommand: "pnpm dev -- --port 4173",
  restartPolicy: "until_stopped",
  rows: 32,
  status: "running",
  threadId: "thread-1",
  title: "Dev server",
  updatedAt: 2,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("terminal lifecycle mutations", () => {
  it("invalidates terminal and preview data after a restart", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const terminalKey = terminalsQueryKey({
      kind: "environment",
      environmentId: ENVIRONMENT_ID,
    });
    const previewKey = environmentPreviewsQueryKey(session.environmentId);
    queryClient.setQueryData(terminalKey, { sessions: [] });
    queryClient.setQueryData(previewKey, { issues: [], providers: [] });
    vi.mocked(sdk.terminals.restart).mockResolvedValue(session);
    const { result } = renderHook(() => useRestartTerminal(), { wrapper });

    act(() => result.current.mutate({ terminalId: "terminal-1" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryState(terminalKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(previewKey)?.isInvalidated).toBe(true);
  });

  it("invalidates preview data after a terminal closes", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const previewKey = environmentPreviewsQueryKey(session.environmentId);
    queryClient.setQueryData(previewKey, { issues: [], providers: [] });
    vi.mocked(sdk.terminals.close).mockResolvedValue({
      ...session,
      closeReason: "user",
      status: "exited",
    });
    const { result } = renderHook(() => useCloseTerminal(), { wrapper });

    act(() =>
      result.current.mutate({ mode: "force", terminalId: "terminal-1" }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryState(previewKey)?.isInvalidated).toBe(true);
  });
});
