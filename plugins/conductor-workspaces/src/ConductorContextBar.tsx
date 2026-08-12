import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  useComposer,
  type PluginSidebarThread,
  type PluginNewThreadContextBarProps,
  type PluginThreadContextBarProps,
} from "@bb/plugin-sdk/app";
import { Icon } from "../components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { ThreadPixelMatrix } from "./PixelMatrix";
import {
  buildConductorProjection,
  partitionWorkspaceThreads,
  threadDisplayTitle,
} from "./projection";
import { calculateVisibleTabCount } from "./tab-layout";
import { useReconciliation } from "./useReconciliation";
import { loadClosedTabIds, saveClosedTabIds } from "./sidebar-preferences";
import {
  ConversationActionMenu,
  RenameConversationDialog,
  pickDeleteFallbackThread,
} from "./ConversationActions";

const COMPACT_TAB_SWIPE_INTENT_PX = 10;
const COMPACT_TAB_SWIPE_COMMIT_PX = 36;

interface CompactTabSwipeSession {
  active: boolean;
  pointerId: number;
  startX: number;
  startY: number;
}

export function ConductorContextBar({
  threadId,
  projectId,
  environmentId,
  isCompactViewport,
  experimental_registerCloseHandler,
}: PluginThreadContextBarProps) {
  return (
    <ConductorWorkspaceContextBar
      activeThreadId={threadId}
      projectId={projectId}
      environmentId={environmentId}
      isCompactViewport={isCompactViewport}
      registerCloseHandler={experimental_registerCloseHandler}
    />
  );
}

export function ConductorNewThreadContextBar({
  projectId,
  environmentId,
  isCompactViewport,
  experimental_registerCloseHandler,
}: PluginNewThreadContextBarProps) {
  return (
    <ConductorWorkspaceContextBar
      activeThreadId={null}
      projectId={projectId}
      environmentId={environmentId}
      isCompactViewport={isCompactViewport}
      registerCloseHandler={experimental_registerCloseHandler}
    />
  );
}

function ConductorWorkspaceContextBar({
  activeThreadId,
  projectId,
  environmentId,
  isCompactViewport,
  registerCloseHandler,
}: {
  activeThreadId: string | null;
  projectId: string;
  environmentId: string | null;
  isCompactViewport: boolean;
  registerCloseHandler?: (handler: (() => boolean) | null) => void;
}) {
  const state = useSidebarThreads();
  const actions = useSidebarThreadActions();
  const composer = useComposer();
  const reconciliation = useReconciliation();
  const tabRailRef = useRef<HTMLElement>(null);
  const cycleThreadIdRef = useRef(activeThreadId);
  const closeInFlightRef = useRef(false);
  const tabSwipeRef = useRef<CompactTabSwipeSession | null>(null);
  const suppressTabClickRef = useRef(false);
  const [tabRailWidth, setTabRailWidth] = useState<number | null>(null);
  const [renameThread, setRenameThread] = useState<PluginSidebarThread | null>(
    null,
  );
  const projection = useMemo(
    () =>
      buildConductorProjection(
        state.threads,
        state.projects,
        reconciliation.legacyWorkspaces,
      ),
    [reconciliation.legacyWorkspaces, state.projects, state.threads],
  );
  const project = projection.projects.find(
    (candidate) => candidate.id === projectId,
  );
  const workspace = project?.workspaces.find((candidate) =>
    environmentId === null
      ? candidate.isUnassigned &&
        (activeThreadId === null ||
          candidate.threads.some((thread) => thread.id === activeThreadId))
      : candidate.environmentId === environmentId,
  );
  const hasContext = Boolean(workspace && project);
  const persistedClosedTabIds = workspace
    ? loadClosedTabIds(workspace.key)
    : [];
  const closedTabIds = persistedClosedTabIds.filter(
    (id) => id !== activeThreadId,
  );
  const closedTabIdSet = new Set(closedTabIds);
  const openThreads =
    workspace?.threads.filter((thread) => !closedTabIdSet.has(thread.id)) ?? [];
  const openNewConversation = useCallback(() => {
    runStableNewTabTransition(() => {
      actions.openNewThread({
        projectId,
        focusPrompt: true,
        experimental_sameEnvironment: {
          environmentId,
          locked: environmentId !== null,
        },
      });
    });
  }, [actions, environmentId, projectId]);

  const closeConversation = useCallback(
    (threadId: string): boolean => {
      if (!workspace) return false;
      if (closeInFlightRef.current) return true;

      const closingIndex = openThreads.findIndex(
        (thread) => thread.id === threadId,
      );
      if (closingIndex < 0) return false;

      saveClosedTabIds(workspace.key, [
        threadId,
        ...loadClosedTabIds(workspace.key).filter(
          (closedId) => closedId !== threadId,
        ),
      ]);

      if (threadId !== cycleThreadIdRef.current) return true;

      const fallback =
        openThreads[closingIndex + 1] ?? openThreads[closingIndex - 1] ?? null;
      closeInFlightRef.current = true;
      if (fallback) {
        cycleThreadIdRef.current = fallback.id;
        actions.open(fallback.id);
        return true;
      }

      cycleThreadIdRef.current = null;
      openNewConversation();
      return true;
    },
    [actions, openNewConversation, openThreads, workspace],
  );

  useLayoutEffect(() => {
    const rail = tabRailRef.current;
    if (!rail || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const width = rail.clientWidth;
      setTabRailWidth(width > 0 ? width : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [hasContext]);

  useEffect(() => {
    cycleThreadIdRef.current = activeThreadId;
    closeInFlightRef.current = false;
  }, [activeThreadId]);

  useEffect(() => {
    if (!workspace || persistedClosedTabIds.length === closedTabIds.length) {
      return;
    }
    saveClosedTabIds(workspace.key, closedTabIds);
  }, [closedTabIds, persistedClosedTabIds.length, workspace]);

  const closeFocusedConversation = useCallback((): boolean => {
    if (!workspace) return false;
    // Electron can surface the same accelerator through both the renderer
    // keydown and its close-request round trip. Consume the duplicate until
    // navigation mounts the next focused tab.
    if (closeInFlightRef.current) return true;
    const activeIndex = openThreads.findIndex(
      (thread) => thread.id === cycleThreadIdRef.current,
    );
    if (activeIndex < 0) {
      const fallback = openThreads[0];
      if (!fallback) return false;
      closeInFlightRef.current = true;
      cycleThreadIdRef.current = fallback.id;
      actions.open(fallback.id);
      return true;
    }
    const activeThread = openThreads[activeIndex];
    return activeThread ? closeConversation(activeThread.id) : true;
  }, [actions, closeConversation, openThreads, workspace]);

  const openConversation = useCallback(
    (threadId: string) => {
      if (threadId === activeThreadId) return;
      cycleThreadIdRef.current = threadId;
      actions.open(threadId);
    },
    [actions, activeThreadId],
  );

  const openAdjacentConversation = useCallback(
    (threadId: string, offset: -1 | 1) => {
      const currentIndex = openThreads.findIndex(
        (thread) => thread.id === threadId,
      );
      if (currentIndex < 0 || openThreads.length < 2) return;
      const nextThread =
        openThreads[
          (currentIndex + offset + openThreads.length) % openThreads.length
        ];
      if (nextThread) openConversation(nextThread.id);
    },
    [openConversation, openThreads],
  );

  const resetTabSwipe = useCallback(() => {
    tabSwipeRef.current = null;
  }, []);
  const handleTabSwipeStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      !isCompactViewport ||
      event.pointerType !== "touch" ||
      event.button !== 0
    ) {
      return;
    }
    suppressTabClickRef.current = false;
    tabSwipeRef.current = {
      active: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  };
  const handleTabSwipeMove = (event: ReactPointerEvent<HTMLElement>) => {
    const swipe = tabSwipeRef.current;
    if (swipe === null || swipe.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;
    if (!swipe.active) {
      if (
        Math.abs(deltaY) > COMPACT_TAB_SWIPE_INTENT_PX &&
        Math.abs(deltaY) > Math.abs(deltaX)
      ) {
        resetTabSwipe();
        return;
      }
      if (
        Math.abs(deltaX) < COMPACT_TAB_SWIPE_INTENT_PX ||
        Math.abs(deltaX) <= Math.abs(deltaY) * 1.25
      ) {
        return;
      }
      swipe.active = true;
      suppressTabClickRef.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
  };
  const handleTabSwipeEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const swipe = tabSwipeRef.current;
    if (swipe === null || swipe.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - swipe.startX;
    if (
      swipe.active &&
      Math.abs(deltaX) >= COMPACT_TAB_SWIPE_COMMIT_PX &&
      activeThreadId !== null
    ) {
      openAdjacentConversation(activeThreadId, deltaX < 0 ? 1 : -1);
    }
    resetTabSwipe();
  };

  const reopenClosedConversation = useCallback(() => {
    if (!workspace) return;
    const workspaceThreadIds = new Set(
      workspace.threads.map((thread) => thread.id),
    );
    const stack = loadClosedTabIds(workspace.key).filter((closedId) =>
      workspaceThreadIds.has(closedId),
    );
    const reopenedId = stack[0];
    if (!reopenedId) return;
    saveClosedTabIds(workspace.key, stack.slice(1));
    cycleThreadIdRef.current = reopenedId;
    actions.open(reopenedId);
  }, [actions, workspace]);

  useEffect(() => {
    if (!registerCloseHandler) return;
    registerCloseHandler(closeFocusedConversation);
    return () => registerCloseHandler(null);
  }, [closeFocusedConversation, registerCloseHandler]);

  useEffect(() => {
    if (!workspace || renameThread) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.metaKey === event.ctrlKey ||
        isCycleBlockedTarget(event.target)
      ) {
        return;
      }
      if (event.code === "KeyW" || event.key.toLowerCase() === "w") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.shiftKey) reopenClosedConversation();
        else closeFocusedConversation();
        return;
      }
      if (event.shiftKey) return;
      if (event.code === "KeyT" || event.key.toLowerCase() === "t") {
        event.preventDefault();
        event.stopImmediatePropagation();
        openNewConversation();
        return;
      }
      if (openThreads.length < 2) return;
      const offset =
        event.code === "BracketLeft" || event.key === "["
          ? -1
          : event.code === "BracketRight" || event.key === "]"
            ? 1
            : null;
      if (offset === null) return;

      const activeIndex = openThreads.findIndex(
        (thread) => thread.id === cycleThreadIdRef.current,
      );
      const nextIndex =
        activeIndex < 0
          ? offset < 0
            ? openThreads.length - 1
            : 0
          : (activeIndex + offset + openThreads.length) % openThreads.length;
      const nextThread = openThreads[nextIndex];
      if (!nextThread) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      openConversation(nextThread.id);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    closeFocusedConversation,
    openConversation,
    openNewConversation,
    openThreads,
    renameThread,
    reopenClosedConversation,
    workspace,
  ]);

  if (!workspace || !project) return null;

  const visibleTabCount = calculateVisibleTabCount({
    compact: isCompactViewport,
    railWidth: tabRailWidth,
    threadCount: openThreads.length,
  });

  const { visible: visibleTabs, hidden: hiddenTabs } =
    partitionWorkspaceThreads(openThreads, activeThreadId, visibleTabCount);

  return (
    <div
      className="conductor-context-bar"
      data-compact={isCompactViewport || undefined}
    >
      <nav
        ref={tabRailRef}
        className="conductor-tab-rail"
        aria-label="Workspace conversations"
        data-no-workspace-swipe=""
        onClickCapture={(event) => {
          if (!suppressTabClickRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressTabClickRef.current = false;
        }}
        onPointerCancel={resetTabSwipe}
        onPointerDown={handleTabSwipeStart}
        onPointerMove={handleTabSwipeMove}
        onPointerUp={handleTabSwipeEnd}
      >
        {visibleTabs.map((thread) => (
          <ConversationActionMenu
            key={thread.id}
            thread={thread}
            onContinueInNewTab={
              actions.experimental_canOpenForkDraft(thread.id)
                ? () => {
                    void actions.experimental_openForkDraft(thread.id);
                  }
                : undefined
            }
            onSetRead={(read) => {
              void actions.setRead(thread.id, read);
            }}
            onRename={() => setRenameThread(thread)}
            onArchive={() => actions.archive(thread.id)}
            onDelete={() => {
              const fallback = pickDeleteFallbackThread(
                workspace.threads,
                thread.id,
              );
              actions.requestDelete(
                thread.id,
                fallback
                  ? { experimental_fallbackThreadId: fallback.id }
                  : undefined,
              );
            }}
          >
            <ConversationTab
              thread={thread}
              active={thread.id === activeThreadId}
              onOpen={() => openConversation(thread.id)}
              onClose={() => closeConversation(thread.id)}
              onOpenAdjacent={(offset) =>
                openAdjacentConversation(thread.id, offset)
              }
            />
          </ConversationActionMenu>
        ))}
        {hiddenTabs.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="conductor-more-tabs-trigger">
                {hiddenTabs.length} more
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              mobileTitle="More conversations"
              className="w-64 max-w-[calc(100vw-1rem)]"
            >
              {hiddenTabs.map((thread) => (
                <DropdownMenuItem
                  key={thread.id}
                  textValue={threadDisplayTitle(thread)}
                  onSelect={() => openConversation(thread.id)}
                >
                  <ThreadPixelMatrix thread={thread} />
                  <span className="truncate">{threadDisplayTitle(thread)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {activeThreadId === null ? (
          <div
            className="conductor-conversation-tab conductor-new-conversation-tab"
            data-active
            data-new-conversation
          >
            <button
              type="button"
              className="conductor-conversation-tab-main"
              aria-current="page"
              aria-label="New conversation"
              title="New conversation"
              onClick={() => composer.focus()}
            >
              <Icon name="Plus" className="size-3.5" aria-hidden />
              {isCompactViewport ? null : (
                <span className="truncate">New conversation</span>
              )}
            </button>
            <button
              type="button"
              className="conductor-conversation-tab-close"
              aria-label="Close new conversation"
              title="Close new conversation"
              onClick={closeFocusedConversation}
            >
              <Icon name="X" className="size-3" aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="conductor-new-conversation conductor-new-conversation-slot"
            aria-label="New conversation in this workspace"
            aria-keyshortcuts="Meta+T"
            title="New conversation (⌘T)"
            onClick={openNewConversation}
          >
            <Icon name="Plus" className="size-3.5" aria-hidden />
          </button>
        )}
      </nav>
      <RenameConversationDialog
        thread={renameThread}
        onClose={() => setRenameThread(null)}
        onRename={(target, title) => actions.rename(target.id, title)}
      />
    </div>
  );
}

function runStableNewTabTransition(navigate: () => void): void {
  if (
    typeof document === "undefined" ||
    typeof document.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    navigate();
    return;
  }

  const root = document.documentElement;
  root.dataset.conductorNewTabTransition = "";
  const transition = document.startViewTransition(navigate);
  void transition.finished.finally(() => {
    delete root.dataset.conductorNewTabTransition;
  });
}

function isCycleBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('[role="dialog"], [role="menu"]') !== null;
}

interface ConversationTabProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "onClick"
> {
  thread: ReturnType<typeof useSidebarThreads>["threads"][number];
  active: boolean;
  onOpen: () => void;
  onClose: () => void;
  onOpenAdjacent: (offset: -1 | 1) => void;
}

const ConversationTab = forwardRef<HTMLDivElement, ConversationTabProps>(
  function ConversationTab(
    { thread, active, onOpen, onClose, onOpenAdjacent, ...triggerProps },
    ref,
  ) {
    const title = threadDisplayTitle(thread);
    return (
      <div
        {...triggerProps}
        ref={ref}
        className="conductor-conversation-tab"
        data-active={active || undefined}
      >
        <button
          type="button"
          className="conductor-conversation-tab-main"
          aria-current={active ? "page" : undefined}
          tabIndex={active ? 0 : -1}
          title={title}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
              return;
            }
            event.preventDefault();
            onOpenAdjacent(event.key === "ArrowLeft" ? -1 : 1);
          }}
        >
          <ThreadPixelMatrix thread={thread} />
          <span className="truncate">{title}</span>
        </button>
        <button
          type="button"
          className="conductor-conversation-tab-close"
          tabIndex={active ? 0 : -1}
          aria-label={`Close ${title}`}
          title={`Close ${title}`}
          onClick={onClose}
        >
          <Icon name="X" className="size-3" aria-hidden />
        </button>
      </div>
    );
  },
);
