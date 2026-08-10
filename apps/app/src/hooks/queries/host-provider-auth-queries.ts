import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProviderAuthSnapshot } from "@bb/host-daemon-contract";
import { hasActiveProviderAuthSession } from "@/components/provider-auth/provider-auth-model";
import { invalidateHostProviderAuth } from "@/hooks/cache-owners/provider-auth-cache-owner";
import { sdk } from "@/lib/sdk";
import { wsManager } from "@/lib/ws";
import { hostProviderAuthQueryKey } from "./query-keys";
import { requireEnabledQueryArg } from "./query-helpers";

/**
 * Idle cadence. Every read runs provider CLI status checks on the host, so a
 * signed-in machine is polled slowly — just often enough that signing out in a
 * terminal surfaces here without a reload.
 */
const PROVIDER_AUTH_IDLE_POLL_MS = 30_000;

/**
 * Login cadence. The daemon advances a login session from its CLI's output, so
 * the OAuth URL, the device code and the final verdict all arrive by polling.
 */
const PROVIDER_AUTH_ACTIVE_POLL_MS = 1_000;

export interface UseHostProviderAuthArgs {
  hostId: string | null;
  enabled: boolean;
}

/**
 * Provider sign-in state on one machine, plus any login sessions the daemon is
 * currently running. Shared by the desktop alerts and the mobile Command Center
 * surface: they read one query key, so mounting both never doubles the reads.
 */
export function useHostProviderAuth({
  enabled,
  hostId,
}: UseHostProviderAuthArgs) {
  const queryClient = useQueryClient();
  const query = useQuery<ProviderAuthSnapshot>({
    queryKey: hostProviderAuthQueryKey(hostId),
    queryFn: ({ signal }) =>
      sdk.hosts.providerAuthStatus({
        hostId: requireEnabledQueryArg({
          value: hostId,
          hookName: "useHostProviderAuth",
          argName: "hostId",
        }),
        signal,
      }),
    enabled: enabled && hostId !== null,
    refetchInterval: ({ state }) =>
      hasActiveProviderAuthSession(state.data)
        ? PROVIDER_AUTH_ACTIVE_POLL_MS
        : PROVIDER_AUTH_IDLE_POLL_MS,
    refetchOnReconnect: true,
    staleTime: PROVIDER_AUTH_IDLE_POLL_MS,
  });

  // The daemon owns login sessions, so a dropped server socket means this
  // snapshot may describe a machine that has since signed in or out. Re-read as
  // soon as the server is back rather than waiting out the idle interval.
  useEffect(() => {
    if (!enabled || hostId === null) {
      return;
    }
    return wsManager.onConnected(() => {
      void invalidateHostProviderAuth({ hostId, queryClient });
    });
  }, [enabled, hostId, queryClient]);

  return query;
}
