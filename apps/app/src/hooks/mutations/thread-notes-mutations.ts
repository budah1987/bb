import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { setCachedThreadNotes } from "../cache-owners/thread-notes-cache-owner";

export interface SetThreadScratchpadRequest {
  threadId: string;
  scratchpad: string;
}

export interface GenerateThreadRecapRequest {
  force?: boolean;
  threadId: string;
}

/**
 * Requests a recap. Cheap to call when one is already current — the server
 * returns the stored row without paying for inference — which is what lets the
 * Recap section call this simply by being opened.
 *
 * That call is also the signal that this thread's recap is worth maintaining:
 * the server flips `recapEnabled` here, and automatic regeneration is gated on
 * it, so threads whose recap nobody opens never cost anything.
 */
export function useGenerateThreadRecap() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to generate a recap.",
      // A recap is an assist. Failing to produce one leaves the previous recap
      // on screen and is not worth interrupting the user over.
      showErrorToast: false,
    },
    mutationFn: ({ force = false, threadId }: GenerateThreadRecapRequest) =>
      sdk.threads.notes.generateRecap({ force, threadId }),
    onSuccess: (response, { threadId }) => {
      setCachedThreadNotes(queryClient, threadId, response);
    },
  });
}

/**
 * Saves the thread scratchpad. Callers debounce; this is the write itself.
 * The server echoes the stored notes row, which is written into the cache so
 * the "Saved" affordance and any second view settle without a refetch.
 */
export function useSetThreadScratchpad() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to save scratchpad.",
      showErrorToast: false,
    },
    mutationFn: ({ threadId, scratchpad }: SetThreadScratchpadRequest) =>
      sdk.threads.notes.setScratchpad({ threadId, scratchpad }),
    onSuccess: (response, { threadId }) => {
      setCachedThreadNotes(queryClient, threadId, response);
    },
  });
}
