import {
  createElement,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { appToast } from "@/components/ui/app-toast";
import { AppToastCommitDescription } from "@/components/ui/app-toast-descriptions";
import type {
  Environment,
  PromptInput,
  Thread,
  WorkspaceStatus,
} from "@bb/domain";
import type {
  CommitActionResponse,
  EnvironmentActionFailureDetails,
  SquashMergeActionResponse,
} from "@bb/server-contract";
import { useDialogState } from "@/hooks/useDialogState";
import {
  COMMIT_SELECTION_STALE_MESSAGE,
  type ThreadGitActionDialogTarget,
} from "@/components/dialogs/ThreadGitActionDialog";
import {
  buildCommitFailureFollowUpInstruction,
  buildSquashMergeCommitFailureFollowUpInstruction,
  buildSquashMergeConflictFollowUpInstruction,
} from "@/lib/thread-operation-prompts";
import { toEnvironmentActionFailureDetails } from "@/lib/environment-action-failures";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import type {
  RequestEnvironmentActionMutationLike,
  SendMessageMutationLike,
} from "./threadDetailMutationTypes";

interface BuildAskAgentInputForGitOperationParams {
  error: unknown;
  mergeBaseBranch?: string;
}

interface GitActionFailure {
  askAgentInput?: PromptInput[];
  message: string;
}

interface ToGitActionFailureParams {
  action: GitActionKind;
  error: unknown;
  mergeBaseBranch?: string;
}

interface AskAgentToFixGitActionParams {
  input: PromptInput[];
  threadId: string;
}

interface EnqueueGitActionParams {
  action: GitActionKind;
  run: QueuedGitActionRunner;
}

interface RunQueuedGitActionParams {
  toastId: string | number;
}

interface CommitThreadParams {
  /** Repository-relative paths selected in the commit dialog. */
  selectedPaths: string[];
}

interface RunCommitThreadParams
  extends CommitThreadParams, RunQueuedGitActionParams {}

interface SquashMergeThreadParams {
  mergeBaseBranch: string;
}

interface RunSquashMergeThreadParams
  extends SquashMergeThreadParams, RunQueuedGitActionParams {}

type AskAgentToFixGitAction = (params: AskAgentToFixGitActionParams) => void;

type GitActionKind = "commit" | "squash_merge";
type QueuedGitActionRunner = (
  params: RunQueuedGitActionParams,
) => Promise<void>;

interface ShowGitActionErrorToastParams {
  action: GitActionKind;
  error: unknown;
  mergeBaseBranch?: string;
  onAskAgentToFix: AskAgentToFixGitAction;
  threadId: string;
  toastId: string | number;
}

interface ShowGitActionSuccessToastParams {
  response: GitActionSuccessResponse;
  toastId: string | number;
}

interface UseThreadGitActionsParams {
  environment?: Environment;
  requestEnvironmentAction: RequestEnvironmentActionMutationLike;
  sendMessage: SendMessageMutationLike;
  thread?: Thread;
  workspaceStatus?: WorkspaceStatus;
}

interface ThreadHeaderGitAction {
  label: string;
  target: ThreadGitActionDialogTarget;
}

type GitActionSuccessResponse =
  | CommitActionResponse
  | SquashMergeActionResponse;

function getEnvironmentActionFailureDetailMessage(
  details: EnvironmentActionFailureDetails,
): string | undefined {
  switch (details.kind) {
    case "commit_failed":
      return details.errorMessage;
    case "squash_merge_conflict":
      return details.conflictFiles.length > 0
        ? `Conflicts: ${details.conflictFiles.join(", ")}`
        : undefined;
    case "squash_merge_commit_failed":
      return details.errorMessage;
    case "commit_selection_stale":
      return COMMIT_SELECTION_STALE_MESSAGE;
    case "squash_merge_dirty_worktree":
      return "Commit this worktree before squash merging.";
    default:
      return undefined;
  }
}

function buildAskAgentInputForGitOperation({
  error,
  mergeBaseBranch,
}: BuildAskAgentInputForGitOperationParams): PromptInput[] | undefined {
  const details = toEnvironmentActionFailureDetails(error);
  if (!details) {
    return undefined;
  }

  switch (details.kind) {
    case "commit_failed":
      return [
        {
          type: "text",
          text: buildCommitFailureFollowUpInstruction({
            errorMessage: details.errorMessage,
          }),
          mentions: [],
        },
      ];
    case "squash_merge_conflict":
      if (!mergeBaseBranch) {
        return undefined;
      }
      return [
        {
          type: "text",
          text: buildSquashMergeConflictFollowUpInstruction(
            {
              action: "squash_merge",
              options: {
                mergeBaseBranch,
              },
            },
            { conflictFiles: details.conflictFiles },
          ),
          mentions: [],
        },
      ];
    case "squash_merge_commit_failed":
      if (!mergeBaseBranch) {
        return undefined;
      }
      return [
        {
          type: "text",
          text: buildSquashMergeCommitFailureFollowUpInstruction(
            {
              action: "squash_merge",
              options: {
                mergeBaseBranch,
              },
            },
            {
              stage: details.stage,
              errorMessage: details.errorMessage,
            },
          ),
          mentions: [],
        },
      ];
    default:
      return undefined;
  }
}

function toGitActionFailure({
  action,
  error,
  mergeBaseBranch,
}: ToGitActionFailureParams): GitActionFailure {
  const details = toEnvironmentActionFailureDetails(error);
  const detailsMessage = details
    ? getEnvironmentActionFailureDetailMessage(details)
    : undefined;

  return {
    message:
      detailsMessage ??
      getMutationErrorMessage({
        error,
        fallbackMessage: "Failed to start git action",
        lifecycleOperation: action,
      }),
    askAgentInput: buildAskAgentInputForGitOperation({
      error,
      mergeBaseBranch,
    }),
  };
}

function getGitActionSuccessTitle(action: GitActionKind): string {
  switch (action) {
    case "commit":
      return "Commit created";
    case "squash_merge":
      return "Squash merge completed";
    default:
      return action;
  }
}

function getGitActionLoadingTitle(action: GitActionKind): string {
  switch (action) {
    case "commit":
      return "Creating commit";
    case "squash_merge":
      return "Squash merging";
    default:
      return action;
  }
}

function getGitActionQueuedTitle(action: GitActionKind): string {
  switch (action) {
    case "commit":
      return "Commit queued";
    case "squash_merge":
      return "Squash merge queued";
    default:
      return action;
  }
}

function getGitActionErrorTitle(action: GitActionKind): string {
  switch (action) {
    case "commit":
      return "Commit failed";
    case "squash_merge":
      return "Squash merge failed";
    default:
      return action;
  }
}

function renderGitActionDescription(
  response: GitActionSuccessResponse,
): ReactNode {
  return createElement(AppToastCommitDescription, {
    commitSha: response.commitSha,
    commitSubject: response.commitSubject,
  });
}

function showGitActionSuccessToast({
  response,
  toastId,
}: ShowGitActionSuccessToastParams): void {
  appToast.success(getGitActionSuccessTitle(response.action), {
    id: toastId,
    description: renderGitActionDescription(response),
  });
}

function showGitActionErrorToast({
  action,
  error,
  mergeBaseBranch,
  onAskAgentToFix,
  threadId,
  toastId,
}: ShowGitActionErrorToastParams): void {
  const failure = toGitActionFailure({ action, error, mergeBaseBranch });
  const askAgentInput = failure.askAgentInput;
  const title = getGitActionErrorTitle(action);
  const description = failure.message === title ? undefined : failure.message;

  appToast.error(title, {
    id: toastId,
    ...(description ? { description } : {}),
    ...(askAgentInput
      ? {
          action: {
            label: "Ask agent to fix",
            onClick: () =>
              onAskAgentToFix({
                input: askAgentInput,
                threadId,
              }),
          },
        }
      : {}),
  });
}

export function useThreadGitActions({
  environment,
  requestEnvironmentAction,
  sendMessage,
  thread,
  workspaceStatus,
}: UseThreadGitActionsParams) {
  const threadGitActionDialog = useDialogState<ThreadGitActionDialogTarget>();
  const gitActionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const queuedGitActionCountRef = useRef(0);
  const workspaceWorkingTree = workspaceStatus?.workingTree;
  const workspaceMergeBase = workspaceStatus?.mergeBase;
  const isArchivedThread = thread?.archivedAt != null;
  const isDirectThreadEnvironment = environment?.managed === false;

  const threadHeaderGitActions = useMemo<ThreadHeaderGitAction[]>(() => {
    if (!thread || !workspaceStatus || isArchivedThread) {
      return [];
    }

    const actions: ThreadHeaderGitAction[] = [];

    const hasUncommitted = workspaceWorkingTree?.hasUncommittedChanges === true;
    const hasUnmerged =
      workspaceMergeBase?.hasCommittedUnmergedChanges === true;

    if (isDirectThreadEnvironment) {
      if (hasUncommitted) {
        actions.push({ target: { kind: "commit" }, label: "Commit" });
      }
      return actions;
    }

    if (environment?.managed) {
      if (hasUncommitted) {
        actions.push({ target: { kind: "commit" }, label: "Commit" });
      }
      if (hasUncommitted || hasUnmerged) {
        actions.push({
          target: { kind: "squash_merge" },
          label: "Squash merge",
        });
      }
    }

    return actions;
  }, [
    environment?.managed,
    isArchivedThread,
    isDirectThreadEnvironment,
    thread,
    workspaceMergeBase?.hasCommittedUnmergedChanges,
    workspaceStatus,
    workspaceWorkingTree?.hasUncommittedChanges,
  ]);

  const handleAskAgentToFixGitAction = useCallback(
    async ({ input, threadId }: AskAgentToFixGitActionParams) => {
      if (sendMessage.isPending) {
        return;
      }

      const toastId = appToast.loading("Sending message");

      try {
        await sendMessage.mutateAsync({
          id: threadId,
          input,
          mode: "queue-if-active",
        });
        appToast.success("Message sent", { id: toastId });
      } catch (error) {
        appToast.error("Failed to message agent", {
          id: toastId,
          description: getMutationErrorMessage({
            error,
            fallbackMessage: "Message was not sent",
            lifecycleOperation: "send_message",
          }),
        });
      }
    },
    [sendMessage],
  );

  const enqueueGitAction = useCallback(
    ({ action, run }: EnqueueGitActionParams): Promise<void> => {
      const isQueuedBehindGitAction = queuedGitActionCountRef.current > 0;
      queuedGitActionCountRef.current += 1;
      const toastId = appToast.loading(
        isQueuedBehindGitAction
          ? getGitActionQueuedTitle(action)
          : getGitActionLoadingTitle(action),
      );

      const runQueuedGitAction = async (): Promise<void> => {
        if (isQueuedBehindGitAction) {
          appToast.loading(getGitActionLoadingTitle(action), { id: toastId });
        }
        await run({ toastId });
      };

      const queuedAction = gitActionQueueRef.current.then(
        runQueuedGitAction,
        runQueuedGitAction,
      );
      gitActionQueueRef.current = queuedAction
        .catch(() => undefined)
        .finally(() => {
          queuedGitActionCountRef.current -= 1;
        });
      return queuedAction;
    },
    [],
  );

  const runCommitThread = useCallback(
    async ({ selectedPaths, toastId }: RunCommitThreadParams) => {
      const attachedEnvironmentId = thread?.environmentId;
      if (!thread || !attachedEnvironmentId) {
        appToast.dismiss(toastId);
        return;
      }
      const threadId = thread.id;

      try {
        const response = await requestEnvironmentAction.mutateAsync({
          id: attachedEnvironmentId,
          action: "commit",
          options: { paths: selectedPaths },
        });
        if (response.action !== "commit") {
          throw new Error("Expected commit action response.");
        }
        showGitActionSuccessToast({
          response,
          toastId,
        });
      } catch (nextError) {
        showGitActionErrorToast({
          action: "commit",
          error: nextError,
          onAskAgentToFix: (params) =>
            void handleAskAgentToFixGitAction(params),
          threadId,
          toastId,
        });
        // Rethrown so the commit dialog stays open on failure and can show the
        // refreshed file list next to the error.
        throw nextError;
      }
    },
    [handleAskAgentToFixGitAction, requestEnvironmentAction, thread],
  );

  const handleCommitThread = useCallback(
    async ({ selectedPaths }: CommitThreadParams) => {
      if (!thread?.environmentId) {
        return;
      }
      await enqueueGitAction({
        action: "commit",
        run: async ({ toastId }) => runCommitThread({ selectedPaths, toastId }),
      });
    },
    [enqueueGitAction, runCommitThread, thread?.environmentId],
  );

  const runSquashMergeThread = useCallback(
    async ({ mergeBaseBranch, toastId }: RunSquashMergeThreadParams) => {
      const attachedEnvironmentId = thread?.environmentId;
      if (!thread || !attachedEnvironmentId) {
        appToast.dismiss(toastId);
        return;
      }
      const threadId = thread.id;

      try {
        const response = await requestEnvironmentAction.mutateAsync({
          id: attachedEnvironmentId,
          action: "squash_merge",
          options: {
            mergeBaseBranch,
          },
        });
        if (response.action !== "squash_merge") {
          throw new Error("Expected squash merge action response.");
        }
        showGitActionSuccessToast({
          response,
          toastId,
        });
      } catch (nextError) {
        if (
          toEnvironmentActionFailureDetails(nextError)?.kind ===
          "squash_merge_dirty_worktree"
        ) {
          appToast.dismiss(toastId);
          threadGitActionDialog.onOpen({ kind: "commit" });
          return;
        }
        showGitActionErrorToast({
          action: "squash_merge",
          error: nextError,
          onAskAgentToFix: (params) =>
            void handleAskAgentToFixGitAction(params),
          mergeBaseBranch,
          threadId,
          toastId,
        });
      }
    },
    [
      handleAskAgentToFixGitAction,
      requestEnvironmentAction,
      thread,
      threadGitActionDialog,
    ],
  );

  const handleSquashMergeThread = useCallback(
    async ({ mergeBaseBranch }: SquashMergeThreadParams) => {
      if (!thread?.environmentId) {
        return;
      }
      await enqueueGitAction({
        action: "squash_merge",
        run: async ({ toastId }) =>
          runSquashMergeThread({ mergeBaseBranch, toastId }),
      });
    },
    [enqueueGitAction, runSquashMergeThread, thread?.environmentId],
  );

  return {
    handleAskAgentToFixGitAction,
    handleCommitThread,
    handleSquashMergeThread,
    threadGitActionDialog,
    threadHeaderGitActions,
  };
}
