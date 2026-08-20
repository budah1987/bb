import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Environment } from "@bb/domain";
import type {
  EnvironmentArchiveThreadsResponse,
  EnvironmentActionResponse,
  UpdateEnvironmentRequest,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import type { RequestEnvironmentActionMutationRequest } from "./mutation-request-types";
import {
  invalidateEnvironmentActionQueries,
  invalidateGithubRepositoryHealthQueries,
  invalidateEnvironmentPreviewQueries,
} from "../cache-owners/environment-cache-effects";
import { applyEnvironmentUpdateResult } from "../cache-owners/environment-workspace-cache-owner";
import { invalidateTerminalScopes } from "../cache-owners/terminal-cache-owner";
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
        case "publish_to_main":
          return sdk.environments.publishToMain({
            environmentId: id,
            preserveTargetChanges: request.options.preserveTargetChanges,
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
        case "pull_request_checks_rerun":
          return sdk.environments.rerunPullRequestChecks({
            environmentId: id,
            target: request.options,
          });
        case "publish_to_main":
          return sdk.environments.publishToMain({ environmentId: id });
        case "update_from_main":
          return sdk.environments.updateFromMain({ environmentId: id });
      }
      throw new Error("Unsupported environment action");
    },
    onSettled: (_response, _error, variables) => {
      invalidateEnvironmentActionQueries({
        environmentId: variables.id,
        queryClient,
      });
      if (variables.action.startsWith("pull_request_")) {
        invalidateGithubRepositoryHealthQueries({ queryClient });
      }
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

export function useStartEnvironmentDevServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sdk.environments.startDevServer,
    onSuccess: (_session, input) => {
      invalidateTerminalScopes({
        queryClient,
        scopes: [
          {
            kind: "environment",
            environmentId: input.environmentId,
          },
          {
            kind: "thread",
            threadId: input.threadId,
          },
        ],
      });
      invalidateEnvironmentPreviewQueries({
        environmentId: input.environmentId,
        queryClient,
      });
    },
  });
}

export function useShareEnvironmentPreviewPort() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sdk.environments.sharePreviewPort,
    onSuccess: (_result, input) =>
      invalidateEnvironmentPreviewQueries({
        environmentId: input.environmentId,
        queryClient,
      }),
  });
}

export function useUnshareEnvironmentPreviewPort() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sdk.environments.unsharePreviewPort,
    onSuccess: (_result, input) =>
      invalidateEnvironmentPreviewQueries({
        environmentId: input.environmentId,
        queryClient,
      }),
  });
}

export function useBypassEnvironmentPreviewProtection() {
  return useMutation({ mutationFn: sdk.environments.bypassPreviewProtection });
}

export function useControlEnvironmentDocker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sdk.environments.dockerControl,
    onSettled: (_result, _error, input) => {
      invalidateEnvironmentActionQueries({
        environmentId: input.environmentId,
        queryClient,
      });
      invalidateEnvironmentPreviewQueries({
        environmentId: input.environmentId,
        queryClient,
      });
    },
  });
}
