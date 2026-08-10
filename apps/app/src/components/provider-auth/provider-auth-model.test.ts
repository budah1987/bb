import type {
  ProviderAuthKey,
  ProviderAuthSession,
  ProviderAuthSnapshot,
  ProviderAuthState,
  ProviderAuthStatus,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  hasActiveProviderAuthSession,
  selectCurrentProviderAuthSession,
  selectProviderAuthAttention,
} from "./provider-auth-model";

function status(
  provider: ProviderAuthKey,
  state: ProviderAuthState,
): ProviderAuthStatus {
  return {
    provider,
    displayName: provider === "codex" ? "Codex" : "Claude Code",
    state,
    authMethod: null,
    accountEmail: null,
    organizationName: null,
    message: null,
  };
}

function session(
  provider: ProviderAuthKey,
  phase: ProviderAuthSession["phase"],
): ProviderAuthSession {
  return {
    sessionId: `sess_${provider}`,
    provider,
    phase,
    oauthUrl: null,
    userCode: null,
    codeInputRequired: provider === "claudeCode",
    message: null,
    recoveryCommand: null,
    startedAt: 1,
  };
}

function snapshot(
  claudeCode: ProviderAuthState,
  codex: ProviderAuthState,
  sessions: ProviderAuthSession[] = [],
): ProviderAuthSnapshot {
  return {
    statuses: {
      claudeCode: status("claudeCode", claudeCode),
      codex: status("codex", codex),
    },
    sessions,
  };
}

describe("selectProviderAuthAttention", () => {
  it("says nothing while the snapshot has not loaded", () => {
    expect(selectProviderAuthAttention(undefined)).toEqual([]);
  });

  it("only surfaces a confirmed logged-out provider", () => {
    expect(
      selectProviderAuthAttention(snapshot("loggedIn", "loggedOut")).map(
        (item) => item.provider,
      ),
    ).toEqual(["codex"]);
    expect(
      selectProviderAuthAttention(snapshot("unknown", "unavailable")),
    ).toEqual([]);
    expect(
      selectProviderAuthAttention(snapshot("loggedIn", "loggedIn")),
    ).toEqual([]);
  });

  it("surfaces each signed-out provider separately, in a fixed order", () => {
    expect(
      selectProviderAuthAttention(snapshot("loggedOut", "loggedOut")).map(
        (item) => item.provider,
      ),
    ).toEqual(["claudeCode", "codex"]);
  });
});

describe("selectCurrentProviderAuthSession", () => {
  it("keeps a succeeded session while the machine agrees it is signed in", () => {
    const current = selectCurrentProviderAuthSession(
      snapshot("loggedIn", "loggedOut", [session("claudeCode", "succeeded")]),
      "claudeCode",
    );
    expect(current?.phase).toBe("succeeded");
  });

  it("drops a succeeded session once the provider is signed out again", () => {
    // The daemon keeps finished sessions, so a later sign-out would otherwise
    // reopen on a stale success screen.
    expect(
      selectCurrentProviderAuthSession(
        snapshot("loggedOut", "loggedIn", [session("claudeCode", "succeeded")]),
        "claudeCode",
      ),
    ).toBeNull();
  });

  it("keeps a failed session so its message survives reopening", () => {
    const current = selectCurrentProviderAuthSession(
      snapshot("loggedOut", "loggedIn", [session("claudeCode", "failed")]),
      "claudeCode",
    );
    expect(current?.phase).toBe("failed");
  });

  it("reads each provider's session independently", () => {
    const both = snapshot("loggedOut", "loggedOut", [
      session("claudeCode", "waitingForCode"),
      session("codex", "waitingForUser"),
    ]);
    expect(selectCurrentProviderAuthSession(both, "claudeCode")?.phase).toBe(
      "waitingForCode",
    );
    expect(selectCurrentProviderAuthSession(both, "codex")?.phase).toBe(
      "waitingForUser",
    );
  });
});

describe("hasActiveProviderAuthSession", () => {
  it("is true only while a handshake is unfinished", () => {
    expect(
      hasActiveProviderAuthSession(
        snapshot("loggedOut", "loggedIn", [session("claudeCode", "verifying")]),
      ),
    ).toBe(true);
    expect(
      hasActiveProviderAuthSession(
        snapshot("loggedIn", "loggedIn", [session("claudeCode", "succeeded")]),
      ),
    ).toBe(false);
    expect(hasActiveProviderAuthSession(undefined)).toBe(false);
  });
});
