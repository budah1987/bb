import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import type { ThreadListEntry } from "@bb/domain";
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
import { isBusyThread, isUnreadDoneThread } from "@/lib/thread-activity";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getThreadReadToggleAction } from "@/components/sidebar/threadReadState";
import { cn } from "@bb/shared-ui/lib/utils";
import "./RootComposeMobileSessions.css";

export type MobileSessionFilter = "active" | "inactive" | "all";
export type MobileSessionGroupKind =
  | "waiting"
  | "working"
  | "ready"
  | "failed"
  | "awaiting-reply"
  | "passive";

interface MobileSessionGroup {
  kind: MobileSessionGroupKind;
  label: string;
  threads: ThreadListEntry[];
}

interface MobileSessionRowProps {
  conversationCount?: number;
  displayTitle?: string;
  groupKind: MobileSessionGroupKind;
  highlighted: boolean;
  now: number;
  onOpenActions: (thread: ThreadListEntry) => void;
  priority: boolean;
  projectName: string | null;
  showMetadata?: boolean;
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
  if (thread.hasPendingInteraction) return "waiting";
  if (isUnreadDoneThread(thread))
    return thread.status === "error" ? "failed" : "ready";
  if (isBusyThread(thread) || activeAncestorIds.has(thread.id))
    return "working";
  if (isAwaitingReplyThread(thread)) return "awaiting-reply";
  return "passive";
}

export function isAwaitingReplyThread(thread: ThreadListEntry): boolean {
  return (
    thread.status === "idle" &&
    !thread.hasPendingInteraction &&
    !isBusyThread(thread) &&
    thread.lastReadAt !== null &&
    thread.lastReadAt > thread.latestAttentionAt
  );
}

function getMobileWorkspaceGroupKind(
  threads: readonly ThreadListEntry[],
  activeAncestorIds: ReadonlySet<string>,
): MobileSessionGroupKind {
  const signals = new Set(
    threads.map((thread) =>
      getMobileSessionGroupKind(thread, activeAncestorIds),
    ),
  );
  for (const signal of [
    "failed",
    "waiting",
    "working",
    "ready",
    "awaiting-reply",
  ] as const) {
    if (signals.has(signal)) return signal;
  }
  return "passive";
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
  const focusedEnvironmentIds = new Set(
    threads.flatMap((thread) =>
      thread.pinnedAt !== null && thread.environmentId !== null
        ? [thread.environmentId]
        : [],
    ),
  );
  const activeAncestorIds = getActiveMobileSessionAncestorIds(threads);
  const visibleThreads = threads
    .filter((thread) => {
      const group = getMobileSessionGroupKind(thread, activeAncestorIds);
      if (
        thread.pinnedAt !== null ||
        (thread.environmentId !== null &&
          focusedEnvironmentIds.has(thread.environmentId))
      ) {
        return false;
      }
      if (group === "awaiting-reply") return false;
      if (filter === "active" && group === "passive") return false;
      if (filter === "inactive" && group !== "passive") return false;
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
    { kind: "waiting", label: "Waiting" },
    { kind: "failed", label: "Failed" },
    { kind: "working", label: "Working" },
    { kind: "ready", label: "Ready" },
    { kind: "passive", label: "Inactive" },
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

function getSessionStatusText(groupKind: MobileSessionGroupKind): string {
  if (groupKind === "waiting") return "Waiting";
  if (groupKind === "failed") return "Failed";
  if (groupKind === "ready") return "Ready";
  if (groupKind === "working") return "Working";
  if (groupKind === "awaiting-reply") return "Awaiting Reply";
  return "";
}

const PIXEL_CELLS = Array.from({ length: 25 }, (_, index) => index);

function ActivityPixelMatrix({
  label,
  signal,
  priority,
}: {
  label: string | null;
  signal: MobileSessionGroupKind;
  priority: boolean;
}) {
  return (
    <span
      className={cn(
        "mobile-activity-matrix",
        `mobile-activity-matrix--${signal}`,
        priority && "mobile-activity-matrix--priority",
      )}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
    >
      {PIXEL_CELLS.map((index) => (
        <span
          key={index}
          className="mobile-activity-pixel"
          style={
            {
              "--pixel-phase": (index % 5) + Math.floor(index / 5),
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
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
  const {
    archiveThreadAndChildren,
    requestDelete,
    requestRename,
    togglePin,
    toggleRead,
  } = useThreadActions();
  const readAction = thread ? getThreadReadToggleAction(thread) : "mark_read";

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
            onClick={() => runAction(togglePin)}
          >
            <Icon
              name={thread?.pinnedAt === null ? "Pin" : "PinOff"}
              className="size-5"
              aria-hidden
            />
            {thread?.pinnedAt === null ? "Add to Focus" : "Remove from Focus"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 justify-start gap-3 px-3 text-sm font-normal"
            onClick={() => runAction(toggleRead)}
          >
            <Icon
              name={readAction === "mark_read" ? "MailOpen" : "Mail"}
              className="size-5"
              aria-hidden
            />
            {readAction === "mark_read" ? "Mark as read" : "Mark as unread"}
          </Button>
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
  conversationCount = 1,
  displayTitle,
  groupKind,
  highlighted,
  now,
  onOpenActions,
  priority,
  projectName,
  showMetadata = true,
  thread,
}: MobileSessionRowProps) {
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const threadTitle = displayTitle ?? getThreadDisplayTitle(thread);
  const statusText = getSessionStatusText(groupKind);
  const relativeTime = formatRelativeTime({
    timestamp: thread.updatedAt,
    now,
  });
  const metadata = [
    projectName,
    thread.environmentBranchName ?? thread.environmentName,
    conversationCount > 1 ? `${conversationCount} conversations` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");
  const visibleStatus =
    groupKind === "passive" || groupKind === "awaiting-reply"
      ? relativeTime
      : statusText;

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
        aria-label={`Open ${threadTitle} — ${visibleStatus}${metadata ? `, ${metadata}` : ""}`}
        aria-description="Press and hold for conversation actions"
        className={cn(
          "grid touch-pan-y select-none grid-cols-[auto_minmax(0,1fr)_auto] items-center rounded-lg text-foreground/90 [-webkit-touch-callout:none] transition-[transform,background-color,color] duration-150 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          priority
            ? "min-h-16 gap-x-3 px-3 py-3"
            : "min-h-14 gap-x-2.5 px-3 py-2",
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
        <ActivityPixelMatrix
          signal={groupKind}
          priority={priority}
          label={groupKind === "passive" ? null : statusText}
        />
        <span className={cn("min-w-0", priority ? "space-y-1" : "space-y-0.5")}>
          <span
            className={cn(
              "block truncate font-medium",
              priority ? "text-base" : "text-sm",
            )}
          >
            {threadTitle}
          </span>
          {showMetadata && metadata ? (
            <span className="block truncate text-xs leading-4 text-muted-foreground">
              {metadata}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "shrink-0 whitespace-nowrap text-right font-medium tabular-nums",
            "text-xs",
            groupKind === "working" && "text-primary",
            groupKind === "ready" && "text-success",
            groupKind === "waiting" && "text-warning-text",
            groupKind === "failed" && "text-destructive",
            groupKind === "awaiting-reply" &&
              "text-[color:var(--mobile-awaiting-reply)]",
            groupKind === "passive" && "text-subtle-foreground",
          )}
        >
          {visibleStatus}
        </span>
      </Link>
    </li>
  );
}

const FILTERS: Array<{ label: string; value: MobileSessionFilter }> = [
  { label: "Focus", value: "all" },
  { label: "Active", value: "active" },
  { label: "Recall", value: "inactive" },
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

function MobilePrioritySection({
  children,
  contentId,
  initiallyExpanded = true,
  label,
}: {
  children: ReactNode;
  contentId: string;
  initiallyExpanded?: boolean;
  label: string;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);

  return (
    <section className="mobile-priority-section" aria-label={label}>
      <button
        type="button"
        className="mobile-priority-section__toggle"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>{label}</span>
        <Icon
          name="ChevronDown"
          className="mobile-priority-section__chevron size-3.5"
          aria-hidden
        />
      </button>
      <div
        id={contentId}
        className="mobile-priority-section__content"
        data-collapsed={!expanded || undefined}
      >
        <div className="mobile-priority-section__content-inner">{children}</div>
      </div>
    </section>
  );
}

interface MobileWorkspaceSummary {
  groupKind: MobileSessionGroupKind;
  key: string;
  thread: ThreadListEntry;
  threads: readonly ThreadListEntry[];
}

function buildMobileWorkspaceSummaries(
  threads: readonly ThreadListEntry[],
  activeAncestorIds: ReadonlySet<string>,
): MobileWorkspaceSummary[] {
  const grouped = new Map<string, ThreadListEntry[]>();
  for (const thread of [...threads].sort(compareMobileSessions)) {
    const key = thread.environmentId ?? `thread:${thread.id}`;
    const current = grouped.get(key);
    if (current) current.push(thread);
    else grouped.set(key, [thread]);
  }
  return [...grouped.entries()]
    .map(([key, workspaceThreads]) => ({
      groupKind: getMobileWorkspaceGroupKind(
        workspaceThreads,
        activeAncestorIds,
      ),
      key,
      thread: workspaceThreads[0],
      threads: workspaceThreads,
    }))
    .sort((left, right) => compareMobileSessions(left.thread, right.thread));
}

function matchesWorkspaceQuery(
  workspace: MobileWorkspaceSummary,
  projectNamesById: ReadonlyMap<string, string>,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return workspace.threads.some((thread) =>
    [
      getThreadDisplayTitle(thread),
      projectNamesById.get(thread.projectId) ?? "",
      thread.environmentName ?? "",
      thread.environmentBranchName ?? "",
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
  );
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
  const workspaces = useMemo(
    () =>
      buildMobileWorkspaceSummaries(threads, activeAncestorIds).filter(
        (workspace) =>
          matchesWorkspaceQuery(workspace, projectNamesById, query),
      ),
    [activeAncestorIds, projectNamesById, query, threads],
  );
  const isFocusedWorkspace = (workspace: MobileWorkspaceSummary) =>
    workspace.threads.some((thread) => thread.pinnedAt !== null);
  const attentionWorkspaces = workspaces.filter((workspace) =>
    ["waiting", "failed", "ready", "awaiting-reply"].includes(
      workspace.groupKind,
    ),
  );
  const focusedWorkspaces = workspaces.filter(isFocusedWorkspace);
  const activeWorkspaces = workspaces.filter(
    (workspace) =>
      !isFocusedWorkspace(workspace) && workspace.groupKind === "working",
  );
  const recallWorkspaces = workspaces.filter(
    (workspace) =>
      !isFocusedWorkspace(workspace) && workspace.groupKind === "passive",
  );
  const visibleWorkspaces =
    filter === "all"
      ? focusedWorkspaces
      : filter === "active"
        ? activeWorkspaces
        : recallWorkspaces;

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
      aria-label="Command Center"
      className="hidden flex-col gap-3 max-md:flex pointer-coarse:flex"
    >
      <div className="flex items-center justify-end px-1">
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

      {attentionWorkspaces.length > 0 ? (
        <MobilePrioritySection
          contentId="mobile-attention-rows"
          initiallyExpanded={attentionWorkspaces.length <= 4}
          label="Attention"
        >
          <ul className="space-y-px">
            {attentionWorkspaces.map((workspace) => (
              <MobileSessionRow
                key={workspace.key}
                conversationCount={workspace.threads.length}
                displayTitle={
                  workspace.thread.environmentName ??
                  workspace.thread.environmentBranchName ??
                  undefined
                }
                groupKind={workspace.groupKind}
                highlighted={workspace.threads.some(
                  (thread) => thread.id === highlightedThreadId,
                )}
                now={renderedAt}
                onOpenActions={setActionsThread}
                priority
                projectName={
                  isProjectlessProjectId(workspace.thread.projectId)
                    ? null
                    : (projectNamesById.get(workspace.thread.projectId) ?? null)
                }
                thread={workspace.thread}
              />
            ))}
          </ul>
        </MobilePrioritySection>
      ) : null}

      <div
        role="tablist"
        aria-label="Workspace view"
        data-active-tab={filter}
        className="mobile-session-tabs relative grid grid-cols-3 border-b border-border-hairline"
      >
        <span
          aria-hidden
          className="mobile-session-tabs__pill pointer-events-none absolute -bottom-px left-0 h-0.5 bg-foreground"
        />
        {FILTERS.map((option) => {
          const count =
            option.value === "all"
              ? focusedWorkspaces.length
              : option.value === "active"
                ? activeWorkspaces.length
                : recallWorkspaces.length;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              aria-label={`${option.label} (${count})`}
              tabIndex={filter === option.value ? 0 : -1}
              className={cn(
                "relative z-10 flex min-h-11 items-center justify-center gap-1.5 px-2 text-xs font-medium transition-[color,transform] duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
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
            <ActivityPixelMatrix
              signal="working"
              priority={false}
              label="Starting conversation"
            />
          </div>
        ) : null}

        {visibleWorkspaces.length > 0 ? (
          <ul className="space-y-px">
            {visibleWorkspaces.map((workspace) => (
              <MobileSessionRow
                key={workspace.key}
                conversationCount={workspace.threads.length}
                displayTitle={
                  workspace.thread.environmentName ??
                  workspace.thread.environmentBranchName ??
                  undefined
                }
                groupKind={workspace.groupKind}
                highlighted={workspace.threads.some(
                  (thread) => thread.id === highlightedThreadId,
                )}
                now={renderedAt}
                onOpenActions={setActionsThread}
                priority={filter === "all"}
                projectName={
                  isProjectlessProjectId(workspace.thread.projectId)
                    ? null
                    : (projectNamesById.get(workspace.thread.projectId) ?? null)
                }
                thread={workspace.thread}
              />
            ))}
          </ul>
        ) : (
          <div className="flex min-h-28 flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="text-sm text-foreground/85">
              {query.trim() ? "No matching workspaces" : "No workspaces here"}
            </p>
            <p className="text-xs text-muted-foreground">
              {filter === "active"
                ? "Working workspaces appear here."
                : filter === "all"
                  ? "Pin a conversation to keep its workspace in Focus."
                  : "Inactive workspaces appear here for quick recall."}
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
