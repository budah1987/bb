import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
  type PluginThreadContextBarProps,
} from "@bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThreadPixelMatrix } from "./PixelMatrix";
import {
  buildConductorProjection,
  partitionWorkspaceThreads,
  threadDisplayTitle,
} from "./projection";
import { calculateVisibleTabCount } from "./tab-layout";
import { useReconciliation } from "./useReconciliation";
import { loadClosedTabIds, saveClosedTabIds } from "./sidebar-preferences";

export function ConductorContextBar({
  threadId,
  projectId,
  environmentId,
  isCompactViewport,
  experimental_registerCloseHandler,
}: PluginThreadContextBarProps) {
  const state = useSidebarThreads();
  const actions = useSidebarThreadActions();
  const reconciliation = useReconciliation();
  const tabRailRef = useRef<HTMLElement>(null);
  const cycleThreadIdRef = useRef(threadId);
  const closeInFlightRef = useRef(false);
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
        candidate.threads.some((thread) => thread.id === threadId)
      : candidate.environmentId === environmentId,
  );
  const hasContext = Boolean(workspace && project);
  const persistedClosedTabIds = workspace
    ? loadClosedTabIds(workspace.key)
    : [];
  const closedTabIds = persistedClosedTabIds.filter((id) => id !== threadId);
  const closedTabIdSet = new Set(closedTabIds);
  const openThreads =
    workspace?.threads.filter((thread) => !closedTabIdSet.has(thread.id)) ?? [];
  const openNewConversation = useCallback(() => {
    actions.openNewThread({
      projectId,
      focusPrompt: true,
      ...(environmentId
        ? {
            experimental_sameEnvironment: {
              environmentId,
              locked: true,
            },
          }
        : {}),
    });
  }, [actions, environmentId, projectId]);

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
    cycleThreadIdRef.current = threadId;
    closeInFlightRef.current = false;
  }, [threadId]);

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
    if (activeIndex < 0) return false;
    // The thread route is also the workspace shell. Keep one tab open so a
    // close request never sends the user to the blank composer or the window.
    if (openThreads.length === 1) return true;

    const activeThread = openThreads[activeIndex];
    const fallback =
      openThreads[activeIndex + 1] ?? openThreads[activeIndex - 1] ?? null;
    if (!activeThread || !fallback) return true;

    saveClosedTabIds(workspace.key, [
      activeThread.id,
      ...loadClosedTabIds(workspace.key).filter(
        (closedId) => closedId !== activeThread.id,
      ),
    ]);
    closeInFlightRef.current = true;
    cycleThreadIdRef.current = fallback.id;
    actions.open(fallback.id);
    return true;
  }, [actions, openThreads, workspace]);

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
    if (!experimental_registerCloseHandler) return;
    experimental_registerCloseHandler(closeFocusedConversation);
    return () => experimental_registerCloseHandler(null);
  }, [closeFocusedConversation, experimental_registerCloseHandler]);

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
      if (activeIndex < 0) return;
      const nextIndex =
        (activeIndex + offset + openThreads.length) % openThreads.length;
      const nextThread = openThreads[nextIndex];
      if (!nextThread) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      cycleThreadIdRef.current = nextThread.id;
      actions.open(nextThread.id);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    actions,
    closeFocusedConversation,
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
    partitionWorkspaceThreads(openThreads, threadId, visibleTabCount);

  return (
    <div
      className="conductor-context-bar"
      data-compact={isCompactViewport || undefined}
    >
      <div className="conductor-workspace-context">
        <span className="min-w-0 truncate font-medium">
          {isCompactViewport
            ? workspace.title
            : `${project.name} / ${workspace.title}`}
        </span>
        {workspace.branchName ? (
          <span className="min-w-0 truncate text-muted-foreground">
            {workspace.branchName}
          </span>
        ) : null}
      </div>
      <nav
        ref={tabRailRef}
        className="conductor-tab-rail"
        aria-label="Workspace conversations"
      >
        {visibleTabs.map((thread) => (
          <ConversationTabMenu
            key={thread.id}
            thread={thread}
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
              active={thread.id === threadId}
              onOpen={() => actions.open(thread.id)}
            />
          </ConversationTabMenu>
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
                  onSelect={() => actions.open(thread.id)}
                >
                  <ThreadPixelMatrix thread={thread} />
                  <span className="truncate">{threadDisplayTitle(thread)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <button
          type="button"
          className="conductor-new-conversation"
          aria-label="New conversation in this workspace"
          aria-keyshortcuts="Meta+T"
          title="New conversation (⌘T)"
          onClick={openNewConversation}
        >
          <Icon name="Plus" className="size-3.5" aria-hidden />
          {isCompactViewport ? null : <span>Conversation</span>}
        </button>
      </nav>
      <RenameConversationDialog
        thread={renameThread}
        onClose={() => setRenameThread(null)}
        onRename={(target, title) => actions.rename(target.id, title)}
      />
    </div>
  );
}

function isCycleBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('[role="dialog"], [role="menu"]') !== null;
}

export function pickDeleteFallbackThread(
  threads: readonly PluginSidebarThread[],
  deletedThreadId: string,
): PluginSidebarThread | null {
  const deletedIndex = threads.findIndex(
    (thread) => thread.id === deletedThreadId,
  );
  if (deletedIndex < 0) return null;
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  const isDeletedWithTarget = (candidate: PluginSidebarThread): boolean => {
    let parentId = candidate.parentThreadId;
    const visited = new Set<string>();
    while (parentId !== null && !visited.has(parentId)) {
      if (parentId === deletedThreadId) return true;
      visited.add(parentId);
      parentId = threadsById.get(parentId)?.parentThreadId ?? null;
    }
    return false;
  };

  for (let index = deletedIndex + 1; index < threads.length; index += 1) {
    const candidate = threads[index];
    if (candidate && !isDeletedWithTarget(candidate)) return candidate;
  }
  for (let index = deletedIndex - 1; index >= 0; index -= 1) {
    const candidate = threads[index];
    if (candidate && !isDeletedWithTarget(candidate)) return candidate;
  }
  return null;
}

function ConversationTabMenu({
  thread,
  children,
  onRename,
  onArchive,
  onDelete,
}: {
  thread: PluginSidebarThread;
  children: ReactNode;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const title = threadDisplayTitle(thread);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={`${title} actions`}>
        <ContextMenuItem onSelect={onRename}>
          <Icon name="Edit" aria-hidden />
          Rename…
        </ContextMenuItem>
        <ContextMenuItem onSelect={onArchive}>
          <Icon name="Archive" aria-hidden />
          Archive
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive-text focus:text-destructive-text"
          onSelect={onDelete}
        >
          <Icon name="Trash2" aria-hidden />
          Delete…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RenameConversationDialog({
  thread,
  onClose,
  onRename,
}: {
  thread: PluginSidebarThread | null;
  onClose: () => void;
  onRename: (thread: PluginSidebarThread, title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setTitle(thread ? threadDisplayTitle(thread) : "");
    setError(null);
    setIsSaving(false);
  }, [thread]);

  if (!thread) return null;
  const currentThread = thread;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setIsSaving(true);
    setError(null);
    try {
      await onRename(currentThread, nextTitle);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rename failed.");
      setIsSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
            <DialogDescription>
              Changes this conversation’s name everywhere it appears in BB.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5 text-xs font-medium text-foreground">
            <span>Conversation name</span>
            <Input
              autoFocus
              value={title}
              aria-invalid={error ? true : undefined}
              aria-describedby={
                error ? "conductor-conversation-rename-error" : undefined
              }
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {error ? (
            <p
              id="conductor-conversation-rename-error"
              className="text-xs text-destructive"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSaving || title.trim().length === 0}
            >
              {isSaving ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ConversationTabProps extends Omit<
  ComponentPropsWithoutRef<"button">,
  "onClick"
> {
  thread: ReturnType<typeof useSidebarThreads>["threads"][number];
  active: boolean;
  onOpen: () => void;
}

const ConversationTab = forwardRef<HTMLButtonElement, ConversationTabProps>(
  function ConversationTab({ thread, active, onOpen, ...triggerProps }, ref) {
    return (
      <button
        {...triggerProps}
        ref={ref}
        type="button"
        aria-current={active ? "page" : undefined}
        className="conductor-conversation-tab"
        data-active={active || undefined}
        title={threadDisplayTitle(thread)}
        onClick={onOpen}
      >
        <ThreadPixelMatrix thread={thread} />
        <span className="truncate">{threadDisplayTitle(thread)}</span>
      </button>
    );
  },
);
