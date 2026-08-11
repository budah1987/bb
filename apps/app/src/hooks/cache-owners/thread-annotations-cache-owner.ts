import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { threadAnnotationsQueryKeyPrefix } from "../queries/query-keys";

export function getThreadAnnotationInvalidationQueryKeys(
  threadId: string,
): QueryKey[] {
  return [threadAnnotationsQueryKeyPrefix(threadId)];
}

export function invalidateCachedThreadAnnotations(
  queryClient: QueryClient,
  threadId: string,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: threadAnnotationsQueryKeyPrefix(threadId),
  });
}
