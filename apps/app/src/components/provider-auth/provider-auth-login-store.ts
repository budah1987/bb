import type { QueryClient } from "@tanstack/react-query";
import type {
  ProviderAuthKey,
  ProviderAuthSnapshot,
} from "@bb/host-daemon-contract";
import { writeHostProviderAuthSnapshot } from "@/hooks/cache-owners/provider-auth-cache-owner";
import { sdk } from "@/lib/sdk";
import { resetProviderAuthMobileViewForTests } from "./provider-auth-mobile-view-store";

export type ProviderAuthPendingRequest = "start" | "submit";

export interface ProviderAuthLoginEntry {
  /**
   * The one-time code as the user typed it. Kept verbatim — the provider owns
   * the format, so bb never trims or reshapes it.
   */
  code: string;
  pending: ProviderAuthPendingRequest | null;
  /** Message from a failed start/submit request, not from the login itself. */
  error: string | null;
}

export interface ProviderAuthLoginSnapshot {
  /** Provider whose desktop dialog is open, or null when none is. */
  dialogProvider: ProviderAuthKey | null;
  entries: Readonly<Record<ProviderAuthKey, ProviderAuthLoginEntry>>;
}

const EMPTY_ENTRY: ProviderAuthLoginEntry = {
  code: "",
  pending: null,
  error: null,
};

function initialSnapshot(): ProviderAuthLoginSnapshot {
  return {
    dialogProvider: null,
    entries: {
      claudeCode: EMPTY_ENTRY,
      codex: EMPTY_ENTRY,
    },
  };
}

// Module-level, not component state: a provider login is a live process on the
// host, and closing the dialog or leaving the mobile login view must not cancel
// it or lose the code already typed. Components subscribe to mirror it.
let snapshot: ProviderAuthLoginSnapshot = initialSnapshot();
let queryClient: QueryClient | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setSnapshot(patch: Partial<ProviderAuthLoginSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  emit();
}

function setEntry(
  provider: ProviderAuthKey,
  patch: Partial<ProviderAuthLoginEntry>,
): void {
  setSnapshot({
    entries: {
      ...snapshot.entries,
      [provider]: { ...snapshot.entries[provider], ...patch },
    },
  });
}

export function subscribeProviderAuthLogins(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getProviderAuthLoginSnapshot(): ProviderAuthLoginSnapshot {
  return snapshot;
}

/**
 * The store outlives every component, so it cannot read the query client from
 * React context when a login request resolves. Mounted consumers hand it over;
 * the app's client is process-stable, so the last registration stays correct.
 */
export function registerProviderAuthQueryClient(client: QueryClient): void {
  queryClient = client;
}

export function openProviderAuthDialog(provider: ProviderAuthKey): void {
  setSnapshot({ dialogProvider: provider });
}

export function closeProviderAuthDialog(): void {
  setSnapshot({ dialogProvider: null });
}

/** Drops the finished attempt so the provider can be signed in again cleanly. */
export function clearProviderAuthAttempt(provider: ProviderAuthKey): void {
  setEntry(provider, EMPTY_ENTRY);
}

export function setProviderAuthCode(
  provider: ProviderAuthKey,
  code: string,
): void {
  setEntry(provider, { code, error: null });
}

function applySnapshot(hostId: string, snapshot: ProviderAuthSnapshot): void {
  if (queryClient === null) {
    return;
  }
  writeHostProviderAuthSnapshot({ hostId, queryClient, snapshot });
}

function requestErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface StartProviderAuthLoginArgs {
  hostId: string;
  provider: ProviderAuthKey;
}

/**
 * Asks the host to start the provider's login. The daemon reuses an already
 * running session, so a duplicate call is harmless; the pending guard exists to
 * keep two surfaces from racing the same request.
 */
export function startProviderAuthLogin({
  hostId,
  provider,
}: StartProviderAuthLoginArgs): void {
  if (snapshot.entries[provider].pending !== null) {
    return;
  }
  setEntry(provider, { pending: "start", error: null });
  void sdk.hosts
    .startProviderAuth({ hostId, provider })
    .then((result) => {
      applySnapshot(hostId, result);
      setEntry(provider, { pending: null, error: null });
    })
    .catch((error: unknown) => {
      setEntry(provider, {
        pending: null,
        error: requestErrorMessage(error),
      });
    });
}

export interface SubmitProviderAuthCodeArgs {
  hostId: string;
  provider: ProviderAuthKey;
  sessionId: string;
}

/**
 * Forwards the typed code to the host untouched. `code` is read from the store
 * rather than passed in so a submit that outlives its surface still sends
 * exactly what the user typed.
 */
export function submitProviderAuthCode({
  hostId,
  provider,
  sessionId,
}: SubmitProviderAuthCodeArgs): void {
  const { code, pending } = snapshot.entries[provider];
  if (pending !== null || code.length === 0) {
    return;
  }
  setEntry(provider, { pending: "submit", error: null });
  void sdk.hosts
    .submitProviderAuthCode({ hostId, sessionId, code })
    .then((result) => {
      applySnapshot(hostId, result);
      setEntry(provider, { pending: null, error: null });
    })
    .catch((error: unknown) => {
      setEntry(provider, {
        pending: null,
        error: requestErrorMessage(error),
      });
    });
}

/** Drop all cross-test state from this module-level store. */
export function resetProviderAuthLoginStoreForTests(): void {
  snapshot = initialSnapshot();
  queryClient = null;
  listeners.clear();
  resetProviderAuthMobileViewForTests();
}
