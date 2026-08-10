import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Environment } from "@bb/domain";
import type {
  EnvironmentArchiveThreadsResponse,
  EnvironmentActionResponse,
  UpdateEnvironmentRequest,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import type { RequestEnvironmentActionMutationRequest } from "./mutation-request-types";
import { invalidateEnvironmentActionQueries } from "../cache-owners/environment-cache-effects";
import { applyEnvironmentUpdateResult } from "../cache-owners/environment-workspace-cache-owner";
import {
  beginArchiveEnvironmentThreadsTransaction,
  rollbackArchiveEnvironmentThreadsTransaction,
  settleArchiveEnvironmentThreadsTransaction,
  type ArchiveEnvironmentThreadsTransaction,
} from "../cache-owners/thread-list-cache-owner";
type UpdateEnvironmentMutationRequest = {
  id: string;
} & UpdateEnvironmentRequest;

interface ArchiveEnvironmentThreadsMutationRequest {
  id: string;
}

export function useRequestEnvironmentAction() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to run environment action.",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
      ...request
    }: RequestEnvironmentActionMutationRequest): Promise<EnvironmentActionResponse> => {
      switch (request.action) {
        case "commit":
          return sdk.environments.commit({
            environmentId: id,
            ...(request.options === undefined
              ? {}
              : { paths: request.options.paths }),
          });
        case "squash_merge":
          return sdk.environments.squashMerge({
            environmentId: id,
            mergeBaseBranch: request.options.mergeBaseBranch,
          });
        case "pull_request_metadata":
          return sdk.environments.generatePullRequestMetadata({
            environmentId: id,
            baseBranch: request.options.baseBranch,
            fallbackTitle: request.options.fallbackTitle,
          });
        case "pull_request_create":
          return sdk.environments.createPullRequest({
            environmentId: id,
            baseBranch: request.options.baseBranch,
            body: request.options.body,
            draft: request.options.draft,
            title: request.options.title,
          });
        case "pull_request_ready":
          return sdk.environments.markPullRequestReady({ environmentId: id });
        case "pull_request_merge":
          return sdk.environments.mergePullRequest({
            environmentId: id,
            method: request.options.method,
          });
        case "pull_request_draft":
          return sdk.environments.markPullRequestDraft({ environmentId: id });
      }
    },
    onSettled: (_response, _error, variables) => {
      invalidateEnvironmentActionQueries({
        environmentId: variables.id,
        queryClient,
      });
    },
  });
}

export function useArchiveEnvironmentThreads() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to archive threads.",
      // Every caller reports its own failure, inline or as an owned toast.
      showErrorToast: false,
    },
    mutationFn: ({
      id,
    }: ArchiveEnvironmentThreadsMutationRequest): Promise<EnvironmentArchiveThreadsResponse> =>
      sdk.environments.archiveThreads({ environmentId: id }),
    onMutate: async ({ id }): Promise<ArchiveEnvironmentThreadsTransaction> =>
      beginArchiveEnvironmentThreadsTransaction({
        environmentId: id,
        queryClient,
      }),
    onError: (_error, _variables, context) => {
      rollbackArchiveEnvironmentThreadsTransaction({
        queryClient,
        transaction: context,
      });
    },
    onSettled: (data, _error, variables, context) => {
      invalidateEnvironmentActionQueries({
        environmentId: variables.id,
        queryClient,
      });
      settleArchiveEnvironmentThreadsTransaction({
        queryClient,
        response: data,
        transaction: context,
      });
    },
  });
}

export function useUpdateEnvironment() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update environment.",
      showErrorToast: false,
    },
    mutationFn: ({ id, ...request }: UpdateEnvironmentMutationRequest) => {
      if (request.githubAccountLogin !== undefined) {
        return sdk.environments.update({
          environmentId: id,
          githubAccountLogin: request.githubAccountLogin,
          ...(request.mergeBaseBranch === undefined
            ? {}
            : { mergeBaseBranch: request.mergeBaseBranch }),
          ...(request.name === undefined ? {} : { name: request.name }),
        });
      }
      if (request.name !== undefined) {
        return sdk.environments.update({
          environmentId: id,
          name: request.name,
          ...(request.mergeBaseBranch === undefined
            ? {}
            : { mergeBaseBranch: request.mergeBaseBranch }),
        });
      }
      if (request.mergeBaseBranch !== undefined) {
        return sdk.environments.update({
          environmentId: id,
          mergeBaseBranch: request.mergeBaseBranch,
        });
      }
      throw new Error("Environment update requires at least one field");
    },
    onSuccess: (environment: Environment) => {
      applyEnvironmentUpdateResult({ environment, queryClient });
    },
  });
}
