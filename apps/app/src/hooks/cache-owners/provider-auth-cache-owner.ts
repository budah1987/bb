import type { QueryClient } from "@tanstack/react-query";
import type { ProviderAuthSnapshot } from "@bb/host-daemon-contract";
import { hostProviderAuthQueryKey } from "../queries/query-keys";

export interface HostProviderAuthCacheArgs {
  hostId: string;
  queryClient: QueryClient;
}

export interface WriteHostProviderAuthSnapshotArgs extends HostProviderAuthCacheArgs {
  snapshot: ProviderAuthSnapshot;
}

/**
 * Adopts the snapshot a start/submit-code request returned.
 *
 * Starting a login and submitting a code both answer with the machine's full
 * provider-auth state, so writing it here moves the surface to the next phase
 * immediately instead of waiting out the poll interval.
 */
export function writeHostProviderAuthSnapshot(
  args: WriteHostProviderAuthSnapshotArgs,
): void {
  args.queryClient.setQueryData(
    hostProviderAuthQueryKey(args.hostId),
    args.snapshot,
  );
}

/** Re-reads a machine's provider sign-in state, e.g. after a server reconnect. */
export function invalidateHostProviderAuth(
  args: HostProviderAuthCacheArgs,
): Promise<void> {
  return args.queryClient.invalidateQueries({
    queryKey: hostProviderAuthQueryKey(args.hostId),
  });
}
