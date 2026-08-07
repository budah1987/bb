import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link } from "react-router-dom";
import type { ThreadListEntry } from "@bb/domain";
import { ThreadStatusGlyph } from "@/components/sidebar/ThreadRow";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import { Icon } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@bb/shared-ui/drawer";
import { formatRelativeTime } from "@/lib/relative-time";
import { getThreadRoutePath, isProjectlessProjectId } from "@/lib/route-paths";
import {
  getThreadListIndicatorLabel,
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
  isBusyThread,
  isRuntimeBusyThread,
  isUnreadDoneThread,
  resolveThreadListIndicator,
  type ThreadListIndicatorState,
} from "@/lib/thread-activity";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePromptDraftHasInput } from "@/hooks/usePromptDraftStorage";
import "./RootComposeMobileSessions.css";

export type MobileSessionFilter = "active" | "inactive" | "all";
export type MobileSessionGroupKind = "needs-you" | "running" | "inactive";

interface MobileSessionGroup {
  kind: MobileSessionGroupKind;
  label: string;
  threads: ThreadListEntry[];
}

interface MobileSessionRowProps {
  activeAncestor: boolean;
  groupKind: MobileSessionGroupKind;
  highlighted: boolean;
  now: number;
  onOpenActions: (thread: ThreadListEntry) => void;
  projectName: string | null;
  thread: ThreadListEntry;
}

export interface RootComposeMobileSessionsProps {
  highlightedThreadId: string | null;
  projectNamesById: ReadonlyMap<string, string>;
  showCreatingRow: boolean;
  threads: readonly ThreadListEntry[];
}

const NO_ACTIVE_MOBILE_SESSION_ANCESTORS: ReadonlySet<string> = new Set();

/**
 * Finds every parent session that still owns active descendant work. The
 * sidebar payload is flat, so walk parent links here instead of relying on the
 * parent's own runtime state, which may already be idle while a sub-agent runs.
 */
export function getActiveMobileSessionAncestorIds(
  threads: readonly ThreadListEntry[],
): ReadonlySet<string> {
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  const activeAncestorIds = new Set<string>();

  for (const thread of threads) {
    if (!isBusyThread(thread)) continue;

    const visitedIds = new Set([thread.id]);
    let parentThreadId = thread.parentThreadId;
    while (parentThreadId !== null && !visitedIds.has(parentThreadId)) {
      visitedIds.add(parentThreadId);
      const parent = threadsById.get(parentThreadId);
      if (parent === undefined) break;
      activeAncestorIds.add(parent.id);
      parentThreadId = parent.parentThreadId;
    }
  }

  return activeAncestorIds;
}

function compareMobileSessions(
  left: ThreadListEntry,
  right: ThreadListEntry,
): number {
  return (
    right.latestAttentionAt - left.latestAttentionAt ||
    right.createdAt - left.createdAt ||
    left.id.localeCompare(right.id)
  );
}

export function getMobileSessionGroupKind(
  thread: ThreadListEntry,
  activeAncestorIds: ReadonlySet<string> = NO_ACTIVE_MOBILE_SESSION_ANCESTORS,
): MobileSessionGroupKind {
  if (thread.hasPendingInteraction || isUnreadDoneThread(thread)) {
    return "needs-you";
  }
  if (isBusyThread(thread) || activeAncestorIds.has(thread.id))
    return "running";
  return "inactive";
}

export function buildMobileSessionGroups({
  filter,
  projectNamesById,
  query,
  threads,
}: {
  filter: MobileSessionFilter;
  projectNamesById: ReadonlyMap<string, string>;
  query: string;
  threads: readonly ThreadListEntry[];
}): MobileSessionGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const activeAncestorIds = getActiveMobileSessionAncestorIds(threads);
  const visibleThreads = threads
    .filter((thread) => {
      const group = getMobileSessionGroupKind(thread, activeAncestorIds);
      if (filter === "active" && group === "inactive") return false;
      if (filter === "inactive" && group !== "inactive") return false;
      if (normalizedQuery.length === 0) return true;

      const projectName = projectNamesById.get(thread.projectId) ?? "";
      return [
        getThreadDisplayTitle(thread),
        projectName,
        thread.environmentName ?? "",
        thread.environmentBranchName ?? "",
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    })
    .sort(compareMobileSessions);

  const groupDefinitions: Array<Pick<MobileSessionGroup, "kind" | "label">> = [
    { kind: "needs-you", label: "Needs you" },
    { kind: "running", label: "Running" },
    { kind: "inactive", label: "Inactive" },
  ];

  return groupDefinitions.flatMap((definition) => {
    const groupThreads = visibleThreads.filter(
      (thread) =>
        getMobileSessionGroupKind(thread, activeAncestorIds) ===
        definition.kind,
    );
    return groupThreads.length > 0
      ? [{ ...definition, threads: groupThreads }]
      : [];
  });
}

function getSessionStatusText(
  groupKind: MobileSessionGroupKind,
  indicatorState: ThreadListIndicatorState,
  thread: ThreadListEntry,
): string {
  if (groupKind === "needs-you") {
    return thread.hasPendingInteraction
      ? "Needs your response"
      : "Needs your attention";
  }

  const indicatorLabel = getThreadListIndicatorLabel(
    resolveThreadListIndicator(indicatorState),
  );
  if (groupKind === "running") return indicatorLabel ?? "Working";
  if (thread.status === "error") return "Failed";
  if (isUnreadDoneThread(thread)) return "Finished";
  return "Inactive";
}

const SESSION_LONG_PRESS_DELAY_MS = 500;
const SESSION_LONG_PRESS_MOVEMENT_PX = 10;

function MobileSessionActionsDrawer({
  onOpenChange,
  thread,
}: {
  onOpenChange: (open: boolean) => void;
  thread: ThreadListEntry | null;
}) {
  const { archiveThreadAndChildren, requestDelete, requestRename } =
    useThreadActions();

  const runAction = useCallback(
    (action: (target: ThreadListEntry) => void) => {
      if (thread === null) return;
      const target = thread;
      onOpenChange(false);
      window.setTimeout(() => action(target), 0);
    },
    [onOpenChange, thread],
  );

  return (
    <Drawer open={thread !== null} onOpenChange={onOpenChange}>
      <DrawerContent className="pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="min-w-0 px-4 pb-3 pt-2">
          <DrawerTitle className="truncate text-base font-medium leading-6">
            {thread === null ? "Thread actions" : getThreadDisplayTitle(thread)}
          </DrawerTitle>
          <DrawerDescription className="text-xs leading-5">
            Choose what to do with this conversation.
          </DrawerDescription>
        </div>
        <div className="grid gap-1 px-2">
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 justify-start gap-3 px-3 text-sm font-normal"
            onClick={() => runAction(requestRename)}
          >
            <Icon name="Edit" className="size-5" aria-hidden />
            Rename
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 justify-start gap-3 px-3 text-sm font-normal"
            onClick={() => runAction(archiveThreadAndChildren)}
          >
            <Icon name="Archive" className="size-5" aria-hidden />
            Archive
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 justify-start gap-3 px-3 text-sm font-normal text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => runAction(requestDelete)}
          >
            <Icon name="Trash2" className="size-5" aria-hidden />
            Delete
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function MobileSessionRow({
  activeAncestor,
  groupKind,
  highlighted,
  now,
  onOpenActions,
  projectName,
  thread,
}: MobileSessionRowProps) {
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const threadTitle = getThreadDisplayTitle(thread);
  const isUnreadDone = isUnreadDoneThread(thread);
  const isUnreadError = isUnreadDone && thread.status === "error";
  const hasUnsubmittedDraft = usePromptDraftHasInput({
    kind: "thread",
    projectId: thread.projectId,
    threadId: thread.id,
  });
  const indicatorState: ThreadListIndicatorState = {
    hasPendingInteraction: thread.hasPendingInteraction,
    hasUnsubmittedDraft,
    hasUnreadError: isUnreadError,
    hasUnreadSuccess: isUnreadDone && !isUnreadError,
    isBackgroundAgentActive: hasActiveBackgroundAgentActivity(thread),
    isBackgroundCommandActive: hasActiveBackgroundCommandActivity(thread),
    isGoalActive: hasActiveGoalActivity(thread),
    isPlanModeActive: hasActivePlanModeActivity(thread),
    isRuntimeActive: isRuntimeBusyThread(thread) || activeAncestor,
    isWorkflowActive: hasActiveWorkflowActivity(thread),
  };
  const statusText = getSessionStatusText(groupKind, indicatorState, thread);
  const relativeTime = formatRelativeTime({
    timestamp: thread.updatedAt,
    now,
  });
  const metadata = [statusText, projectName, relativeTime]
    .filter((value): value is string => value !== null)
    .join(" · ");

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    if (event.pointerType !== "touch" || event.button !== 0) return;
    cancelLongPress();
    longPressTriggeredRef.current = false;
    longPressOriginRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressOriginRef.current = null;
      longPressTriggeredRef.current = true;
      onOpenActions(thread);
    }, SESSION_LONG_PRESS_DELAY_MS);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const origin = longPressOriginRef.current;
    if (
      origin !== null &&
      Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >
        SESSION_LONG_PRESS_MOVEMENT_PX
    ) {
      cancelLongPress();
    }
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    cancelLongPress();
    longPressTriggeredRef.current = true;
    onOpenActions(thread);
  };

  return (
    <li>
      <Link
        to={getThreadRoutePath({
          projectId: thread.projectId,
          threadId: thread.id,
        })}
        aria-label={`Open ${threadTitle} — ${metadata}`}
        aria-description="Press and hold for thread actions"
        className={cn(
          "flex min-h-14 touch-pan-y select-none items-center gap-3 rounded-lg px-3 py-2 text-foreground/90 [-webkit-touch-callout:none] transition-[transform,background-color,color] duration-150 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          highlighted ? "bg-surface-selected" : "hover:bg-state-hover",
        )}
        onClickCapture={(event) => {
          if (!longPressTriggeredRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          longPressTriggeredRef.current = false;
        }}
        onContextMenu={handleContextMenu}
        onKeyDown={(event) => {
          if (
            event.key !== "ContextMenu" &&
            !(event.shiftKey && event.key === "F10")
          ) {
            return;
          }
          event.preventDefault();
          onOpenActions(thread);
        }}
        onPointerCancel={cancelLongPress}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={cancelLongPress}
      >
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block truncate text-sm font-medium">
            {threadTitle}
          </span>
          <span className="block truncate text-xs leading-4 text-muted-foreground">
            {metadata}
          </span>
        </span>
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-raised",
            groupKind === "needs-you" && "[&_svg]:!text-warning-text",
            groupKind === "running" && "[&_svg]:!text-success-foreground",
            groupKind === "inactive" &&
              thread.status === "error" &&
              "[&_svg]:!text-destructive",
          )}
        >
          {resolveThreadListIndicator(indicatorState) === "none" ? (
            <span className="size-1.5 rounded-full bg-muted-foreground/45" />
          ) : (
            <ThreadStatusGlyph {...indicatorState} />
          )}
        </span>
      </Link>
    </li>
  );
}

const FILTERS: Array<{ label: string; value: MobileSessionFilter }> = [
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" },
  { label: "All", value: "all" },
];

const CATEGORY_SWIPE_INTENT_PX = 12;
const CATEGORY_SWIPE_COMMIT_RATIO = 0.18;
const CATEGORY_SWIPE_MIN_COMMIT_PX = 52;
const CATEGORY_SWIPE_MAX_COMMIT_PX = 72;
const CATEGORY_SWIPE_MAX_TRAVEL_PX = 44;

interface CategorySwipeGesture {
  active: boolean;
  pointerId: number;
  startX: number;
  startY: number;
}

function getAdjacentFilter(
  filter: MobileSessionFilter,
  delta: -1 | 1,
): MobileSessionFilter | null {
  const index = FILTERS.findIndex((option) => option.value === filter);
  return FILTERS[index + delta]?.value ?? null;
}

export function RootComposeMobileSessions({
  highlightedThreadId,
  projectNamesById,
  showCreatingRow,
  threads,
}: RootComposeMobileSessionsProps) {
  const [filter, setFilter] = useState<MobileSessionFilter>("active");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [actionsThread, setActionsThread] = useState<ThreadListEntry | null>(
    null,
  );
  const [pageEntryDirection, setPageEntryDirection] = useState<
    "backward" | "forward" | null
  >(null);
  const [renderedAt] = useState(Date.now);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sessionPageRef = useRef<HTMLDivElement>(null);
  const categorySwipeRef = useRef<CategorySwipeGesture | null>(null);
  const suppressNextClickRef = useRef(false);
  const activeAncestorIds = useMemo(
    () => getActiveMobileSessionAncestorIds(threads),
    [threads],
  );
  const groups = useMemo(
    () =>
      buildMobileSessionGroups({ filter, projectNamesById, query, threads }),
    [filter, projectNamesById, query, threads],
  );
  const needsYouCount = threads.filter(
    (thread) =>
      getMobileSessionGroupKind(thread, activeAncestorIds) === "needs-you",
  ).length;
  const runningCount = threads.filter(
    (thread) =>
      getMobileSessionGroupKind(thread, activeAncestorIds) === "running",
  ).length;
  const activeCount = needsYouCount + runningCount;

  const openSearch = () => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const selectFilter = useCallback(
    (nextFilter: MobileSessionFilter) => {
      if (nextFilter === filter) return;
      const currentIndex = FILTERS.findIndex(
        (option) => option.value === filter,
      );
      const nextIndex = FILTERS.findIndex(
        (option) => option.value === nextFilter,
      );
      setPageEntryDirection(nextIndex > currentIndex ? "forward" : "backward");
      setFilter(nextFilter);
    },
    [filter],
  );

  const resetCategorySwipe = useCallback((animate: boolean) => {
    const page = sessionPageRef.current;
    categorySwipeRef.current = null;
    if (page === null) return;
    page.toggleAttribute("data-settling", animate);
    page.removeAttribute("data-dragging");
    page.style.removeProperty("--mobile-session-page-drag-x");
  }, []);

  const handleCategoryPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.pointerType !== "touch" || event.button !== 0) return;
    resetCategorySwipe(false);
    suppressNextClickRef.current = false;
    categorySwipeRef.current = {
      active: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const handleCategoryPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const gesture = categorySwipeRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const absoluteX = Math.abs(deltaX);
    const absoluteY = Math.abs(deltaY);

    if (!gesture.active) {
      if (
        absoluteY > CATEGORY_SWIPE_INTENT_PX &&
        absoluteY > absoluteX * 1.15
      ) {
        resetCategorySwipe(false);
        return;
      }
      if (
        absoluteX < CATEGORY_SWIPE_INTENT_PX ||
        absoluteX <= absoluteY * 1.25
      ) {
        return;
      }
      gesture.active = true;
      suppressNextClickRef.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      sessionPageRef.current?.setAttribute("data-dragging", "");
    }

    event.preventDefault();
    const adjacentFilter = getAdjacentFilter(filter, deltaX < 0 ? 1 : -1);
    const resistance = adjacentFilter === null ? 0.18 : 1;
    const travel = Math.max(
      -CATEGORY_SWIPE_MAX_TRAVEL_PX,
      Math.min(CATEGORY_SWIPE_MAX_TRAVEL_PX, deltaX * resistance),
    );
    sessionPageRef.current?.style.setProperty(
      "--mobile-session-page-drag-x",
      `${travel}px`,
    );
  };

  const handleCategoryPointerEnd = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const gesture = categorySwipeRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    if (!gesture.active) {
      resetCategorySwipe(false);
      return;
    }

    const deltaX = event.clientX - gesture.startX;
    const pageWidth = event.currentTarget.getBoundingClientRect().width;
    const commitDistance = Math.min(
      CATEGORY_SWIPE_MAX_COMMIT_PX,
      Math.max(
        CATEGORY_SWIPE_MIN_COMMIT_PX,
        pageWidth * CATEGORY_SWIPE_COMMIT_RATIO,
      ),
    );
    const adjacentFilter = getAdjacentFilter(filter, deltaX < 0 ? 1 : -1);
    if (Math.abs(deltaX) >= commitDistance && adjacentFilter !== null) {
      resetCategorySwipe(false);
      selectFilter(adjacentFilter);
      return;
    }
    resetCategorySwipe(true);
  };

  return (
    <section
      data-root-compose-mobile-sessions=""
      aria-labelledby="root-compose-mobile-sessions"
      className="hidden flex-col gap-3 max-md:flex pointer-coarse:flex"
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 id="root-compose-mobile-sessions" className="text-sm font-medium">
            Sessions
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {runningCount} running · {needsYouCount} need you
          </p>
        </div>
        <button
          type="button"
          aria-label="Search sessions"
          aria-expanded={searchOpen}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() =>
            searchOpen ? searchInputRef.current?.focus() : openSearch()
          }
        >
          <Icon name="Search" className="size-4" aria-hidden />
        </button>
      </div>

      {searchOpen ? (
        <div className="relative">
          <Icon
            name="Search"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            aria-label="Search sessions"
            placeholder="Search sessions"
            className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-9 text-sm outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            aria-label="Close session search"
            className="absolute right-0 top-0 flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              setQuery("");
              setSearchOpen(false);
            }}
          >
            <Icon name="X" className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label="Session filter"
        data-active-tab={filter}
        className="mobile-session-tabs relative grid grid-cols-3 gap-1 rounded-lg bg-surface-raised p-1"
      >
        <span
          aria-hidden
          className="mobile-session-tabs__pill pointer-events-none absolute bottom-1 left-1 top-1 rounded-md border border-border-hairline bg-background shadow-sm"
        />
        {FILTERS.map((option) => {
          const count =
            option.value === "active"
              ? activeCount
              : option.value === "inactive"
                ? threads.length - activeCount
                : threads.length;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              aria-label={`${option.label} (${count})`}
              tabIndex={filter === option.value ? 0 : -1}
              className={cn(
                "relative z-10 flex min-h-10 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-[color,transform] duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === option.value
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => selectFilter(option.value)}
              onKeyDown={(event) => {
                const currentIndex = FILTERS.findIndex(
                  (item) => item.value === filter,
                );
                const nextIndex =
                  event.key === "ArrowRight"
                    ? Math.min(FILTERS.length - 1, currentIndex + 1)
                    : event.key === "ArrowLeft"
                      ? Math.max(0, currentIndex - 1)
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? FILTERS.length - 1
                          : null;
                if (nextIndex === null || nextIndex === currentIndex) return;
                event.preventDefault();
                const tabList = event.currentTarget.parentElement;
                selectFilter(FILTERS[nextIndex].value);
                window.requestAnimationFrame(() => {
                  const selectedTab = tabList?.querySelector<HTMLElement>(
                    '[role="tab"][aria-selected="true"]',
                  );
                  selectedTab?.focus();
                });
              }}
            >
              {option.label}
              <span className="tabular-nums text-[0.6875rem] opacity-70">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        key={filter}
        ref={sessionPageRef}
        data-no-workspace-swipe=""
        data-entry={pageEntryDirection ?? undefined}
        className="mobile-session-page touch-pan-y"
        onClickCapture={(event) => {
          if (!suppressNextClickRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressNextClickRef.current = false;
        }}
        onPointerCancel={() => resetCategorySwipe(true)}
        onPointerDown={handleCategoryPointerDown}
        onPointerMove={handleCategoryPointerMove}
        onPointerUp={handleCategoryPointerEnd}
        onTransitionEnd={(event) => {
          if (event.propertyName === "transform") {
            event.currentTarget.removeAttribute("data-settling");
          }
        }}
      >
        {showCreatingRow ? (
          <div
            role="status"
            className="flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground"
          >
            <span className="min-w-0 flex-1 truncate">
              Starting conversation
            </span>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-success-foreground">
              <Icon
                name="Loading"
                className="size-4 animate-spin"
                aria-hidden
              />
            </span>
          </div>
        ) : null}

        {groups.length > 0 ? (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.kind} className="space-y-1">
                <div className="flex items-center justify-between px-3">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {group.label}
                  </h3>
                  <span className="text-xs tabular-nums text-subtle-foreground">
                    {group.threads.length}
                  </span>
                </div>
                <ul className="space-y-px">
                  {group.threads.map((thread) => (
                    <MobileSessionRow
                      key={thread.id}
                      activeAncestor={activeAncestorIds.has(thread.id)}
                      groupKind={group.kind}
                      highlighted={thread.id === highlightedThreadId}
                      now={renderedAt}
                      onOpenActions={setActionsThread}
                      projectName={
                        isProjectlessProjectId(thread.projectId)
                          ? null
                          : (projectNamesById.get(thread.projectId) ?? null)
                      }
                      thread={thread}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-28 flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="text-sm text-foreground/85">
              {query.trim() ? "No matching sessions" : "No sessions here"}
            </p>
            <p className="text-xs text-muted-foreground">
              {filter === "active"
                ? "Running conversations and anything waiting for you appear here."
                : "Try another filter or start a new conversation."}
            </p>
          </div>
        )}
      </div>
      <MobileSessionActionsDrawer
        thread={actionsThread}
        onOpenChange={(open) => {
          if (!open) setActionsThread(null);
        }}
      />
    </section>
  );
}
