import { assertNever } from "@bb/core-ui";
import type {
  EnvironmentActionFailureDetails,
  EnvironmentActionRequest,
} from "@bb/server-contract";
import { renderTemplate } from "@bb/templates";

/**
 * Squash merge never commits for you, so the only stage that can fail is the
 * squash commit itself. Sourced from the contract so a new stage is a type
 * error here rather than a silently unhandled prompt.
 */
type SquashMergeCommitFailureStage = Extract<
  EnvironmentActionFailureDetails,
  { kind: "squash_merge_commit_failed" }
>["stage"];

export function buildSquashMergeConflictFollowUpInstruction(
  request: Extract<EnvironmentActionRequest, { action: "squash_merge" }>,
  options?: {
    conflictFiles?: string[];
  },
): string {
  const conflictFiles =
    options?.conflictFiles?.filter((file) => file.trim().length > 0) ?? [];
  const mergeBaseBranch = request.options.mergeBaseBranch.trim();
  const conflictFilesText =
    conflictFiles.length > 0 ? conflictFiles.join(", ") : undefined;

  return renderTemplate("threadOperationSquashMergeConflictFollowUp", {
    mergeBaseBranch,
    conflictFiles: conflictFilesText,
  });
}

export function buildSquashMergeCommitFailureFollowUpInstruction(
  request: Extract<EnvironmentActionRequest, { action: "squash_merge" }>,
  options: {
    stage: SquashMergeCommitFailureStage;
    errorMessage?: string;
  },
): string {
  const mergeBaseBranch = request.options.mergeBaseBranch.trim();
  const errorMessage = options.errorMessage?.trim() || undefined;

  switch (options.stage) {
    case "squash_commit":
      return renderTemplate("threadOperationSquashMergeCommitFailureFollowUp", {
        squashCommitMergeBaseBranch: mergeBaseBranch,
        errorMessage,
      });
    default:
      return assertNever(options.stage);
  }
}

export function buildCommitFailureFollowUpInstruction(options?: {
  errorMessage?: string;
}): string {
  const errorMessage = options?.errorMessage?.trim() || undefined;

  return renderTemplate("threadOperationCommitFailureFollowUp", {
    errorMessage,
  });
}
