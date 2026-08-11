import type { QueryClientArg } from "../cache-effect-types";
import { sidebarNavigationQueryKey } from "../queries/query-keys";

export function invalidateSpaceQueries({
  queryClient,
}: QueryClientArg): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: sidebarNavigationQueryKey(),
  });
}
