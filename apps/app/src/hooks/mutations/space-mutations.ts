import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateSpaceRequest,
  DeleteSpaceRequest,
  UpdateSpaceRequest,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { invalidateSpaceQueries } from "../cache-owners/space-cache-owner";

function useInvalidateSpaces() {
  const queryClient = useQueryClient();
  return () => invalidateSpaceQueries({ queryClient });
}

export function useCreateSpace() {
  const invalidate = useInvalidateSpaces();
  return useMutation({
    meta: { errorMessage: "Failed to create Space." },
    mutationFn: (request: CreateSpaceRequest) => sdk.spaces.create(request),
    onSuccess: invalidate,
  });
}

export function useUpdateSpace() {
  const invalidate = useInvalidateSpaces();
  return useMutation({
    meta: { errorMessage: "Failed to update Space." },
    mutationFn: ({
      spaceId,
      ...request
    }: UpdateSpaceRequest & { spaceId: string }) =>
      sdk.spaces.update({ spaceId, ...request }),
    onSuccess: invalidate,
  });
}

export function useDeleteSpace() {
  const invalidate = useInvalidateSpaces();
  return useMutation({
    meta: { errorMessage: "Failed to delete Space." },
    mutationFn: ({
      spaceId,
      ...request
    }: DeleteSpaceRequest & { spaceId: string }) =>
      sdk.spaces.delete({ spaceId, ...request }),
    onSuccess: invalidate,
  });
}

export function useMoveProjectToSpace() {
  const invalidate = useInvalidateSpaces();
  return useMutation({
    meta: { errorMessage: "Failed to move project." },
    mutationFn: (request: { projectId: string; spaceId: string }) =>
      sdk.spaces.moveProject(request),
    onSuccess: invalidate,
  });
}
