import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { assertNever } from "@bb/core-ui";
import type { GitBranchRefClassification } from "@bb/domain";
import {
  DetailCard,
  DetailRow,
  DetailRowIconLabel,
} from "@/components/ui/detail-card.js";
import type { ThreadGitStatusDisplay } from "@/components/workspace/workspace-status";
import { CommitFileSelectionList } from "@/components/dialogs/CommitFileSelectionList";
import {
  formatWorkspaceChangedFilesLabel,
  type WorkspaceChangedFilesSection,
} from "@/components/workspace/workspace-change-summary";
import { Button } from "@bb/shared-ui/button";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { toEnvironmentActionFailureDetails } from "@/lib/environment-action-failures";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  getMergeBaseBranchCandidateGroups,
  BranchPicker,
} from "@/components/pickers/BranchPicker";

export type ThreadGitActionDialogTarget =
  | { kind: "commit" }
  | { kind: "squash_merge" };

export interface ThreadCommitRequest {
  selectedPaths: string[];
}

interface FooterMessage {
  text: string;
  tone: "error" | "status";
  spinner?: boolean;
}

const DIRTY_SQUASH_MERGE_DESCRIPTION =
  "Squash merge uses commits already on this branch. It never includes uncommitted changes.";
const DIRTY_SQUASH_MERGE_NOTICE = "This worktree has uncommitted changes.";
export const COMMIT_SELECTION_STALE_MESSAGE =
  "Files changed since you selected them. The list was refreshed.";
const EMPTY_SELECTION_MESSAGE = "Select at least one file";
const COMMIT_PENDING_MESSAGE = "Creating commit";
const DESELECTED_FILES_MESSAGE =
  "Deselected files stay changed in this worktree. Any staged files stay staged.";

interface ThreadGitActionDialogProps {
  target: ThreadGitActionDialogTarget | null;
  branchName?: string;
  /** Worktree directory name, shown so the commit target is unambiguous. */
  worktreeName?: string;
  worktreePath?: string;
  gitStatusDisplay?: ThreadGitStatusDisplay;
  changedFilesSection?: WorkspaceChangedFilesSection | null;
  hasUncommittedChanges?: boolean;
  showMergeBaseDetails?: boolean;
  mergeBaseBranch?: string;
  mergeBaseBranchRef?: GitBranchRefClassification | null;
  mergeBaseBranchOptions?: string[];
  mergeBaseRemoteBranchOptions?: readonly string[];
  mergeBaseBranchOptionsLoading?: boolean;
  onMergeBaseBranchChange?: (branch: string) => void;
  onMergeBaseBranchSearchQueryChange?: (query: string) => void;
  onOpenChange: (open: boolean) => void;
  /** Swaps the open dialog to another action, e.g. squash merge → commit. */
  onChangeTarget: (target: ThreadGitActionDialogTarget) => void;
  onCommit: (request: ThreadCommitRequest) => Promise<void>;
  onSquashMerge: (args: { mergeBaseBranch: string }) => Promise<void>;
}

function getDialogCopy(target: ThreadGitActionDialogTarget) {
  switch (target.kind) {
    case "commit":
      return {
        title: "Commit changes",
        description: "Create a commit from selected changes in this worktree.",
        showCommitControls: true,
        showMergeBase: false,
      };
    case "squash_merge":
      return {
        title: "Squash merge",
        description: "Squash merge this branch into the selected merge base.",
        showCommitControls: false,
        showMergeBase: true,
      };
    default:
      return assertNever(target);
  }
}

export function ThreadGitActionDialog({
  target,
  ...contentProps
}: ThreadGitActionDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={contentProps.onOpenChange}>
      <DialogContent className="max-w-[34rem] gap-0 overflow-hidden border-border bg-background p-0 shadow-sm">
        {target ? (
          <ThreadGitActionDialogContent
            key={target.kind}
            target={target}
            {...contentProps}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export type ThreadGitActionDialogContentProps = Omit<
  ThreadGitActionDialogProps,
  "target"
> & {
  target: ThreadGitActionDialogTarget;
};

export function ThreadGitActionDialogContent({
  target,
  branchName,
  worktreeName,
  worktreePath,
  gitStatusDisplay,
  changedFilesSection,
  hasUncommittedChanges = false,
  showMergeBaseDetails,
  mergeBaseBranch,
  mergeBaseBranchRef,
  mergeBaseBranchOptions,
  mergeBaseRemoteBranchOptions,
  mergeBaseBranchOptionsLoading,
  onMergeBaseBranchChange,
  onMergeBaseBranchSearchQueryChange,
  onOpenChange,
  onChangeTarget,
  onCommit,
  onSquashMerge,
}: ThreadGitActionDialogContentProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dialogCopy = getDialogCopy(target);
  const mergeBaseCandidateGroups = getMergeBaseBranchCandidateGroups({
    mergeBaseBranch,
    mergeBaseBranchRef,
    mergeBaseBranchOptions,
    remoteMergeBaseBranchOptions: mergeBaseRemoteBranchOptions,
  });
  const mergeBaseCandidates = mergeBaseCandidateGroups.options;
  const remoteMergeBaseCandidates = mergeBaseCandidateGroups.remoteOptions;
  const selectedMergeBaseBranch = mergeBaseBranch ?? mergeBaseCandidates[0];
  const selectedMergeBaseBranchRef =
    mergeBaseBranchRef?.name === selectedMergeBaseBranch
      ? mergeBaseBranchRef
      : null;
  const selectedMergeBaseBranchClassificationPending =
    dialogCopy.showMergeBase &&
    Boolean(selectedMergeBaseBranch) &&
    mergeBaseBranchRef === undefined;
  const remoteMergeBaseBranches = useMemo(
    () => new Set(remoteMergeBaseCandidates),
    [remoteMergeBaseCandidates],
  );
  const selectedMergeBaseBranchIsRemote = selectedMergeBaseBranch
    ? selectedMergeBaseBranchRef?.kind === "remote" ||
      (selectedMergeBaseBranchRef === null &&
        remoteMergeBaseBranches.has(selectedMergeBaseBranch))
    : false;
  const selectedMergeBaseBranchMissing =
    selectedMergeBaseBranchRef?.kind === "missing";
  const blocksRemoteMergeBase =
    dialogCopy.showMergeBase && selectedMergeBaseBranchIsRemote;
  const remoteMergeBaseErrorMessage =
    "Squash merge requires a local target branch.";
  const missingMergeBaseErrorMessage =
    "Squash merge requires an existing local target branch.";
  const checkingMergeBaseMessage = "Checking target branch";
  const canSelectMergeBase =
    dialogCopy.showMergeBase &&
    showMergeBaseDetails === true &&
    Boolean(onMergeBaseBranchChange) &&
    (mergeBaseCandidates.length > 0 || remoteMergeBaseCandidates.length > 0);
  const canShowMergeBase =
    dialogCopy.showMergeBase &&
    showMergeBaseDetails === true &&
    (canSelectMergeBase || Boolean(selectedMergeBaseBranch));
  const mergeBaseValidationErrorMessage = !selectedMergeBaseBranch
    ? "A merge base branch is required"
    : blocksRemoteMergeBase
      ? remoteMergeBaseErrorMessage
      : selectedMergeBaseBranchMissing
        ? missingMergeBaseErrorMessage
        : null;

  // Squash merge never commits for you: a dirty worktree blocks the action and
  // hands the user to the Commit dialog instead.
  const blocksDirtySquashMerge =
    target.kind === "squash_merge" && hasUncommittedChanges;

  const changedFiles = useMemo(
    () => changedFilesSection?.files ?? [],
    [changedFilesSection],
  );
  // Tracking the *deselected* paths keeps every file selected by default and
  // lets a background status refresh drop stale paths without losing intent.
  const [deselectedPaths, setDeselectedPaths] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [isCommitPending, setIsCommitPending] = useState(false);
  const [staleSelectionMessage, setStaleSelectionMessage] = useState<
    string | null
  >(null);
  const knownPathsRef = useRef(changedFiles.map((file) => file.path));

  useEffect(() => {
    const previousPaths = knownPathsRef.current;
    const nextPaths = changedFiles.map((file) => file.path);
    knownPathsRef.current = nextPaths;
    const nextPathSet = new Set(nextPaths);
    const droppedSelectedPath = previousPaths.some(
      (path) => !nextPathSet.has(path) && !deselectedPaths.has(path),
    );
    if (droppedSelectedPath) {
      setStaleSelectionMessage(COMMIT_SELECTION_STALE_MESSAGE);
    }
  }, [changedFiles, deselectedPaths]);

  const selectedPaths = useMemo(
    () =>
      changedFiles
        .map((file) => file.path)
        .filter((path) => !deselectedPaths.has(path)),
    [changedFiles, deselectedPaths],
  );
  const hasChangedFiles = changedFiles.length > 0;
  const blocksEmptyCommitSelection =
    dialogCopy.showCommitControls && selectedPaths.length === 0;

  const handleToggleFile = (path: string, selected: boolean) => {
    setErrorMessage(null);
    setDeselectedPaths((previous) => {
      const next = new Set(previous);
      if (selected) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleToggleAll = (selected: boolean) => {
    setErrorMessage(null);
    setDeselectedPaths(
      selected ? new Set<string>() : new Set(changedFiles.map((f) => f.path)),
    );
  };

  const submitLabel = dialogCopy.showCommitControls
    ? `Commit ${formatWorkspaceChangedFilesLabel(selectedPaths.length)}`
    : "Squash merge";

  const submitMergeBase = () => {
    if (selectedMergeBaseBranchClassificationPending) {
      return;
    }
    if (mergeBaseValidationErrorMessage || !selectedMergeBaseBranch) {
      setErrorMessage(
        mergeBaseValidationErrorMessage ?? "A merge base branch is required",
      );
      return;
    }
    onOpenChange(false);
    void onSquashMerge({ mergeBaseBranch: selectedMergeBaseBranch });
  };

  const submitCommit = async () => {
    if (selectedPaths.length === 0 || isCommitPending) {
      return;
    }
    setIsCommitPending(true);
    try {
      await onCommit({ selectedPaths });
      onOpenChange(false);
    } catch (error) {
      // The dialog stays open so the refreshed list keeps the user's still
      // valid selections instead of forcing them to start over.
      const isStaleSelection =
        toEnvironmentActionFailureDetails(error)?.kind ===
        "commit_selection_stale";
      setErrorMessage(
        isStaleSelection
          ? COMMIT_SELECTION_STALE_MESSAGE
          : getMutationErrorMessage({
              error,
              fallbackMessage: "Commit failed",
              lifecycleOperation: "commit",
            }),
      );
    } finally {
      setIsCommitPending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setStaleSelectionMessage(null);

    switch (target.kind) {
      case "commit":
        void submitCommit();
        break;
      case "squash_merge":
        submitMergeBase();
        break;
      default:
        assertNever(target);
    }
  };

  // One footer line, highest-priority state first. Errors are announced by
  // `role="alert"`; everything else is a polite status.
  const getFooterMessage = (): FooterMessage | null => {
    if (errorMessage) return { text: errorMessage, tone: "error" };
    if (blocksDirtySquashMerge)
      return { text: DIRTY_SQUASH_MERGE_NOTICE, tone: "error" };
    if (staleSelectionMessage)
      return { text: staleSelectionMessage, tone: "error" };
    if (isCommitPending)
      return { text: COMMIT_PENDING_MESSAGE, tone: "status", spinner: true };
    if (blocksEmptyCommitSelection && hasChangedFiles)
      return { text: EMPTY_SELECTION_MESSAGE, tone: "status" };
    if (blocksRemoteMergeBase)
      return { text: remoteMergeBaseErrorMessage, tone: "error" };
    if (selectedMergeBaseBranchMissing)
      return { text: missingMergeBaseErrorMessage, tone: "error" };
    if (selectedMergeBaseBranchClassificationPending)
      return { text: checkingMergeBaseMessage, tone: "status", spinner: true };
    return null;
  };
  const footerMessage = getFooterMessage();

  const isSubmitDisabled = dialogCopy.showCommitControls
    ? blocksEmptyCommitSelection || isCommitPending
    : selectedMergeBaseBranchClassificationPending ||
      mergeBaseValidationErrorMessage !== null;

  const showDetailCard =
    Boolean(worktreeName) ||
    Boolean(branchName) ||
    Boolean(gitStatusDisplay) ||
    canShowMergeBase;

  return (
    <>
      <DialogHeader className="px-6 pt-5 pb-3">
        <DialogTitle>{dialogCopy.title}</DialogTitle>
        <DialogDescription>
          {blocksDirtySquashMerge
            ? DIRTY_SQUASH_MERGE_DESCRIPTION
            : dialogCopy.description}
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-4 px-6 pt-1 pb-5" onSubmit={handleSubmit}>
        {showDetailCard ? (
          <DetailCard appearance="flat">
            {worktreeName ? (
              <DetailRow
                label={
                  <DetailRowIconLabel icon="Folder">
                    Worktree
                  </DetailRowIconLabel>
                }
                valueClassName="min-w-0 truncate"
              >
                <span
                  className="block truncate"
                  title={worktreePath ?? worktreeName}
                >
                  {worktreeName}
                </span>
              </DetailRow>
            ) : null}
            {branchName ? (
              <DetailRow
                label={
                  <DetailRowIconLabel icon="GitBranch">
                    Branch
                  </DetailRowIconLabel>
                }
                valueClassName="min-w-0 truncate"
              >
                <span className="block truncate" title={branchName}>
                  {branchName}
                </span>
              </DetailRow>
            ) : null}
            {gitStatusDisplay ? (
              <DetailRow
                label={
                  <DetailRowIconLabel icon="FileDiff">
                    Git status
                  </DetailRowIconLabel>
                }
                valueClassName="min-w-0"
              >
                <div
                  className="flex min-w-0 items-baseline gap-2 whitespace-nowrap"
                  title={`${gitStatusDisplay.label} ${gitStatusDisplay.summary}`.trim()}
                >
                  <span className="shrink-0 font-medium">
                    {gitStatusDisplay.label}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {gitStatusDisplay.summaryContent}
                  </span>
                </div>
              </DetailRow>
            ) : null}
            {canShowMergeBase && selectedMergeBaseBranch ? (
              <DetailRow
                label={
                  <DetailRowIconLabel icon="GitMerge">
                    Merge base
                  </DetailRowIconLabel>
                }
                valueClassName="min-w-0"
              >
                {canSelectMergeBase ? (
                  <BranchPicker
                    value={selectedMergeBaseBranch}
                    options={mergeBaseCandidates}
                    remoteOptions={remoteMergeBaseCandidates}
                    loading={mergeBaseBranchOptionsLoading}
                    onChange={(branch) => onMergeBaseBranchChange?.(branch)}
                    onSearchQueryChange={onMergeBaseBranchSearchQueryChange}
                    variant="minimal"
                    className="max-w-full"
                  />
                ) : (
                  <span
                    className="block truncate"
                    title={selectedMergeBaseBranch}
                  >
                    {selectedMergeBaseBranch}
                  </span>
                )}
              </DetailRow>
            ) : null}
          </DetailCard>
        ) : null}
        {dialogCopy.showCommitControls ? (
          hasChangedFiles ? (
            <div className="space-y-2">
              <CommitFileSelectionList
                files={changedFiles}
                deselectedPaths={deselectedPaths}
                disabled={isCommitPending}
                onToggleFile={handleToggleFile}
                onToggleAll={handleToggleAll}
                className="max-h-64"
              />
              {selectedPaths.length < changedFiles.length ? (
                <p className="m-0 text-xs leading-5 text-muted-foreground">
                  {DESELECTED_FILES_MESSAGE}
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState message="No changed files detected." />
          )
        ) : null}
        <DialogFooter className="flex-row flex-wrap items-center justify-end gap-x-2 gap-y-1 sm:space-x-0">
          {footerMessage ? (
            <p
              className={cn(
                "m-0 flex min-w-0 flex-1 items-center justify-end gap-1.5 text-right text-xs leading-5",
                footerMessage.tone === "error"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
              role={footerMessage.tone === "error" ? "alert" : "status"}
              aria-live={footerMessage.tone === "error" ? undefined : "polite"}
            >
              {footerMessage.spinner ? (
                <Icon
                  name="Spinner"
                  className="size-3.5 shrink-0 animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              <span className="min-w-0">{footerMessage.text}</span>
            </p>
          ) : null}
          {blocksDirtySquashMerge ? (
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              onClick={() => onChangeTarget({ kind: "commit" })}
            >
              Commit changes first
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              className="shrink-0"
              disabled={isSubmitDisabled}
            >
              {submitLabel}
            </Button>
          )}
        </DialogFooter>
      </form>
    </>
  );
}
