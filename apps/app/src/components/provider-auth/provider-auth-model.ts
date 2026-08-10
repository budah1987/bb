import type {
  ProviderAuthKey,
  ProviderAuthSession,
  ProviderAuthSnapshot,
  ProviderAuthStatus,
} from "@bb/host-daemon-contract";

/**
 * Providers whose sign-in bb can drive itself. Fixed order so Claude Code and
 * Codex always occupy the same slots, no matter which one logged out first.
 */
export const PROVIDER_AUTH_PROVIDERS = [
  "claudeCode",
  "codex",
] as const satisfies readonly ProviderAuthKey[];

export interface ProviderAuthAttention {
  provider: ProviderAuthKey;
  status: ProviderAuthStatus;
}

/**
 * The providers that earn a re-authentication surface.
 *
 * Only a confirmed `loggedOut` qualifies. `unknown` means the daemon could not
 * read the provider's state and `unavailable` means the CLI isn't usable at
 * all: telling someone to log in when we cannot tell is worse than staying
 * quiet, and the provider-CLI surface already owns the missing-CLI case.
 */
export function selectProviderAuthAttention(
  snapshot: ProviderAuthSnapshot | undefined,
): ProviderAuthAttention[] {
  if (snapshot === undefined) {
    return [];
  }
  return PROVIDER_AUTH_PROVIDERS.filter(
    (provider) => snapshot.statuses[provider].state === "loggedOut",
  ).map((provider) => ({ provider, status: snapshot.statuses[provider] }));
}

export function findProviderAuthStatus(
  snapshot: ProviderAuthSnapshot | undefined,
  provider: ProviderAuthKey,
): ProviderAuthStatus | null {
  return snapshot?.statuses[provider] ?? null;
}

export function findProviderAuthSession(
  snapshot: ProviderAuthSnapshot | undefined,
  provider: ProviderAuthKey,
): ProviderAuthSession | null {
  return (
    snapshot?.sessions.find((session) => session.provider === provider) ?? null
  );
}

/**
 * The login session a surface should show for a provider.
 *
 * The daemon keeps finished sessions in memory, so a `succeeded` session whose
 * machine now reports `loggedOut` describes an earlier login — showing it would
 * claim success for a provider that has since signed out.
 */
export function selectCurrentProviderAuthSession(
  snapshot: ProviderAuthSnapshot | undefined,
  provider: ProviderAuthKey,
): ProviderAuthSession | null {
  const session = findProviderAuthSession(snapshot, provider);
  if (session === null) {
    return null;
  }
  if (
    session.phase === "succeeded" &&
    findProviderAuthStatus(snapshot, provider)?.state !== "loggedIn"
  ) {
    return null;
  }
  return session;
}

/** True while the provider CLI is still working through its login handshake. */
export function isProviderAuthSessionActive(
  session: ProviderAuthSession | null,
): boolean {
  if (session === null) {
    return false;
  }
  return (
    session.phase === "starting" ||
    session.phase === "waitingForUser" ||
    session.phase === "waitingForCode" ||
    session.phase === "verifying"
  );
}

/** True when any provider is mid-login, which is what raises the poll rate. */
export function hasActiveProviderAuthSession(
  snapshot: ProviderAuthSnapshot | undefined,
): boolean {
  return (
    snapshot?.sessions.some((session) =>
      isProviderAuthSessionActive(session),
    ) ?? false
  );
}

/**
 * A finished session that must keep its surface until the user dismisses it:
 * success confirms the account, and the two failure phases carry the message
 * (and, for a locked macOS keychain, the recovery command) that explains what
 * to do next. Restarting the login behind their back would erase all of it.
 */
export function isProviderAuthSessionSettled(
  session: ProviderAuthSession | null,
): boolean {
  if (session === null) {
    return false;
  }
  return (
    session.phase === "succeeded" ||
    session.phase === "failed" ||
    session.phase === "recoveryRequired"
  );
}
