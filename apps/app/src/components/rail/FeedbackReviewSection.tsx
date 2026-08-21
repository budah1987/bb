import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { appToast } from "@/components/ui/app-toast";
import { SplitButton } from "@/components/ui/split-button";
import {
  useCreateThreadQueuedMessage,
  useSendThreadMessage,
} from "@/hooks/mutations/thread-runtime-mutations";
import { useThread, useThreads } from "@/hooks/queries/thread-queries";
import {
  type BrowserAnnotationDraft,
  useBrowserAnnotationPersistenceError,
  useThreadBrowserAnnotations,
} from "@/lib/browser-annotations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getProjectComposeRoutePath } from "@/lib/route-paths";
import { RailSection } from "./RailSection";
import { RAIL_BODY_TEXT_CLASS, RAIL_PROSE_CLASS } from "./railStyleTokens";

const MAX_ANNOTATIONS_PER_MESSAGE = 50;
const MAX_COMMENT_LENGTH_PER_MESSAGE = 2_000;

export function buildBrowserAnnotationMessage(
  annotations: readonly BrowserAnnotationDraft[],
  intent: "implement" | "review" = "implement",
): string {
  const included = annotations.slice(0, MAX_ANNOTATIONS_PER_MESSAGE);
  const lines = [
    intent === "review"
      ? "Review these browser annotations. Explain your proposed changes, then wait for confirmation."
      : "Please update the interface from these browser annotations.",
    intent === "review"
      ? "Do not change files yet."
      : "Preserve unrelated behavior. Verify each change in the browser.",
    "",
  ];

  included.forEach((annotation, index) => {
    const rectangle = annotation.rectangle;
    lines.push(
      `## ${index + 1}. ${annotation.comment.slice(0, MAX_COMMENT_LENGTH_PER_MESSAGE)}`,
      `- Page: ${annotation.url}`,
      `- Target: \`${annotation.selector.replaceAll("`", "\\`")}\``,
      `- Viewport: ${annotation.viewport.width} × ${annotation.viewport.height}`,
      `- Bounds: x ${Math.round(rectangle.x)}, y ${Math.round(rectangle.y)}, ${Math.round(rectangle.width)} × ${Math.round(rectangle.height)}`,
      "",
    );
  });

  if (annotations.length > included.length) {
    lines.push(
      `${annotations.length - included.length} more annotations remain in the review list.`,
    );
  }

  return lines.join("\n").trim();
}

type SendMode = "auto" | "now" | "queued" | "review";

export function browserAnnotationSelectionActionLabel(
  openCount: number,
  selectedCount: number,
): string {
  const selectableCount = Math.min(openCount, MAX_ANNOTATIONS_PER_MESSAGE);
  if (selectedCount === selectableCount) return "Clear selection";
  return openCount > MAX_ANNOTATIONS_PER_MESSAGE
    ? "Select first 50"
    : "Select all";
}

export function toggleBrowserAnnotationSelection(
  selectedIds: ReadonlySet<string>,
  draftId: string,
): ReadonlySet<string> {
  const next = new Set(selectedIds);
  if (next.has(draftId)) {
    next.delete(draftId);
  } else if (next.size < MAX_ANNOTATIONS_PER_MESSAGE) {
    next.add(draftId);
  }
  return next;
}

function pageLabel(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

export interface FeedbackReviewSectionProps {
  enabled?: boolean;
  threadId: string;
}

export function FeedbackReviewSection({
  enabled = true,
  threadId,
}: FeedbackReviewSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [chooseThreadOpen, setChooseThreadOpen] = useState(false);
  const [lastResolvedDraft, setLastResolvedDraft] =
    useState<BrowserAnnotationDraft | null>(null);
  const navigate = useNavigate();
  const annotations = useThreadBrowserAnnotations(threadId);
  const annotationPersistence = useBrowserAnnotationPersistenceError(threadId);
  const threadQuery = useThread(threadId, { enabled });
  const projectThreadsQuery = useThreads(
    { archived: false, projectId: threadQuery.data?.projectId ?? "" },
    { enabled: enabled && chooseThreadOpen && threadQuery.data !== undefined },
  );
  const sendMessage = useSendThreadMessage();
  const createQueuedMessage = useCreateThreadQueuedMessage();
  const openDrafts = useMemo(
    () => annotations.drafts.filter((draft) => draft.status === "open"),
    [annotations.drafts],
  );
  const [selectedIdsOverride, setSelectedIdsOverride] =
    useState<ReadonlySet<string> | null>(null);
  const selectedIds = useMemo(
    () =>
      selectedIdsOverride === null
        ? new Set(
            openDrafts
              .slice(0, MAX_ANNOTATIONS_PER_MESSAGE)
              .map((draft) => draft.id),
          )
        : new Set(
            [...selectedIdsOverride].filter((draftId) =>
              openDrafts.some((draft) => draft.id === draftId),
            ),
          ),
    [openDrafts, selectedIdsOverride],
  );

  const selectedDrafts = useMemo(
    () => openDrafts.filter((draft) => selectedIds.has(draft.id)),
    [openDrafts, selectedIds],
  );
  const selectableDraftCount = Math.min(
    openDrafts.length,
    MAX_ANNOTATIONS_PER_MESSAGE,
  );
  const hasFullSelection = selectedDrafts.length === selectableDraftCount;
  const isSending = sendMessage.isPending || createQueuedMessage.isPending;

  const toggleSelected = (draftId: string) => {
    setSelectedIdsOverride(() =>
      toggleBrowserAnnotationSelection(selectedIds, draftId),
    );
  };

  const send = async (mode: SendMode, targetThreadId = threadId) => {
    if (selectedDrafts.length === 0 || isSending) return;
    const includedDrafts = selectedDrafts.slice(0, MAX_ANNOTATIONS_PER_MESSAGE);
    const input = [
      {
        type: "text" as const,
        mentions: [],
        text: buildBrowserAnnotationMessage(
          includedDrafts,
          mode === "review" ? "review" : "implement",
        ),
      },
    ];
    const toastId = appToast.loading(
      mode === "queued" ? "Queueing annotations" : "Sending annotations",
    );
    try {
      if (mode === "queued") {
        await createQueuedMessage.mutateAsync({ id: targetThreadId, input });
      } else {
        await sendMessage.mutateAsync({
          id: targetThreadId,
          input,
          mode: mode === "now" ? "steer-if-active" : "queue-if-active",
          ...(targetThreadId === threadId ? {} : { senderThreadId: threadId }),
        });
      }
      const statusResults = await Promise.all(
        includedDrafts.map((draft) => annotations.markSentDraft(draft.id)),
      );
      const failedStatusCount = statusResults.filter(
        (wasSaved) => !wasSaved,
      ).length;
      setSelectedIdsOverride(null);
      setChooseThreadOpen(false);
      if (failedStatusCount > 0) {
        appToast.error("Annotations were sent, but some stayed open", {
          id: toastId,
          description: `${failedStatusCount} status ${failedStatusCount === 1 ? "update was" : "updates were"} not saved. Retry from Feedback.`,
        });
      } else {
        appToast.success(
          includedDrafts.length === 1
            ? "Annotation sent to agent"
            : `${includedDrafts.length} annotations sent to agent`,
          { id: toastId },
        );
      }
    } catch (error) {
      appToast.error("Annotations were not sent", {
        id: toastId,
        description: getMutationErrorMessage({
          error,
          fallbackMessage: "Try again.",
        }),
      });
    }
  };

  if (!enabled && annotations.drafts.length === 0) return null;
  if (annotations.drafts.length === 0) return null;

  return (
    <>
      <RailSection
        isExpanded={isExpanded}
        label="Feedback"
        onToggle={() => setIsExpanded((current) => !current)}
        trailing={
          openDrafts.length > 0 ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {openDrafts.length} open
            </span>
          ) : (
            <span className="shrink-0 text-xs text-success">Complete</span>
          )
        }
      >
        {annotationPersistence.error !== null ? (
          <div
            role="alert"
            className={cn(
              RAIL_BODY_TEXT_CLASS,
              "flex flex-wrap items-center gap-1 py-1 text-destructive",
            )}
          >
            <span className="min-w-0 flex-1">
              {annotationPersistence.errorCount > 1
                ? `${annotationPersistence.errorCount} feedback changes were not saved.`
                : annotationPersistence.error.operation === "create"
                  ? "Annotation was not saved."
                  : "Could not save feedback changes."}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-10 shrink-0 px-2 text-xs transition-transform duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none"
              onClick={annotationPersistence.retryAll}
            >
              Retry
            </Button>
            {annotationPersistence.error.operation === "create" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 shrink-0 px-2 text-xs transition-transform duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none"
                onClick={() => {
                  const failedDraft = annotations.drafts.find(
                    (draft) =>
                      draft.id === annotationPersistence.error?.draftId,
                  );
                  if (failedDraft === undefined) return;
                  void copyToClipboardWithToast(failedDraft.comment, {
                    successMessage: "Annotation copied",
                  });
                }}
              >
                Copy
              </Button>
            ) : null}
            <button
              type="button"
              aria-label="Dismiss save error"
              className="flex size-10 shrink-0 items-center justify-center rounded text-muted-foreground transition-[scale,color] duration-150 ease-out hover:text-foreground active:scale-[0.96] motion-reduce:transition-none"
              onClick={annotationPersistence.clear}
            >
              <Icon name="X" className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : null}
        {openDrafts.length === 0 ? (
          <p className={cn(RAIL_PROSE_CLASS, "py-1")}>No open feedback.</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-1.5 py-1">
            <div className="flex items-center justify-between gap-2 px-1">
              <button
                type="button"
                className="min-h-10 rounded px-1 text-xs text-muted-foreground underline-offset-2 transition-[scale,color] duration-150 ease-out hover:text-foreground hover:underline active:scale-[0.96] motion-reduce:transition-none"
                onClick={() =>
                  setSelectedIdsOverride(
                    hasFullSelection
                      ? new Set()
                      : new Set(
                          openDrafts
                            .slice(0, MAX_ANNOTATIONS_PER_MESSAGE)
                            .map((draft) => draft.id),
                        ),
                  )
                }
              >
                {browserAnnotationSelectionActionLabel(
                  openDrafts.length,
                  selectedDrafts.length,
                )}
              </button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {selectedDrafts.length} selected
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              {openDrafts.map((draft, index) => {
                const selected = selectedIds.has(draft.id);
                return (
                  <div
                    key={draft.id}
                    className={cn(
                      "group flex min-h-10 min-w-0 items-start gap-1 rounded-md px-1 py-1",
                      selected ? "bg-state-active" : "hover:bg-state-hover",
                    )}
                  >
                    <button
                      type="button"
                      aria-label={
                        !selected &&
                        selectedIds.size >= MAX_ANNOTATIONS_PER_MESSAGE
                          ? `Annotation ${index + 1} is outside the 50 item limit`
                          : `${selected ? "Exclude" : "Include"} annotation ${index + 1}`
                      }
                      aria-pressed={selected}
                      disabled={
                        !selected &&
                        selectedIds.size >= MAX_ANNOTATIONS_PER_MESSAGE
                      }
                      onClick={() => toggleSelected(draft.id)}
                      className="flex size-10 shrink-0 items-center justify-center rounded-md transition-transform duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
                    >
                      <span
                        className={cn(
                          "flex size-4 items-center justify-center rounded-full border text-xs tabular-nums",
                          selected
                            ? "border-foreground bg-foreground text-background"
                            : "border-border text-muted-foreground",
                        )}
                      >
                        {selected ? (
                          <Icon name="Check" className="size-2.5" />
                        ) : (
                          index + 1
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => annotations.selectDraft(draft.id)}
                      className="min-h-10 min-w-0 flex-1 rounded px-1 text-left"
                    >
                      <span
                        className={cn(
                          RAIL_BODY_TEXT_CLASS,
                          "line-clamp-2 text-foreground",
                        )}
                      >
                        {draft.comment}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {pageLabel(draft.url)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Resolve annotation ${index + 1}`}
                      onClick={() => {
                        void annotations
                          .resolveDraft(draft.id)
                          .then((saved) => {
                            if (saved) setLastResolvedDraft(draft);
                          });
                      }}
                      className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[scale,opacity,color] duration-150 ease-out hover:text-foreground active:scale-[0.96] focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
                    >
                      <Icon name="Check" className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete annotation ${index + 1}`}
                      onClick={() => {
                        annotations.removeDraft(draft.id);
                        if (lastResolvedDraft?.id === draft.id) {
                          setLastResolvedDraft(null);
                        }
                      }}
                      className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[scale,opacity,color] duration-150 ease-out hover:text-destructive active:scale-[0.96] focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
                    >
                      <Icon name="Trash2" className="size-3.5" aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end pt-1">
              <SplitButton
                disabled={selectedDrafts.length === 0 || isSending}
                className="h-10 text-xs transition-transform duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none"
                primaryAction={{
                  label: `Send ${selectedDrafts.length} to agent`,
                  onSelect: () => void send("auto"),
                }}
                secondaryActions={[
                  {
                    label: "Send now",
                    onSelect: () => void send("now"),
                  },
                  {
                    label: "Queue after current task",
                    onSelect: () => void send("queued"),
                  },
                  {
                    label: "Review and respond first",
                    onSelect: () => void send("review"),
                  },
                  {
                    groupLabel: "Destination",
                    label: "Send to another conversation…",
                    onSelect: () => setChooseThreadOpen(true),
                  },
                  {
                    groupLabel: "Destination",
                    label: "Start a new conversation…",
                    onSelect: () => {
                      const projectId = threadQuery.data?.projectId;
                      if (!projectId) return;
                      void navigate(getProjectComposeRoutePath(projectId), {
                        state: {
                          focusPrompt: true,
                          initialPrompt:
                            buildBrowserAnnotationMessage(selectedDrafts),
                        },
                      });
                    },
                  },
                ]}
                triggerLabel="Choose how to send annotations"
              />
            </div>
          </div>
        )}
        {lastResolvedDraft !== null ? (
          <div
            role="status"
            className="flex min-h-10 items-center gap-2 py-1 text-xs text-muted-foreground"
          >
            <span className="min-w-0 flex-1 truncate">
              Annotation resolved.
            </span>
            <button
              type="button"
              className="min-h-10 shrink-0 rounded px-2 font-medium text-foreground transition-[scale,background-color] duration-150 ease-out hover:bg-state-hover active:scale-[0.96] motion-reduce:transition-none"
              onClick={() => {
                annotations.reopenDraft(lastResolvedDraft.id);
                setLastResolvedDraft(null);
              }}
            >
              Undo
            </button>
          </div>
        ) : null}
      </RailSection>
      <Dialog open={chooseThreadOpen} onOpenChange={setChooseThreadOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>
              Choose the conversation that will receive these annotations.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto py-1">
            {projectThreadsQuery.isError ? (
              <div
                role="alert"
                className="flex items-center gap-2 px-2 py-2 text-sm text-destructive"
              >
                <span className="min-w-0 flex-1">
                  Could not load conversations.
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-10 shrink-0 px-2 text-xs transition-transform duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none"
                  onClick={() => void projectThreadsQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : projectThreadsQuery.isLoading ? (
              <p
                role="status"
                className="px-2 py-4 text-sm text-muted-foreground"
              >
                Loading conversations…
              </p>
            ) : (
              (projectThreadsQuery.data ?? [])
                .filter((thread) => thread.id !== threadId)
                .map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    disabled={isSending}
                    onClick={() => void send("auto", thread.id)}
                    className="flex min-h-10 w-full items-center gap-3 rounded-md px-2 text-left text-sm transition-[scale,background-color] duration-150 ease-out hover:bg-state-hover active:scale-[0.96] disabled:opacity-50 motion-reduce:transition-none"
                  >
                    <Icon
                      name="MessageSquare"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {getThreadDisplayTitle(thread)}
                    </span>
                  </button>
                ))
            )}
            {!projectThreadsQuery.isLoading &&
            !projectThreadsQuery.isError &&
            (projectThreadsQuery.data ?? []).filter(
              (thread) => thread.id !== threadId,
            ).length === 0 ? (
              <p className="px-2 py-4 text-sm text-muted-foreground">
                No other conversations are available.
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
