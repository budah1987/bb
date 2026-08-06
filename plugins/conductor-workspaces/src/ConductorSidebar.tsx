import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  useRpc,
  type PluginSidebarThread,
  type PluginThreadListProps,
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
import { PixelMatrix } from "./PixelMatrix";
import {
  buildConductorProjection,
  pickWorkspaceThread,
  threadDisplayTitle,
  type ConductorProject,
  type ConductorWorkspace,
} from "./projection";
import {
  loadCollapsedSections,
  loadProjectOrder,
  moveProjectId,
  orderProjectIds,
  saveCollapsedSections,
  saveProjectOrder,
} from "./sidebar-preferences";
import {
  conversationSignal,
  signalLabel,
  workspaceSignal,
} from "./thread-state";
import type { conductorRpcContract } from "./server";
import { useReconciliation } from "./useReconciliation";
import {
  ConversationActionMenu,
  RenameConversationDialog,
  pickDeleteFallbackThread,
} from "./ConversationActions";

type RenameScope = "display" | "branch" | "folder";

interface RenameTarget {
  environmentId: string;
  scope: RenameScope;
  workspaceTitle: string;
  initialValue: string;
}

interface ArchiveTarget {
  environmentId: string;
  workspaceTitle: string;
}

const renameCopy: Record<
  RenameScope,
  { title: string; label: string; description: string }
> = {
  display: {
    title: "Rename sidebar label",
    label: "Sidebar label",
    description:
      "Changes only the name shown in BB. The Git branch and worktree folder stay unchanged.",
  },
  branch: {
    title: "Rename Git branch",
    label: "Branch name",
    description:
      "Renames the checked-out Git branch and updates this workspace in BB.",
  },
  folder: {
    title: "Rename worktree folder",
    label: "Folder name",
    description:
      "Moves the worktree within its current parent folder and updates its path in BB.",
  },
};

function RenameWorkspaceDialog({
  target,
  onClose,
  onRename,
}: {
  target: RenameTarget | null;
  onClose: () => void;
  onRename: (target: RenameTarget, value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setValue(target?.initialValue ?? "");
    setError(null);
    setIsSaving(false);
  }, [target]);

  if (!target) return null;
  const currentTarget = target;
  const copy = renameCopy[currentTarget.scope];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextValue = value.trim();
    if (!nextValue) return;
    setIsSaving(true);
    setError(null);
    try {
      await onRename(currentTarget, nextValue);
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
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5 text-xs font-medium text-foreground">
            <span>{copy.label}</span>
            <Input
              autoFocus
              value={value}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "conductor-rename-error" : undefined}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          {error ? (
            <p id="conductor-rename-error" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSaving || value.trim().length === 0}
            >
              {isSaving ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveWorkspaceDialog({
  target,
  error,
  pending,
  onClose,
  onConfirm,
}: {
  target: ArchiveTarget | null;
  error: string | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (target: ArchiveTarget) => Promise<void>;
}) {
  if (!target) return null;
  const currentTarget = target;

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {error
              ? "Couldn’t archive workspace"
              : "Archive workspace with uncommitted work?"}
          </DialogTitle>
          <DialogDescription>
            {error ??
              `“${currentTarget.workspaceTitle}” has uncommitted changes. Commit or copy them first if you may need them, or archive the workspace anyway.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onClose}
          >
            {error ? "Close" : "Cancel"}
          </Button>
          {error ? null : (
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => void onConfirm(currentTarget)}
            >
              {pending ? "Archiving…" : "Archive anyway"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionContent({
  collapsed,
  id,
  children,
}: {
  collapsed: boolean;
  id: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className="conductor-section-content"
      data-collapsed={collapsed || undefined}
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
    >
      <div className="conductor-section-content-inner">{children}</div>
    </div>
  );
}

function SignalStatus({
  signal,
}: {
  signal: ReturnType<typeof workspaceSignal>;
}) {
  const label = signalLabel(signal);
  if (!label) return null;

  return (
    <span
      className={
        signal === "unread"
          ? "conductor-status-badge"
          : "conductor-status-label"
      }
      data-signal={signal}
    >
      {label}
    </span>
  );
}

function SectionHeader({
  title,
  contentId,
  collapsed,
  signal,
  onToggle,
  onCreate,
  createLabel,
  dragHandle,
}: {
  title: string;
  contentId: string;
  collapsed: boolean;
  signal: ReturnType<typeof workspaceSignal>;
  onToggle: () => void;
  onCreate: () => void;
  createLabel: string;
  dragHandle?: ReactNode;
}) {
  const statusLabel = signalLabel(signal);

  return (
    <div className="conductor-section-header group/section flex items-center gap-0.5 px-1 text-xs font-medium text-sidebar-foreground">
      <button
        type="button"
        className="conductor-section-toggle"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={onToggle}
      >
        <Icon
          name="ChevronDown"
          className="conductor-section-caret size-3 text-muted-foreground"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        <PixelMatrix
          signal={signal}
          label={statusLabel ? `${statusLabel} in ${title}` : undefined}
        />
      </button>
      {dragHandle}
      <button
        type="button"
        className="conductor-icon-button"
        aria-label={createLabel}
        title={createLabel}
        onClick={onCreate}
      >
        <Icon name="Plus" className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function WorkspaceRow({
  workspace,
  activeThreadId,
  archivePending,
  shortcutEnabled,
  onOpen,
  onRequestArchive,
  onRequestRename,
}: {
  workspace: ConductorWorkspace;
  activeThreadId: string | null;
  archivePending: boolean;
  shortcutEnabled: boolean;
  onOpen: (threadId: string) => void;
  onRequestArchive: (workspace: ConductorWorkspace) => void;
  onRequestRename: (workspace: ConductorWorkspace, scope: RenameScope) => void;
}) {
  const target = pickWorkspaceThread(workspace, activeThreadId);
  const isActive = workspace.threads.some(
    (thread) => thread.id === activeThreadId,
  );
  const unreadCount = workspace.threads.filter(
    (thread) => thread.isUnread,
  ).length;
  const signal = workspaceSignal(workspace.threads);
  const statusLabel = signalLabel(signal);
  const displayKind = workspace.threads[0]?.environment?.workspaceDisplayKind;
  const isWorktree =
    displayKind === "managed-worktree" || displayKind === "unmanaged-worktree";
  const isShortcutTarget =
    shortcutEnabled && isWorktree && Boolean(workspace.environmentId && target);

  const row = (
    <button
      type="button"
      className="conductor-workspace-row"
      data-sidebar-thread-shortcut-target={isShortcutTarget ? "" : undefined}
      data-sidebar-thread-id={isShortcutTarget ? target?.id : undefined}
      data-active={isActive || undefined}
      aria-current={isActive ? "page" : undefined}
      onClick={() => target && onOpen(target.id)}
    >
      <PixelMatrix
        signal={signal}
        label={statusLabel ? `${statusLabel} workspace` : undefined}
      />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-xs font-medium text-sidebar-foreground">
          {workspace.title}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {workspace.branchName ??
              `${workspace.threads.length} conversation${workspace.threads.length === 1 ? "" : "s"}`}
          </span>
          <SignalStatus signal={signal} />
        </span>
      </span>
      {unreadCount > 0 ? (
        <span className="text-2xs tabular-nums text-muted-foreground">
          {unreadCount}
        </span>
      ) : null}
    </button>
  );

  if (!isWorktree || !workspace.environmentId) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent aria-label={`${workspace.title} actions`}>
        <ContextMenuItem onSelect={() => onRequestRename(workspace, "display")}>
          <Icon name="Edit" aria-hidden />
          Rename sidebar label…
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onRequestRename(workspace, "branch")}>
          <Icon name="GitBranch" aria-hidden />
          Rename branch…
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onRequestRename(workspace, "folder")}>
          <Icon name="Folder" aria-hidden />
          Rename folder…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={archivePending}
          className="text-destructive focus:bg-destructive/15 focus:text-destructive data-[last-hovered]:bg-destructive/15 data-[last-hovered]:text-destructive"
          onSelect={() => onRequestArchive(workspace)}
        >
          <Icon name="Archive" aria-hidden />
          Archive workspace
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ProjectSection({
  project,
  activeThreadId,
  collapsed,
  archivePending,
  dragDisabled,
  onToggle,
  onCreate,
  onOpen,
  onRequestArchive,
  onRequestRename,
}: {
  project: ConductorProject;
  activeThreadId: string | null;
  collapsed: boolean;
  archivePending: boolean;
  dragDisabled: boolean;
  onToggle: () => void;
  onCreate: () => void;
  onOpen: (threadId: string) => void;
  onRequestArchive: (workspace: ConductorWorkspace) => void;
  onRequestRename: (workspace: ConductorWorkspace, scope: RenameScope) => void;
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: project.id, disabled: dragDisabled });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: isDragging ? "relative" : undefined,
    zIndex: isDragging ? 100 : undefined,
    opacity: isDragging ? 0.82 : undefined,
  };
  const contentId = `conductor-project-${project.id}`;
  const signal = workspaceSignal(
    project.workspaces.flatMap((workspace) => workspace.threads),
  );

  return (
    <section
      ref={setNodeRef}
      style={style}
      className="min-w-0"
      aria-label={project.name}
    >
      <SectionHeader
        title={project.name}
        contentId={contentId}
        collapsed={collapsed}
        signal={signal}
        onToggle={onToggle}
        onCreate={onCreate}
        createLabel={`New workspace in ${project.name}`}
        dragHandle={
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="conductor-drag-handle"
            aria-label={`Reorder ${project.name}`}
            title={`Reorder ${project.name}`}
            disabled={dragDisabled}
            {...attributes}
            {...listeners}
          >
            <Icon name="DragDropVertical" className="size-3.5" aria-hidden />
          </button>
        }
      />
      <SectionContent id={contentId} collapsed={collapsed}>
        <div className="space-y-0.5">
          {project.workspaces.map((workspace) => (
            <WorkspaceRow
              key={workspace.key}
              workspace={workspace}
              activeThreadId={activeThreadId}
              archivePending={archivePending}
              shortcutEnabled={!collapsed}
              onOpen={onOpen}
              onRequestArchive={onRequestArchive}
              onRequestRename={onRequestRename}
            />
          ))}
        </div>
      </SectionContent>
    </section>
  );
}

export function ConductorSidebar({
  activeThreadId,
  isCompactViewport,
  onNavigate,
  searchQuery,
}: PluginThreadListProps) {
  const state = useSidebarThreads();
  const actions = useSidebarThreadActions();
  const rpc = useRpc<typeof conductorRpcContract>();
  const { isLoading, legacyWorkspaces, record } = useReconciliation();
  const [collapsedSections, setCollapsedSections] = useState(
    loadCollapsedSections,
  );
  const [projectOrder, setProjectOrder] = useState(loadProjectOrder);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(
    null,
  );
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameThread, setRenameThread] = useState<PluginSidebarThread | null>(
    null,
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const projection = useMemo(
    () =>
      buildConductorProjection(state.threads, state.projects, legacyWorkspaces),
    [legacyWorkspaces, state.projects, state.threads],
  );

  useEffect(() => {
    if (state.status !== "ready" || isLoading) return;
    if (
      projection.report.missingConversations !== 0 ||
      projection.report.duplicateConversations !== 0
    ) {
      return;
    }
    void record(projection.report).catch(() => undefined);
  }, [isLoading, projection.report, record, state.status]);

  useEffect(() => {
    const normalized = orderProjectIds(
      projection.projects.map((project) => project.id),
      projectOrder,
    );
    if (normalized.join("\u0000") === projectOrder.join("\u0000")) return;
    setProjectOrder(normalized);
    saveProjectOrder(normalized);
  }, [projectOrder, projection.projects]);

  const query = searchQuery.trim().toLocaleLowerCase();
  const personalThreads = projection.personalThreads.filter((thread) =>
    query
      ? threadDisplayTitle(thread).toLocaleLowerCase().includes(query)
      : true,
  );
  const projectById = new Map(
    projection.projects.map((project) => [project.id, project]),
  );
  const projects = orderProjectIds(
    projection.projects.map((project) => project.id),
    projectOrder,
  )
    .map((id) => projectById.get(id))
    .filter((project): project is ConductorProject => project !== undefined)
    .map((project) => ({
      ...project,
      workspaces: project.workspaces.filter((workspace) => {
        if (!query) return true;
        return [
          project.name,
          workspace.title,
          workspace.branchName ?? "",
          ...workspace.threads.map(threadDisplayTitle),
        ].some((value) => value.toLocaleLowerCase().includes(query));
      }),
    }))
    .filter((project) => project.workspaces.length > 0);

  const jumpDialogOpen =
    renameTarget !== null || renameThread !== null || archiveTarget !== null;
  useEffect(() => {
    if (jumpDialogOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.shiftKey ||
        event.metaKey === event.ctrlKey ||
        isJumpBlockedTarget(event.target)
      ) {
        return;
      }
      const digit = workspaceJumpDigit(event);
      if (digit === null) return;
      // Mod+1–9 jump straight to a workspace row: 1–8 pick the matching row
      // among the sections currently expanded, 9 picks the last one. Collapsed
      // sections hide their workspaces from the count, so the digits always
      // match what the sidebar shows. The chord is consumed even without a
      // match so the app-level thread-jump bindings never fire alongside.
      event.preventDefault();
      event.stopImmediatePropagation();
      const visibleWorkspaces = projects.flatMap((project) =>
        query || !collapsedSections.has(`project:${project.id}`)
          ? project.workspaces
          : [],
      );
      const workspace =
        digit === 9 ? visibleWorkspaces.at(-1) : visibleWorkspaces[digit - 1];
      const target = workspace
        ? pickWorkspaceThread(workspace, activeThreadId)
        : null;
      if (!target || target.id === activeThreadId) return;
      actions.open(target.id);
      onNavigate();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  });

  function toggleSection(sectionId: string) {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      saveCollapsedSections(next);
      return next;
    });
  }

  function openThread(threadId: string) {
    actions.open(threadId);
    onNavigate();
  }

  async function requestRename(
    workspace: ConductorWorkspace,
    scope: RenameScope,
  ) {
    if (!workspace.environmentId) return;
    let initialValue =
      scope === "display" ? workspace.title : (workspace.branchName ?? "");
    if (scope === "folder") {
      const details = await rpc.call("readWorkspaceRenameDetails", {
        environmentId: workspace.environmentId,
      });
      initialValue = details.folderName ?? "";
    }
    setRenameTarget({
      environmentId: workspace.environmentId,
      scope,
      workspaceTitle: workspace.title,
      initialValue,
    });
  }

  async function requestArchive(workspace: ConductorWorkspace) {
    if (!workspace.environmentId || archivePending) return;
    const target = {
      environmentId: workspace.environmentId,
      workspaceTitle: workspace.title,
    };
    setArchiveError(null);
    setArchivePending(true);
    try {
      const result = await rpc.call("archiveWorkspace", {
        environmentId: target.environmentId,
        confirmUncommittedChanges: false,
      });
      if (result.outcome === "confirmation_required") {
        setArchiveTarget(target);
      }
    } catch (cause) {
      setArchiveTarget(target);
      setArchiveError(
        cause instanceof Error ? cause.message : "Couldn’t archive workspace.",
      );
    } finally {
      setArchivePending(false);
    }
  }

  async function confirmArchive(target: ArchiveTarget) {
    if (archivePending) return;
    setArchivePending(true);
    try {
      await rpc.call("archiveWorkspace", {
        environmentId: target.environmentId,
        confirmUncommittedChanges: true,
      });
      setArchiveTarget(null);
    } catch (cause) {
      setArchiveError(
        cause instanceof Error ? cause.message : "Couldn’t archive workspace.",
      );
    } finally {
      setArchivePending(false);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    setProjectOrder((current) => {
      const normalized = orderProjectIds(
        projection.projects.map((project) => project.id),
        current,
      );
      const next = moveProjectId(
        normalized,
        String(event.active.id),
        String(event.over?.id),
      );
      saveProjectOrder(next);
      return next;
    });
  }

  if (state.status === "loading" || isLoading) {
    return (
      <p className="px-3 py-6 text-xs text-muted-foreground">
        Loading workspaces…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="px-3 py-6 text-xs text-destructive">
        Couldn’t load workspaces.
      </p>
    );
  }

  const threadsCollapsed = query ? false : collapsedSections.has("threads");
  const personalSignal = workspaceSignal(personalThreads);

  return (
    <>
      <nav
        className="conductor-sidebar flex min-h-0 flex-1 flex-col gap-1 px-1 pb-3"
        data-compact={isCompactViewport || undefined}
        aria-label="BBamir workspaces"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={projects.map((project) => project.id)}
            strategy={verticalListSortingStrategy}
          >
            {projects.map((project) => {
              const sectionId = `project:${project.id}`;
              const collapsed = query
                ? false
                : collapsedSections.has(sectionId);
              return (
                <ProjectSection
                  key={project.id}
                  project={project}
                  activeThreadId={activeThreadId}
                  collapsed={collapsed}
                  archivePending={archivePending}
                  dragDisabled={Boolean(query) || projects.length < 2}
                  onToggle={() => toggleSection(sectionId)}
                  onCreate={() => {
                    actions.openNewThread({
                      projectId: project.id,
                      focusPrompt: true,
                    });
                    onNavigate();
                  }}
                  onOpen={openThread}
                  onRequestArchive={(workspace) => {
                    void requestArchive(workspace);
                  }}
                  onRequestRename={(workspace, scope) => {
                    void requestRename(workspace, scope).catch(() => undefined);
                  }}
                />
              );
            })}
          </SortableContext>
        </DndContext>

        {projection.personalProjectId &&
        (!query || personalThreads.length > 0) ? (
          <section
            className="conductor-threads-section min-w-0"
            aria-label="Threads"
          >
            <SectionHeader
              title="Threads"
              contentId="conductor-personal-threads"
              collapsed={threadsCollapsed}
              signal={personalSignal}
              onToggle={() => toggleSection("threads")}
              onCreate={() => {
                actions.openNewThread({
                  projectId: projection.personalProjectId ?? undefined,
                  focusPrompt: true,
                });
                onNavigate();
              }}
              createLabel="New thread"
            />
            <SectionContent
              id="conductor-personal-threads"
              collapsed={threadsCollapsed}
            >
              <ul className="space-y-0.5">
                {personalThreads.map((thread) => {
                  const signal = conversationSignal(thread);
                  const statusLabel = signalLabel(signal);
                  return (
                    <li key={thread.id} className="list-none">
                      <ConversationActionMenu
                        thread={thread}
                        onRename={() => setRenameThread(thread)}
                        onArchive={() => actions.archive(thread.id)}
                        onDelete={() => {
                          const fallback = pickDeleteFallbackThread(
                            personalThreads,
                            thread.id,
                          );
                          actions.requestDelete(
                            thread.id,
                            fallback
                              ? {
                                  experimental_fallbackThreadId: fallback.id,
                                }
                              : undefined,
                          );
                        }}
                      >
                        <div
                          className="conductor-workspace-row relative"
                          data-active={
                            thread.id === activeThreadId || undefined
                          }
                        >
                          <a
                            href="#"
                            aria-label={threadDisplayTitle(thread)}
                            aria-current={
                              thread.id === activeThreadId ? "page" : undefined
                            }
                            className="absolute inset-0 rounded-lg outline-none"
                            onClick={(event) => {
                              event.preventDefault();
                              actions.open(thread.id, {
                                split: event.metaKey || event.ctrlKey,
                              });
                              onNavigate();
                            }}
                          />
                          <PixelMatrix
                            signal={signal}
                            label={thread.indicatorLabel ?? statusLabel}
                          />
                          <span className="pointer-events-none relative min-w-0 flex-1 text-left">
                            <span className="block truncate text-xs font-medium text-sidebar-foreground">
                              {threadDisplayTitle(thread)}
                            </span>
                            <SignalStatus signal={signal} />
                          </span>
                        </div>
                      </ConversationActionMenu>
                    </li>
                  );
                })}
              </ul>
            </SectionContent>
          </section>
        ) : null}

        {projects.length === 0 && personalThreads.length === 0 ? (
          <p className="px-3 py-6 text-xs text-muted-foreground">
            {query ? "No matching conversations." : "No conversations yet."}
          </p>
        ) : null}
      </nav>
      <ArchiveWorkspaceDialog
        target={archiveTarget}
        error={archiveError}
        pending={archivePending}
        onClose={() => {
          if (archivePending) return;
          setArchiveTarget(null);
          setArchiveError(null);
        }}
        onConfirm={confirmArchive}
      />
      <RenameWorkspaceDialog
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRename={async (target, value) => {
          await rpc.call("renameWorkspace", {
            environmentId: target.environmentId,
            scope: target.scope,
            value,
          });
        }}
      />
      <RenameConversationDialog
        thread={renameThread}
        onClose={() => setRenameThread(null)}
        onRename={(target, title) => actions.rename(target.id, title)}
      />
    </>
  );
}

function workspaceJumpDigit(event: KeyboardEvent): number | null {
  const match =
    /^Digit([1-9])$/u.exec(event.code)?.[1] ??
    (/^[1-9]$/u.test(event.key) ? event.key : null);
  return match === null ? null : Number(match);
}

function isJumpBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('[role="dialog"], [role="menu"]') !== null;
}
