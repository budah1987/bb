import { useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

export const POST_MERGE_ARCHIVE_FAILURE_FALLBACK_MESSAGE =
  "Workspace was not archived";

export type PostMergeArchiveResult =
  | "archived"
  | "uncommitted_confirmation_required";

export interface PostMergeArchiveOptions {
  allowUncommittedChanges: boolean;
}

interface PostMergeArchiveDialogProps {
  open: boolean;
  /** Worktree directory name, so the archive scope is unambiguous. */
  worktreeName: string;
  /** `false` means keep the conversation: every dismissal gesture is safe. */
  onOpenChange: (open: boolean) => void;
  /** Checks current status, then archives or requests explicit dirty-work confirmation. */
  onArchive: (
    options: PostMergeArchiveOptions,
  ) => Promise<PostMergeArchiveResult>;
}

export function PostMergeArchiveDialog({
  open,
  worktreeName,
  onOpenChange,
  onArchive,
}: PostMergeArchiveDialogProps) {
  const [isArchiving, setIsArchiving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requiresUncommittedConfirmation, setRequiresUncommittedConfirmation] =
    useState(false);
  const keepButtonRef = useRef<HTMLButtonElement>(null);

  // Escape, the overlay, the X, and a drawer swipe all arrive here. A pending
  // archive owns the dialog until it settles, so none of them can close it.
  const handleOpenChange = (nextOpen: boolean) => {
    if (isArchiving && !nextOpen) return;
    if (!nextOpen) {
      setErrorMessage(null);
      setRequiresUncommittedConfirmation(false);
    }
    onOpenChange(nextOpen);
  };

  const handleArchive = async () => {
    if (isArchiving) return;
    setIsArchiving(true);
    setErrorMessage(null);
    try {
      const result = await onArchive({
        allowUncommittedChanges: requiresUncommittedConfirmation,
      });
      if (result === "uncommitted_confirmation_required") {
        setRequiresUncommittedConfirmation(true);
        return;
      }
      onOpenChange(false);
    } catch (error) {
      // The caller reports nothing: this line is the only failure signal.
      setErrorMessage(
        getMutationErrorMessage({
          error,
          fallbackMessage: POST_MERGE_ARCHIVE_FAILURE_FALLBACK_MESSAGE,
        }),
      );
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-[26rem]"
        onOpenAutoFocus={(event) => {
          // Focus the safe choice, never the destructive one.
          event.preventDefault();
          keepButtonRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (isArchiving) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isArchiving) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Pull request merged</DialogTitle>
          <DialogDescription>
            {`Archiving closes all conversations in this worktree (${worktreeName}) and schedules the worktree for cleanup.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row flex-wrap items-center justify-end gap-x-2 gap-y-1 sm:space-x-0">
          {errorMessage ? (
            <p
              className="m-0 flex min-w-0 flex-1 items-center justify-end text-right text-xs leading-5 text-destructive"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : requiresUncommittedConfirmation ? (
            <p
              className="m-0 flex min-w-0 flex-1 items-center justify-end text-right text-xs leading-5 text-destructive"
              role="alert"
            >
              “{worktreeName}” has uncommitted changes. Archiving removes them.
              Commit or copy them first, or archive the workspace anyway.
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 shrink-0 md:min-h-8"
            disabled={isArchiving}
            onClick={() => void handleArchive()}
          >
            {isArchiving ? (
              <>
                <Icon name="Spinner" className="animate-spin" />
                Archiving…
              </>
            ) : requiresUncommittedConfirmation ? (
              "Archive anyway"
            ) : (
              "Archive workspace"
            )}
          </Button>
          <Button
            ref={keepButtonRef}
            type="button"
            size="sm"
            className="min-h-11 shrink-0 md:min-h-8"
            disabled={isArchiving}
            onClick={() => handleOpenChange(false)}
          >
            Keep conversation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
