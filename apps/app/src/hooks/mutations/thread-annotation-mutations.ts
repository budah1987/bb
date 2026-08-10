import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ClearBrowserAnnotationsRequest,
  CreateBrowserAnnotationRequest,
  UpdateBrowserAnnotationRequest,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { threadAnnotationsQueryKeyPrefix } from "../queries/query-keys";

function useInvalidateThreadAnnotations() {
  const queryClient = useQueryClient();
  return (threadId: string) =>
    queryClient.invalidateQueries({
      queryKey: threadAnnotationsQueryKeyPrefix(threadId),
    });
}

export function useCreateThreadAnnotation() {
  const invalidate = useInvalidateThreadAnnotations();
  return useMutation({
    mutationFn: (
      input: CreateBrowserAnnotationRequest & { threadId: string },
    ) => sdk.threads.annotations.create(input),
    onSettled: (_annotation, _error, input) => invalidate(input.threadId),
  });
}

export function useUpdateThreadAnnotation() {
  const invalidate = useInvalidateThreadAnnotations();
  return useMutation({
    mutationFn: (
      input: UpdateBrowserAnnotationRequest & {
        annotationId: string;
        threadId: string;
      },
    ) => sdk.threads.annotations.update(input),
    onSettled: (_annotation, _error, input) => invalidate(input.threadId),
  });
}

export function useDeleteThreadAnnotation() {
  const invalidate = useInvalidateThreadAnnotations();
  return useMutation({
    mutationFn: (input: {
      annotationId: string;
      expectedRevision: number;
      threadId: string;
    }) => sdk.threads.annotations.delete(input),
    onSettled: (_result, _error, input) => invalidate(input.threadId),
  });
}

export function useClearThreadAnnotations() {
  const invalidate = useInvalidateThreadAnnotations();
  return useMutation({
    mutationFn: (
      input: ClearBrowserAnnotationsRequest & { threadId: string },
    ) => sdk.threads.annotations.clear(input),
    onSettled: (_result, _error, input) => invalidate(input.threadId),
  });
}
