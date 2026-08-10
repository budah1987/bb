import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProviderAuthSnapshot } from "@bb/host-daemon-contract";
import { useHostProviderAuth } from "@/hooks/queries/host-provider-auth-queries";
import { usePrimaryHost } from "@/hooks/queries/host-queries";
import {
  getProviderAuthLoginSnapshot,
  registerProviderAuthQueryClient,
  subscribeProviderAuthLogins,
  type ProviderAuthLoginSnapshot,
} from "./provider-auth-login-store";
import {
  selectProviderAuthAttention,
  type ProviderAuthAttention,
} from "./provider-auth-model";

export interface ProviderAuthSurface {
  /** Providers confirmed signed out on the primary machine. */
  attention: ProviderAuthAttention[];
  /** The connected primary machine, or null when there is nothing to ask. */
  hostId: string | null;
  login: ProviderAuthLoginSnapshot;
  snapshot: ProviderAuthSnapshot | undefined;
}

/**
 * Provider re-authentication state for the machine bb runs work on.
 *
 * Sign-in is host-local, so this follows the primary host and stays silent while
 * it is disconnected — a machine bb cannot reach cannot be signed in either.
 */
export function useProviderAuthSurface(): ProviderAuthSurface {
  const queryClient = useQueryClient();
  useEffect(() => {
    registerProviderAuthQueryClient(queryClient);
  }, [queryClient]);

  const primaryHost = usePrimaryHost();
  const hostId =
    primaryHost !== null && primaryHost.status === "connected"
      ? primaryHost.id
      : null;
  const { data: snapshot } = useHostProviderAuth({
    hostId,
    enabled: hostId !== null,
  });
  const login = useSyncExternalStore(
    subscribeProviderAuthLogins,
    getProviderAuthLoginSnapshot,
  );
  const attention = useMemo(
    () => selectProviderAuthAttention(snapshot),
    [snapshot],
  );

  return { attention, hostId, login, snapshot };
}
