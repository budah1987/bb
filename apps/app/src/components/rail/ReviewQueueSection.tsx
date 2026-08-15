import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ThreadListEntry } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useProjectThreadSubset,
  useThread,
} from "@/hooks/queries/thread-queries";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getThreadRoutePath } from "@/lib/route-paths";
import { RailRow } from "./RailRow";
import { RailSection } from "./RailSection";
import { RAIL_PROSE_CLASS } from "./railStyleTokens";

type ReviewQueueState = "needs-reply" | "failed" | "ready";

export interface ReviewQueueItem {
  id: string;
  projectId: string;
  state: ReviewQueueState;
  title: string;
  updatedAt: number;
}

function reviewState(thread: ThreadListEntry): ReviewQueueState | null {
  if (thread.hasPendingInteraction) return "needs-reply";
  if (thread.runtime.displayStatus === "error") return "failed";
  const hasUnreadOutput =
    thread.lastReadAt === null || thread.latestAttentionAt > thread.lastReadAt;
  if (thread.runtime.displayStatus === "idle" && hasUnreadOutput)
    return "ready";
  return null;
}

const REVIEW_PRIORITY: Readonly<Record<ReviewQueueState, number>> = {
  "needs-reply": 0,
  failed: 1,
  ready: 2,
};

export function selectReviewQueueItems(
  threads: readonly ThreadListEntry[],
): ReviewQueueItem[] {
  return threads
    .flatMap((thread) => {
      // Forks and side chats are user-created branches. They are not delegated
      // tasks that the parent conversation must review.
      if (thread.originKind !== null) return [];
      const state = reviewState(thread);
      if (state === null) return [];
      return [
        {
          id: thread.id,
          projectId: thread.projectId,
          state,
          title: getThreadDisplayTitle(thread),
          updatedAt: thread.updatedAt,
        },
      ];
    })
    .sort(
      (left, right) =>
        REVIEW_PRIORITY[left.state] - REVIEW_PRIORITY[right.state] ||
        right.updatedAt - left.updatedAt,
    );
}

const STATE_LABEL: Readonly<Record<ReviewQueueState, string>> = {
  "needs-reply": "Needs reply",
  failed: "Failed",
  ready: "Ready",
};

export function ReviewQueueSection({
  enabled = true,
  threadId,
}: {
  enabled?: boolean;
  threadId: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const navigate = useNavigate();
  const threadQuery = useThread(threadId, { enabled });
  const childThreadsQuery = useProjectThreadSubset({
    enabled: enabled && threadQuery.data !== undefined,
    filters: { parentThreadId: threadId },
    projectId: threadQuery.data?.projectId,
  });
  const items = useMemo(
    () => selectReviewQueueItems(childThreadsQuery.data ?? []),
    [childThreadsQuery.data],
  );
  const openItem = useCallback(
    (item: ReviewQueueItem) => {
      navigate(
        getThreadRoutePath({ projectId: item.projectId, threadId: item.id }),
      );
    },
    [navigate],
  );

  if (
    !enabled ||
    (!childThreadsQuery.isLoading &&
      !childThreadsQuery.isError &&
      items.length === 0)
  ) {
    return null;
  }

  return (
    <RailSection
      isExpanded={isExpanded}
      label="Review"
      onToggle={() => setIsExpanded((current) => !current)}
      trailing={
        items.length > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {items.length}
          </span>
        ) : null
      }
    >
      {childThreadsQuery.isError ? (
        <div
          role="alert"
          className={cn(
            RAIL_PROSE_CLASS,
            "flex items-center gap-2 py-1 text-destructive",
          )}
        >
          <span className="min-w-0 flex-1">Could not load review list.</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-10 shrink-0 px-2 text-xs transition-transform duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none"
            onClick={childThreadsQuery.retry}
          >
            Retry
          </Button>
        </div>
      ) : childThreadsQuery.isLoading ? (
        <p role="status" className={cn(RAIL_PROSE_CLASS, "py-1")}>
          Loading review list…
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1 py-1">
          {items.map((item) => (
            <RailRow
              key={item.id}
              icon={item.state === "failed" ? "CircleX" : "MessageSquare"}
              label={item.title}
              onSelect={() => openItem(item)}
              showsChevron
              trailing={
                <span
                  className={cn(
                    "shrink-0 text-xs",
                    item.state === "failed"
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {STATE_LABEL[item.state]}
                </span>
              }
            />
          ))}
          <div className="flex justify-end pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 text-xs transition-transform duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none"
              onClick={() => {
                const first = items[0];
                if (first) openItem(first);
              }}
            >
              Review next
            </Button>
          </div>
        </div>
      )}
    </RailSection>
  );
}
