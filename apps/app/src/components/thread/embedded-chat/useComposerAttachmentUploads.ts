import { useCallback, useState } from "react";
import {
  isSupportedPromptAttachment,
  PROMPT_ATTACHMENT_FORMAT_SUMMARY,
} from "@bb/server-contract";
import { useUploadPromptAttachment } from "@/hooks/mutations/project-mutations";
import type { PromptDraftAttachment } from "@/lib/prompt-draft";
import type { InlineQueuedMessageEditState } from "./useInlineQueuedMessageEditing";

interface UseComposerAttachmentUploadsArgs {
  projectId: string;
  /** Appends an uploaded attachment to the bottom composer draft. */
  addDraftAttachment: (attachment: PromptDraftAttachment) => void;
  inlineEditingQueuedMessage: InlineQueuedMessageEditState | null;
  inlineEditingQueuedMessageRef: React.RefObject<InlineQueuedMessageEditState | null>;
  commitInlineQueuedMessage: (
    next: InlineQueuedMessageEditState | null,
  ) => void;
}

export interface UseComposerAttachmentUploadsResult {
  bottomAttachmentError: string | null;
  setBottomAttachmentError: (error: string | null) => void;
  handleAttachBottomFiles: (files: File[]) => Promise<void>;
  isAttachingBottomFiles: boolean;
  inlineAttachmentError: string | null;
  setInlineAttachmentError: (error: string | null) => void;
  handleAttachInlineFiles: (files: File[]) => Promise<void>;
  isAttachingInlineFiles: boolean;
}

interface AttachmentOperationState {
  error: string | null;
  pendingCount: number;
}

interface InlineAttachmentOperationState extends AttachmentOperationState {
  editSessionId: number | null;
}

interface AttachmentFileSelection {
  accepted: File[];
  rejectedNames: string[];
}

function selectSupportedFiles(files: readonly File[]): AttachmentFileSelection {
  const accepted: File[] = [];
  const rejectedNames: string[] = [];
  for (const file of files) {
    if (isSupportedPromptAttachment({ name: file.name, mimeType: file.type })) {
      accepted.push(file);
    } else {
      rejectedNames.push(file.name);
    }
  }
  return { accepted, rejectedNames };
}

function attachmentOperationError(
  rejectedNames: readonly string[],
  failedNames: readonly string[],
): string | null {
  const messages: string[] = [];
  if (rejectedNames.length > 0) {
    messages.push(
      `Unsupported attachment format: ${[...new Set(rejectedNames)].join(", ")}. Supported formats: ${PROMPT_ATTACHMENT_FORMAT_SUMMARY}.`,
    );
  }
  if (failedNames.length > 0) {
    messages.push(`Failed to attach: ${failedNames.join(", ")}`);
  }
  return messages.length > 0 ? messages.join(" ") : null;
}

/**
 * Uploads dropped/picked files for either independently mounted composer. The
 * inline owner is captured per invocation so a dismissed edit session cannot
 * receive a late upload.
 */
export function useComposerAttachmentUploads({
  projectId,
  addDraftAttachment,
  inlineEditingQueuedMessage,
  inlineEditingQueuedMessageRef,
  commitInlineQueuedMessage,
}: UseComposerAttachmentUploadsArgs): UseComposerAttachmentUploadsResult {
  const uploadPromptAttachment = useUploadPromptAttachment();
  const [bottomOperation, setBottomOperation] =
    useState<AttachmentOperationState>({ error: null, pendingCount: 0 });
  const [inlineOperation, setInlineOperation] =
    useState<InlineAttachmentOperationState>({
      editSessionId: null,
      error: null,
      pendingCount: 0,
    });

  const setBottomAttachmentError = useCallback((error: string | null) => {
    setBottomOperation((current) => ({ ...current, error }));
  }, []);
  const setInlineAttachmentError = useCallback(
    (error: string | null) => {
      const editSessionId = inlineEditingQueuedMessage?.editSessionId ?? null;
      setInlineOperation((current) => ({
        editSessionId,
        error,
        pendingCount:
          current.editSessionId === editSessionId ? current.pendingCount : 0,
      }));
    },
    [inlineEditingQueuedMessage?.editSessionId],
  );

  const handleAttachBottomFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const { accepted, rejectedNames } = selectSupportedFiles(files);
      if (accepted.length === 0) {
        setBottomOperation((current) => ({
          ...current,
          error: attachmentOperationError(rejectedNames, []),
        }));
        return;
      }
      setBottomOperation((current) => ({
        error: attachmentOperationError(rejectedNames, []),
        pendingCount: current.pendingCount + 1,
      }));
      const failedFiles: string[] = [];
      try {
        for (const file of accepted) {
          try {
            const uploaded = await uploadPromptAttachment.mutateAsync({
              projectId,
              file,
            });
            addDraftAttachment(uploaded);
          } catch {
            failedFiles.push(file.name);
          }
        }
      } finally {
        setBottomOperation((current) => ({
          error:
            attachmentOperationError(rejectedNames, failedFiles) ??
            current.error,
          pendingCount: Math.max(0, current.pendingCount - 1),
        }));
      }
    },
    [addDraftAttachment, projectId, uploadPromptAttachment],
  );
  const handleAttachInlineFiles = useCallback(
    async (files: File[]) => {
      if (!inlineEditingQueuedMessage || files.length === 0) return;
      const { accepted, rejectedNames } = selectSupportedFiles(files);
      if (accepted.length === 0) {
        setInlineOperation((current) => ({
          ...current,
          editSessionId: inlineEditingQueuedMessage.editSessionId,
          error: attachmentOperationError(rejectedNames, []),
        }));
        return;
      }
      const { editSessionId, ownerThreadId, queuedMessageId } =
        inlineEditingQueuedMessage;
      setInlineOperation((current) => ({
        editSessionId,
        error: attachmentOperationError(rejectedNames, []),
        pendingCount:
          current.editSessionId === editSessionId
            ? current.pendingCount + 1
            : 1,
      }));
      const failedFiles: string[] = [];
      try {
        for (const file of accepted) {
          try {
            const uploaded = await uploadPromptAttachment.mutateAsync({
              projectId,
              file,
            });
            const current = inlineEditingQueuedMessageRef.current;
            if (
              current?.editSessionId === editSessionId &&
              current.ownerThreadId === ownerThreadId &&
              current.queuedMessageId === queuedMessageId &&
              !current.draft.attachments.some(
                (existing) => existing.path === uploaded.path,
              )
            ) {
              commitInlineQueuedMessage({
                ...current,
                draft: {
                  ...current.draft,
                  attachments: [...current.draft.attachments, uploaded],
                },
              });
            }
          } catch {
            failedFiles.push(file.name);
          }
        }
      } finally {
        setInlineOperation((current) =>
          current.editSessionId === editSessionId
            ? {
                editSessionId,
                error:
                  inlineEditingQueuedMessageRef.current?.editSessionId ===
                  editSessionId
                    ? (attachmentOperationError(rejectedNames, failedFiles) ??
                      current.error)
                    : current.error,
                pendingCount: Math.max(0, current.pendingCount - 1),
              }
            : current,
        );
      }
    },
    [
      commitInlineQueuedMessage,
      inlineEditingQueuedMessage,
      inlineEditingQueuedMessageRef,
      projectId,
      uploadPromptAttachment,
    ],
  );

  const currentInlineEditSessionId =
    inlineEditingQueuedMessage?.editSessionId ?? null;
  const isCurrentInlineOperation =
    inlineOperation.editSessionId === currentInlineEditSessionId;

  return {
    bottomAttachmentError: bottomOperation.error,
    setBottomAttachmentError,
    handleAttachBottomFiles,
    isAttachingBottomFiles: bottomOperation.pendingCount > 0,
    inlineAttachmentError: isCurrentInlineOperation
      ? inlineOperation.error
      : null,
    setInlineAttachmentError,
    handleAttachInlineFiles,
    isAttachingInlineFiles:
      isCurrentInlineOperation && inlineOperation.pendingCount > 0,
  };
}
