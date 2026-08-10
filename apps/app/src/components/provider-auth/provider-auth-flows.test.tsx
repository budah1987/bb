// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Host } from "@bb/domain";
import type {
  ProviderAuthKey,
  ProviderAuthSession,
  ProviderAuthSnapshot,
  ProviderAuthState,
  ProviderAuthStatus,
} from "@bb/host-daemon-contract";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { ProviderAuthHost } from "./ProviderAuthHost";
import {
  RootComposeProviderAuth,
  useRootComposeProviderAuthLoginOpen,
} from "./RootComposeProviderAuth";
import { resetProviderAuthLoginStoreForTests } from "./provider-auth-login-store";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    hosts: {
      providerAuthStatus: vi.fn(),
      startProviderAuth: vi.fn(),
      submitProviderAuthCode: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ws", () => ({
  wsManager: { onConnected: () => () => {} },
}));

const primaryHost = vi.hoisted(() => ({ current: null as Host | null }));

vi.mock("@/hooks/queries/host-queries", () => ({
  usePrimaryHost: () => primaryHost.current,
}));

vi.mock("@/lib/url-open-routing", () => ({
  openUrlInExternalBrowser: vi.fn(),
}));

const providerAuthStatusMock = vi.mocked(sdk.hosts.providerAuthStatus);
const startProviderAuthMock = vi.mocked(sdk.hosts.startProviderAuth);
const submitProviderAuthCodeMock = vi.mocked(sdk.hosts.submitProviderAuthCode);

function makeHost(status: Host["status"]): Host {
  return {
    id: "host_1",
    name: "laptop",
    type: "persistent",
    status,
    maxPermissionMode: "full",
    lastSeenAt: 1,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeStatus(
  provider: ProviderAuthKey,
  state: ProviderAuthState,
  overrides: Partial<ProviderAuthStatus> = {},
): ProviderAuthStatus {
  return {
    provider,
    displayName: provider === "codex" ? "Codex" : "Claude Code",
    state,
    authMethod: null,
    accountEmail: null,
    organizationName: null,
    message: null,
    ...overrides,
  };
}

function makeSnapshot(args: {
  claudeCode: ProviderAuthState;
  claudeCodeOverrides?: Partial<ProviderAuthStatus>;
  codex: ProviderAuthState;
  sessions?: ProviderAuthSession[];
}): ProviderAuthSnapshot {
  return {
    statuses: {
      claudeCode: makeStatus(
        "claudeCode",
        args.claudeCode,
        args.claudeCodeOverrides ?? {},
      ),
      codex: makeStatus("codex", args.codex),
    },
    sessions: args.sessions ?? [],
  };
}

function claudeWaitingForCode(): ProviderAuthSession {
  return {
    sessionId: "sess_claude",
    provider: "claudeCode",
    phase: "waitingForCode",
    oauthUrl: "https://claude.ai/oauth/authorize?code=1",
    userCode: null,
    codeInputRequired: true,
    message: "Open the link, then paste the one-time code here.",
    recoveryCommand: null,
    startedAt: 1,
  };
}

function codexWaitingForUser(): ProviderAuthSession {
  return {
    sessionId: "sess_codex",
    provider: "codex",
    phase: "waitingForUser",
    oauthUrl: "https://chatgpt.com/device",
    userCode: "ABCD-1234",
    codeInputRequired: false,
    message: "Open ChatGPT and enter this one-time code.",
    recoveryCommand: null,
    startedAt: 1,
  };
}

let queryClient: QueryClient;

function Wrapper({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <CompactViewportOverrideProvider isCompactViewport={compact}>
        {children}
      </CompactViewportOverrideProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetProviderAuthLoginStoreForTests();
  primaryHost.current = makeHost("connected");
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("desktop provider auth alerts", () => {
  it("is silent while loading and for every state that is not a confirmed sign-out", async () => {
    providerAuthStatusMock.mockResolvedValue(
      makeSnapshot({ claudeCode: "unknown", codex: "unavailable" }),
    );
    render(<ProviderAuthHost />, { wrapper: Wrapper });

    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => {
      expect(providerAuthStatusMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays silent while the primary machine is disconnected", async () => {
    primaryHost.current = makeHost("disconnected");
    providerAuthStatusMock.mockResolvedValue(
      makeSnapshot({ claudeCode: "loggedOut", codex: "loggedOut" }),
    );
    render(<ProviderAuthHost />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    expect(providerAuthStatusMock).not.toHaveBeenCalled();
  });

  it("gives each signed-out provider its own alert and leaves the other alone", async () => {
    providerAuthStatusMock.mockResolvedValue(
      makeSnapshot({ claudeCode: "loggedOut", codex: "loggedOut" }),
    );
    startProviderAuthMock.mockResolvedValue(
      makeSnapshot({
        claudeCode: "loggedOut",
        codex: "loggedOut",
        sessions: [claudeWaitingForCode()],
      }),
    );
    render(<ProviderAuthHost />, { wrapper: Wrapper });

    const claudeAlert = await screen.findByTestId(
      "provider-auth-alert-claudeCode",
    );
    expect(claudeAlert.textContent).toContain("Claude Code is signed out");
    expect(
      screen.getByTestId("provider-auth-alert-codex").textContent,
    ).toContain("Codex is signed out");

    fireEvent.click(
      within(claudeAlert).getByRole("button", { name: "Log in" }),
    );

    await waitFor(() => {
      expect(startProviderAuthMock).toHaveBeenCalledWith({
        hostId: "host_1",
        provider: "claudeCode",
      });
    });
    // Opening Claude's login must not touch Codex.
    expect(startProviderAuthMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("provider-auth-alert-codex")).not.toBeNull();
  });

  it("submits the Claude code exactly as typed and then confirms the account", async () => {
    providerAuthStatusMock.mockResolvedValue(
      makeSnapshot({ claudeCode: "loggedOut", codex: "loggedIn" }),
    );
    startProviderAuthMock.mockResolvedValue(
      makeSnapshot({
        claudeCode: "loggedOut",
        codex: "loggedIn",
        sessions: [claudeWaitingForCode()],
      }),
    );
    submitProviderAuthCodeMock.mockResolvedValue(
      makeSnapshot({
        claudeCode: "loggedIn",
        claudeCodeOverrides: {
          accountEmail: "dev@example.com",
          organizationName: "Example Org",
        },
        codex: "loggedIn",
        sessions: [{ ...claudeWaitingForCode(), phase: "succeeded" }],
      }),
    );
    render(<ProviderAuthHost />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Log in" }));

    const oauthUrl = await screen.findByTestId("provider-auth-oauth-url");
    expect(oauthUrl.textContent).toBe(
      "https://claude.ai/oauth/authorize?code=1",
    );

    // The provider owns the code format, so surrounding whitespace must survive.
    const rawCode = "  code-With Space  ";
    fireEvent.change(screen.getByLabelText("One-time code"), {
      target: { value: rawCode },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit code" }));

    await waitFor(() => {
      expect(submitProviderAuthCodeMock).toHaveBeenCalledWith({
        hostId: "host_1",
        sessionId: "sess_claude",
        code: rawCode,
      });
    });

    const succeeded = await screen.findByTestId("provider-auth-succeeded");
    expect(succeeded.textContent).toContain("dev@example.com");
    expect(succeeded.textContent).toContain("Example Org");
    // Only the provider that succeeded loses its alert.
    expect(screen.queryByTestId("provider-auth-alert-claudeCode")).toBeNull();
  });

  it("shows the Codex device code with an Open ChatGPT control and no code field", async () => {
    providerAuthStatusMock.mockResolvedValue(
      makeSnapshot({ claudeCode: "loggedIn", codex: "loggedOut" }),
    );
    startProviderAuthMock.mockResolvedValue(
      makeSnapshot({
        claudeCode: "loggedIn",
        codex: "loggedOut",
        sessions: [codexWaitingForUser()],
      }),
    );
    render(<ProviderAuthHost />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Log in" }));

    const deviceCode = await screen.findByTestId("provider-auth-device-code");
    expect(deviceCode.textContent).toBe("ABCD-1234");
    expect(
      screen.queryByRole("button", { name: "Open ChatGPT" }),
    ).not.toBeNull();
    expect(screen.queryByLabelText("One-time code")).toBeNull();
  });

  it("keeps the login and the typed code when the dialog closes and reopens", async () => {
    providerAuthStatusMock.mockResolvedValue(
      makeSnapshot({
        claudeCode: "loggedOut",
        codex: "loggedIn",
        sessions: [claudeWaitingForCode()],
      }),
    );
    render(<ProviderAuthHost />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Log in" }));
    fireEvent.change(await screen.findByLabelText("One-time code"), {
      target: { value: "kept-code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("One-time code")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    const field =
      await screen.findByLabelText<HTMLInputElement>("One-time code");
    expect(field.value).toBe("kept-code");
    // The daemon already had a live session, so nothing was restarted.
    expect(startProviderAuthMock).not.toHaveBeenCalled();
  });

  it("shows the keychain recovery command instead of running anything", async () => {
    providerAuthStatusMock.mockResolvedValue(
      makeSnapshot({
        claudeCode: "loggedOut",
        codex: "loggedIn",
        sessions: [
          {
            ...claudeWaitingForCode(),
            phase: "recoveryRequired",
            message: "Unlock the macOS login keychain locally.",
            recoveryCommand: "security unlock-keychain ~/Library/Keychains/x",
          },
        ],
      }),
    );
    render(<ProviderAuthHost />, { wrapper: Wrapper });

    fireEvent.click(await screen.findByRole("button", { name: "Log in" }));

    const command = await screen.findByTestId("provider-auth-recovery-command");
    expect(command.textContent).toBe(
      "security unlock-keychain ~/Library/Keychains/x",
    );
    expect(
      screen.getByText(
        "Enter your Mac password only on that Mac. Never paste or send it to BB.",
      ),
    ).not.toBeNull();
    expect(startProviderAuthMock).not.toHaveBeenCalled();
  });
});

describe("mobile Command Center provider auth", () => {
  function CompactSurface() {
    const loginOpen = useRootComposeProviderAuthLoginOpen();
    return (
      <>
        <RootComposeProviderAuth />
        {loginOpen ? null : <p>Sessions</p>}
      </>
    );
  }

  function renderCompact() {
    return render(<CompactSurface />, {
      wrapper: ({ children }) => <Wrapper compact>{children}</Wrapper>,
    });
  }

  it("lists one needs-attention item per signed-out provider, above Sessions", async () => {
    providerAuthStatusMock.mockResolvedValue(
      makeSnapshot({ claudeCode: "loggedOut", codex: "loggedIn" }),
    );
    renderCompact();

    const section = await screen.findByTestId("root-compose-provider-auth");
    expect(section.textContent).toContain("Needs attention");
    expect(section.textContent).toContain("Claude Code is signed out");
    expect(section.textContent).not.toContain("Codex is signed out");
    expect(screen.queryByText("Sessions")).not.toBeNull();
  });

  it("renders no item when nothing is confirmed signed out", async () => {
    providerAuthStatusMock.mockResolvedValue(
      makeSnapshot({ claudeCode: "loggedIn", codex: "unknown" }),
    );
    renderCompact();

    await waitFor(() => {
      expect(providerAuthStatusMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("root-compose-provider-auth")).toBeNull();
  });

  it("opens a dedicated login view and returns through an explicit button", async () => {
    providerAuthStatusMock.mockResolvedValue(
      makeSnapshot({
        claudeCode: "loggedIn",
        codex: "loggedOut",
        sessions: [codexWaitingForUser()],
      }),
    );
    renderCompact();

    fireEvent.click(await screen.findByRole("button", { name: "Log in" }));

    const view = await screen.findByTestId("root-compose-provider-auth-login");
    expect(view.textContent).toContain("Log in to Codex");
    expect(
      within(view).getByTestId("provider-auth-device-code").textContent,
    ).toBe("ABCD-1234");
    // The login owns the screen while it is open.
    expect(screen.queryByText("Sessions")).toBeNull();

    fireEvent.click(
      within(view).getByRole("button", { name: "Command Center" }),
    );

    expect(screen.queryByTestId("root-compose-provider-auth-login")).toBeNull();
    expect(screen.queryByText("Sessions")).not.toBeNull();
  });

  it("keeps the login and the typed code after the view closes", async () => {
    providerAuthStatusMock.mockResolvedValue(
      makeSnapshot({
        claudeCode: "loggedOut",
        codex: "loggedIn",
        sessions: [claudeWaitingForCode()],
      }),
    );
    renderCompact();

    fireEvent.click(await screen.findByRole("button", { name: "Log in" }));
    fireEvent.change(await screen.findByLabelText("One-time code"), {
      target: { value: "still-here" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Command Center" }));
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    const field =
      await screen.findByLabelText<HTMLInputElement>("One-time code");
    expect(field.value).toBe("still-here");
    expect(startProviderAuthMock).not.toHaveBeenCalled();
  });
});
