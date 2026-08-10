import type { QueryClient } from "@tanstack/react-query";
import type { ThreadNotesResponse } from "@bb/server-contract";
import { threadNotesQueryKey } from "../queries/query-keys";

/**
 * The scratchpad save returns the whole notes row, so the response is written
 * straight into the cache rather than invalidated: a debounced autosave that
 * refetched would race the next keystroke back into the textarea.
 */
export function setCachedThreadNotes(
  queryClient: QueryClient,
  threadId: string,
  response: ThreadNotesResponse,
): void {
  queryClient.setQueryData(threadNotesQueryKey(threadId), response);
}
