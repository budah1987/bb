import { useQuery } from "@tanstack/react-query";
import type { BrowserAnnotationListResponse } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { useThreadDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import {
  threadAnnotationsQueryKey,
  type ThreadAnnotationsQueryFilters,
} from "./query-keys";
import { RESUME_REFETCH_QUERY_POLICY } from "./query-policies";

interface ThreadAnnotationsQueryOptions extends ThreadAnnotationsQueryFilters {
  enabled?: boolean;
}

export function useThreadAnnotations(
  threadId: string,
  options: ThreadAnnotationsQueryOptions = {},
) {
  const enabled = (options.enabled ?? true) && threadId.length > 0;
  useThreadDetailRealtimeSubscription(threadId, { enabled });
  const filters: ThreadAnnotationsQueryFilters = {
    ...(options.browserTabId === undefined
      ? {}
      : { browserTabId: options.browserTabId }),
    ...(options.status === undefined ? {} : { status: options.status }),
  };
  return useQuery<BrowserAnnotationListResponse>({
    queryKey: threadAnnotationsQueryKey(threadId, filters),
    queryFn: ({ signal }) =>
      sdk.threads.annotations.list({ threadId, ...filters, signal }),
    enabled,
    ...RESUME_REFETCH_QUERY_POLICY,
  });
}
