import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  useComposer,
  type PluginSidebarThread,
  type PluginNewThreadContextBarProps,
  type PluginThreadContextBarProps,
} from "@get-bb/plugin-sdk/app";
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

const COMPACT_CONVERSATION_CYCLE_EVENT =
  "bb:conductor-compact-conversation-cycle";
const COMPACT_CONVERSATION_AVAILABLE_EVENT =
  "bb:conductor-compact-conversation-available";
const TAB_CLOSE_TRANSITION_MS = 150;

export function ConductorContextBar({
  threadId,
  projectId,
  environmentId,
  isCompactViewport,
  experimental_registerCloseHandler,
  experimental_closePane,
}: PluginThreadContextBarProps) {
  return (
    <ConductorWorkspaceContextBar
      activeThreadId={threadId}
      projectId={projectId}
      environmentId={environmentId}
      isCompactViewport={isCompactViewport}
      registerCloseHandler={experimental_registerCloseHandler}
      closePane={experimental_closePane}
    />
  );
}

export function ConductorNewThreadContextBar({
  projectId,
  environmentId,
  isCompactViewport,
  experimental_registerCloseHandler,
  experimental_closePane,
}: PluginNewThreadContextBarProps) {
  return (
    <ConductorWorkspaceContextBar
      activeThreadId={null}
      projectId={projectId}
      environmentId={environmentId}
      isCompactViewport={isCompactViewport}
      registerCloseHandler={experimental_registerCloseHandler}
      closePane={experimental_closePane}
    />
  );
}

function ConductorWorkspaceContextBar({
  activeThreadId,
  projectId,
  environmentId,
  isCompactViewport,
  registerCloseHandler,
  closePane,
}: {
  activeThreadId: string | null;
  projectId: string;
  environmentId: string | null;
  isCompactViewport: boolean;
  registerCloseHandler?: (handler: (() => boolean) | null) => void;
  closePane?: () => void;
}) {
  const state = useSidebarThreads();
  const actions = useSidebarThreadActions();
  const composer = useComposer();
  const reconciliation = useReconciliation();
  const tabRailRef = useRef<HTMLElement>(null);
  const cycleThreadIdRef = useRef(activeThreadId);
  const closeInFlightRef = useRef(false);
  const closingTabIdsRef = useRef(new Set<string>());
  const [tabRailWidth, setTabRailWidth] = useState<number | null>(null);
  const [, setTabRevision] = useState(0);
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
      if (closeInFlightRef.current || closingTabIdsRef.current.has(threadId)) {
        return true;
      }

      const closingIndex = openThreads.findIndex(
        (thread) => thread.id === threadId,
      );
      if (closingIndex < 0) return false;

      closingTabIdsRef.current.add(threadId);
      if (threadId === cycleThreadIdRef.current) {
        closeInFlightRef.current = true;
      }
      const tab = Array.from(
        tabRailRef.current?.querySelectorAll<HTMLElement>(
          "[data-conductor-thread-id]",
        ) ?? [],
      ).find((candidate) => candidate.dataset.conductorThreadId === threadId);
      runTabCloseTransition(tab ?? null, () => {
        // Closing a conversation tab is an archive action. Keep the closed-tab
        // preference for the temporary new-conversation surface only; archived
        // conversations should leave the active projection naturally.
        actions.archive(threadId);
        closingTabIdsRef.current.delete(threadId);

        if (threadId !== cycleThreadIdRef.current) {
          setTabRevision((revision) => revision + 1);
          return;
        }
        if (openThreads.length === 1 && closePane) {
          cycleThreadIdRef.current = null;
          closePane();
          return;
        }

        const fallback =
          openThreads[closingIndex + 1] ??
          openThreads[closingIndex - 1] ??
          null;
        if (fallback) {
          cycleThreadIdRef.current = fallback.id;
          actions.open(fallback.id);
          return;
        }

        cycleThreadIdRef.current = null;
        openNewConversation();
      });
      return true;
    },
    [actions, closePane, openNewConversation, openThreads, workspace],
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
      if (!fallback) {
        if (!closePane) return false;
        closeInFlightRef.current = true;
        closePane();
        return true;
      }
      closeInFlightRef.current = true;
      cycleThreadIdRef.current = fallback.id;
      actions.open(fallback.id);
      return true;
    }
    const activeThread = openThreads[activeIndex];
    return activeThread ? closeConversation(activeThread.id) : true;
  }, [actions, closeConversation, closePane, openThreads, workspace]);

  const closeNewConversation = useCallback((): boolean => {
    if (openThreads.length === 0 && !closePane) return false;
    const tab = tabRailRef.current?.querySelector<HTMLElement>(
      "[data-new-conversation]",
    );
    runTabCloseTransition(tab ?? null, () => {
      closeFocusedConversation();
    });
    return true;
  }, [closeFocusedConversation, closePane, openThreads.length]);

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

  useLayoutEffect(() => {
    if (!isCompactViewport || !workspace || activeThreadId === null) return;
    const handleConversationAvailability = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      if (event.detail?.threadId !== activeThreadId) return;
      event.preventDefault();
    };
    const handleConversationCycle = (event: Event) => {
      if (!("detail" in event)) return;
      const detail: unknown = event.detail;
      if (typeof detail !== "object" || detail === null) return;
      if (Reflect.get(detail, "threadId") !== activeThreadId) return;
      const direction = Reflect.get(detail, "direction");
      if (direction !== "left" && direction !== "right") return;
      const currentThreadId = cycleThreadIdRef.current;
      if (currentThreadId === null || openThreads.length < 2) return;
      openAdjacentConversation(currentThreadId, direction === "right" ? 1 : -1);
    };
    window.addEventListener(
      COMPACT_CONVERSATION_CYCLE_EVENT,
      handleConversationCycle,
    );
    window.addEventListener(
      COMPACT_CONVERSATION_AVAILABLE_EVENT,
      handleConversationAvailability,
    );
    return () => {
      window.removeEventListener(
        COMPACT_CONVERSATION_CYCLE_EVENT,
        handleConversationCycle,
      );
      window.removeEventListener(
        COMPACT_CONVERSATION_AVAILABLE_EVENT,
        handleConversationAvailability,
      );
    };
  }, [
    activeThreadId,
    isCompactViewport,
    openAdjacentConversation,
    openThreads.length,
    workspace,
  ]);

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
              <button
                type="button"
                className="conductor-more-tabs-trigger"
                aria-label={`${hiddenTabs.length} more conversations`}
                title={`${hiddenTabs.length} more conversations`}
              >
                +{hiddenTabs.length}
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
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              event.stopPropagation();
              closeNewConversation();
            }}
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
              onClick={closeNewConversation}
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

function runTabCloseTransition(
  tab: HTMLElement | null,
  close: () => void,
): void {
  if (
    tab === null ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    close();
    return;
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timeoutId);
    tab.removeEventListener("animationend", handleAnimationEnd);
    close();
  };
  const handleAnimationEnd = (event: AnimationEvent) => {
    if (event.target !== tab || event.animationName !== "conductor-tab-close") {
      return;
    }
    finish();
  };
  const timeoutId = window.setTimeout(finish, TAB_CLOSE_TRANSITION_MS + 50);
  tab.addEventListener("animationend", handleAnimationEnd);
  tab.dataset.closing = "";
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
        data-conductor-thread-id={thread.id}
        onAuxClick={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
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
          aria-label={`Archive ${title}`}
          title={`Archive ${title}`}
          onClick={onClose}
        >
          <Icon name="X" className="size-3" aria-hidden />
        </button>
      </div>
    );
  },
);
