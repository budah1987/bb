import type { QueryClient } from "@tanstack/react-query";
import { environmentSimulatorStatusQueryKey } from "../queries/query-keys";

export function invalidateEnvironmentSimulatorStatus(args: {
  environmentId: string;
  queryClient: QueryClient;
}): Promise<void> {
  return args.queryClient.invalidateQueries({
    queryKey: environmentSimulatorStatusQueryKey(args.environmentId),
  });
}
