import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
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
  useBbNavigate,
  useRpc,
  type PluginSidebarPullRequest,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "../components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Icon } from "../components/ui/icon";
import { Input } from "../components/ui/input";
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
  loadWorkspaceOrders,
  moveProjectId,
  orderProjectIds,
  orderWorkspaceKeys,
  moveWorkspaceKey,
  saveCollapsedSections,
  saveProjectOrder,
  saveWorkspaceOrders,
} from "./sidebar-preferences";
import {
  conversationSignal,
  signalLabel,
  workspaceSignal,
} from "./thread-state";
import type { conductorRpcContract } from "./rpc-contract";
import { useReconciliation } from "./useReconciliation";
import {
  ConversationActionMenu,
  RenameConversationDialog,
  pickDeleteFallbackThread,
} from "./ConversationActions";
import {
  loadProjectCustomizations,
  patchProjectCustomization,
  saveProjectCustomizations,
  type ProjectCustomization,
} from "./project-customizations";
import { ProjectGlyphIcon } from "./project-icons";
import {
  ProjectIconDialog,
  RenameProjectDialog,
  type ProjectIconTarget,
  type ProjectRenameTarget,
} from "./ProjectCustomizationDialogs";
import { openRepositoryDetails } from "./RepositoryDetailsPane";

type RenameScope = "display" | "branch" | "folder";
type SidebarSpaces = NonNullable<PluginThreadListProps["experimental_spaces"]>;

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

interface WorkspaceGitSummary {
  environmentId: string;
  workspacePath: string | null;
  gitAvailable: boolean;
  aheadCount: number;
  behindCount: number;
  changedFiles: number;
}

function pullRequestLabel(pullRequest: PluginSidebarPullRequest): string {
  const detail = (() => {
    switch (pullRequest.attention) {
      case "ready_to_merge":
      case "merged":
        return "✓";
      case "checks_failed":
        return "Checks failed";
      case "checks_pending":
        return "Checks pending";
      case "changes_requested":
        return "Changes requested";
      case "review_requested":
        return "Review requested";
      case "conflicts":
        return "Conflicts";
      case "blocked":
        return "Blocked";
      case "draft":
        return "Draft";
      case "closed":
        return "Closed";
      case "none":
        return null;
    }
  })();
  return [`PR #${pullRequest.number}`, detail].filter(Boolean).join(" ");
}

function WorkspaceMetadata({
  branchLabel,
  signal,
  summary,
  pullRequest,
}: {
  branchLabel: string;
  signal: ReturnType<typeof workspaceSignal>;
  summary: WorkspaceGitSummary | null;
  pullRequest: PluginSidebarPullRequest | null;
}) {
  const divergence = summary?.gitAvailable
    ? [
        summary.aheadCount > 0 ? `↑${summary.aheadCount}` : null,
        summary.behindCount > 0 ? `↓${summary.behindCount}` : null,
      ].filter(Boolean)
    : [];
  const changedFiles = summary?.gitAvailable
    ? summary.changedFiles === 0
      ? "Clean"
      : `${summary.changedFiles} change${summary.changedFiles === 1 ? "" : "s"}`
    : null;

  return (
    <span className="conductor-workspace-meta">
      <SignalStatus signal={signal} />
      <span className="conductor-workspace-meta-item" data-kind="branch">
        <Icon name="GitBranch" aria-hidden className="size-3" />
        <span className="truncate">{branchLabel}</span>
      </span>
      <span className="conductor-workspace-facts">
        {divergence.length > 0 ? (
          <span
            className="conductor-workspace-meta-item"
            data-kind="divergence"
          >
            {divergence.join(" ")}
          </span>
        ) : null}
        {changedFiles ? (
          <span
            className="conductor-workspace-meta-item"
            data-kind={summary?.changedFiles === 0 ? "clean" : "changes"}
          >
            {changedFiles}
          </span>
        ) : null}
        {pullRequest ? (
          <span
            className="conductor-workspace-meta-item"
            data-kind="pull-request"
          >
            {pullRequestLabel(pullRequest)}
          </span>
        ) : null}
      </span>
    </span>
  );
}

interface GithubAccountOption {
  login: string;
  active: boolean;
}

interface GithubRepositoryOption {
  nameWithOwner: string;
  url: string;
  isPrivate: boolean;
  defaultBranch: string | null;
  accessibleBy: string[];
  activeAccount: string | null;
}

interface GithubCatalog {
  hostId: string;
  accounts: GithubAccountOption[];
  repositories: GithubRepositoryOption[];
}

function accountsForRepository(
  catalog: GithubCatalog | null,
  repositoryName: string | null,
): GithubAccountOption[] {
  if (!catalog || !repositoryName) return [];
  const repository = repositoryName
    ? catalog.repositories.find(
        (candidate) =>
          candidate.nameWithOwner.toLocaleLowerCase() ===
          repositoryName.toLocaleLowerCase(),
      )
    : undefined;
  if (!repository) return [];
  return catalog.accounts.filter((account) =>
    repository.accessibleBy.some(
      (login) =>
        login.toLocaleLowerCase() === account.login.toLocaleLowerCase(),
    ),
  );
}

function AddRepositoryDialog({
  catalog,
  open,
  pending,
  onClose,
  onCreate,
  onLoad,
}: {
  catalog: GithubCatalog | null;
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onCreate: (
    repository: GithubRepositoryOption,
    accountLogin: string | null,
  ) => Promise<void>;
  onLoad: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [accountLogin, setAccountLogin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedName(null);
    setAccountLogin(null);
    setError(null);
    void onLoad().catch((cause) => {
      setError(
        cause instanceof Error ? cause.message : "Unable to load repositories.",
      );
    });
  }, [onLoad, open]);

  const filteredRepositories = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (catalog?.repositories ?? []).filter((repository) =>
      normalizedQuery.length === 0
        ? true
        : repository.nameWithOwner
            .toLocaleLowerCase()
            .includes(normalizedQuery),
    );
  }, [catalog?.repositories, query]);
  const selectedRepository = filteredRepositories.find(
    (repository) => repository.nameWithOwner === selectedName,
  );
  const selectableAccounts = useMemo(
    () =>
      selectedRepository
        ? accountsForRepository(catalog, selectedRepository.nameWithOwner)
        : (catalog?.accounts ?? []),
    [catalog, selectedRepository],
  );

  useEffect(() => {
    if (!open) return;
    if (selectableAccounts.some((account) => account.login === accountLogin)) {
      return;
    }
    setAccountLogin(
      selectableAccounts.find((account) => account.active)?.login ??
        selectableAccounts[0]?.login ??
        null,
    );
  }, [accountLogin, open, selectableAccounts]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRepository) return;
    setError(null);
    try {
      await onCreate(selectedRepository, accountLogin);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to add repository.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add repository</DialogTitle>
            <DialogDescription>
              Add a GitHub repository to the sidebar first. Start a workspace
              later with the plus button beside it.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5 text-xs font-medium text-foreground">
            <span>Search repositories</span>
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="owner/repository"
            />
          </label>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-1">
            {!catalog ? (
              <p className="px-3 py-5 text-xs text-muted-foreground">
                Loading repositories…
              </p>
            ) : filteredRepositories.length === 0 ? (
              <p className="px-3 py-5 text-xs text-muted-foreground">
                No repositories are visible to any authenticated GitHub account.
              </p>
            ) : (
              filteredRepositories.map((repository) => (
                <button
                  key={repository.nameWithOwner}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs hover:bg-state-hover data-[selected=true]:bg-state-active"
                  data-selected={repository.nameWithOwner === selectedName}
                  aria-pressed={repository.nameWithOwner === selectedName}
                  onClick={() => setSelectedName(repository.nameWithOwner)}
                >
                  <Icon name="Github" className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {repository.nameWithOwner}
                  </span>
                  <span className="max-w-40 shrink-0 truncate text-2xs text-muted-foreground">
                    {repository.accessibleBy
                      .map((login) => `@${login}`)
                      .join(" · ")}
                  </span>
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {repository.isPrivate ? "Private" : "Public"}
                  </span>
                </button>
              ))
            )}
          </div>
          {selectableAccounts.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-foreground">
                GitHub account for this repository
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {selectableAccounts.map((account) => (
                  <label
                    key={account.login}
                    className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-state-hover"
                  >
                    <input
                      type="radio"
                      name="github-account"
                      value={account.login}
                      checked={account.login === accountLogin}
                      onChange={() => setAccountLogin(account.login)}
                    />
                    <span>@{account.login}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !selectedRepository}>
              {pending ? "Adding…" : "Add repository"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const WORKSPACE_DND_PREFIX = "workspace:";

type DragState = {
  activeId: string;
  overId: string | null;
};

type SortableActivatorBindings = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

function workspaceDndId(workspaceKey: string): string {
  return `${WORKSPACE_DND_PREFIX}${workspaceKey}`;
}

function workspaceKeyFromDndId(value: string): string | null {
  return value.startsWith(WORKSPACE_DND_PREFIX)
    ? value.slice(WORKSPACE_DND_PREFIX.length)
    : null;
}

function workspaceOrdersEqual(
  left: Readonly<Record<string, readonly string[]>>,
  right: Readonly<Record<string, readonly string[]>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      right[key] !== undefined &&
      left[key]?.join("\u0000") === right[key]?.join("\u0000"),
  );
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
    <span className="conductor-status-label" data-signal={signal}>
      {label}
    </span>
  );
}

export type ConductorGithubAttention =
  | "checks_failed"
  | "conflicts"
  | "changes_requested"
  | "checks_pending"
  | "review_requested";

function GithubAttentionStatus({
  attention,
}: {
  attention: ConductorGithubAttention | null;
}) {
  if (attention === null) return null;
  const label = {
    checks_failed: "Checks failed",
    conflicts: "Conflicts",
    changes_requested: "Changes requested",
    checks_pending: "Checks pending",
    review_requested: "Review requested",
  }[attention];
  return (
    <span
      className="conductor-status-label"
      data-github-attention=""
      data-signal={attention}
      title="Open pull request workflow"
    >
      {label}
    </span>
  );
}

function SectionHeader({
  title,
  meta,
  icon,
  contentId,
  collapsed,
  signal,
  onToggle,
  onCreate,
  createLabel,
  dragBindings,
}: {
  title: string;
  meta?: ReactNode;
  icon?: ReactNode;
  contentId: string;
  collapsed: boolean;
  signal: ReturnType<typeof workspaceSignal>;
  onToggle: () => void;
  onCreate: () => void;
  createLabel: string;
  dragBindings?: SortableActivatorBindings;
}) {
  const statusLabel = signalLabel(signal);

  return (
    <div className="conductor-section-header group/section flex items-center gap-0.5 px-1 text-xs font-medium text-sidebar-foreground">
      <button
        ref={dragBindings?.setActivatorNodeRef}
        type="button"
        className="conductor-section-toggle"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={onToggle}
        {...dragBindings?.attributes}
        {...(dragBindings?.listeners ?? {})}
      >
        <Icon
          name="ChevronDown"
          className="conductor-section-caret size-3 text-muted-foreground"
          aria-hidden
        />
        {icon}
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        {meta}
        {collapsed ? (
          <PixelMatrix
            signal={signal}
            label={statusLabel ? `${statusLabel} in ${title}` : undefined}
          />
        ) : null}
      </button>
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
  gitSummary,
  activeThreadId,
  archivePending,
  dragDisabled,
  focused,
  isDropTarget,
  shortcutEnabled,
  jumpShortcut,
  showJumpShortcut,
  onOpen,
  onOpenGithubAttention,
  onCreateConversation,
  onRequestArchive,
  onRequestRename,
  onSetRead,
  onSetFocused,
  githubAttention,
}: {
  workspace: ConductorWorkspace;
  gitSummary: WorkspaceGitSummary | null;
  activeThreadId: string | null;
  archivePending: boolean;
  dragDisabled: boolean;
  focused: boolean;
  isDropTarget: boolean;
  shortcutEnabled: boolean;
  jumpShortcut: { ariaKeyshortcuts: string; label: string } | null;
  showJumpShortcut: boolean;
  onOpen: (threadId: string, options?: { split?: boolean }) => void;
  onOpenGithubAttention: (threadId: string) => void;
  onCreateConversation: (workspace: ConductorWorkspace) => void;
  onRequestArchive: (workspace: ConductorWorkspace) => void;
  onRequestRename: (workspace: ConductorWorkspace, scope: RenameScope) => void;
  onSetRead: (workspace: ConductorWorkspace, read: boolean) => void;
  onSetFocused: (workspace: ConductorWorkspace, focused: boolean) => void;
  githubAttention: ConductorGithubAttention | null;
}) {
  const target = pickWorkspaceThread(workspace, activeThreadId);
  const branchLabel =
    workspace.branchName ??
    `${workspace.threads.length} conversation${workspace.threads.length === 1 ? "" : "s"}`;
  const isActive = workspace.threads.some(
    (thread) => thread.id === activeThreadId,
  );
  const signal = workspaceSignal(workspace.threads);
  const isExplicitlyRead = target?.lastReadAt === target?.latestAttentionAt;
  const statusLabel = signalLabel(signal);
  const displayKind = workspace.threads[0]?.environment?.workspaceDisplayKind;
  const isWorktree =
    displayKind === "managed-worktree" || displayKind === "unmanaged-worktree";
  const isShortcutTarget =
    shortcutEnabled && isWorktree && Boolean(workspace.environmentId && target);
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: workspaceDndId(workspace.key),
    disabled: dragDisabled,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: isDragging ? "relative" : undefined,
    zIndex: isDragging ? 100 : undefined,
    opacity: isDragging ? 0.82 : undefined,
  };

  const row = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      className="conductor-workspace-row"
      data-sidebar-thread-shortcut-target={isShortcutTarget ? "" : undefined}
      data-sidebar-thread-id={isShortcutTarget ? target?.id : undefined}
      data-active={isActive || undefined}
      aria-current={isActive ? "page" : undefined}
      aria-keyshortcuts={jumpShortcut?.ariaKeyshortcuts}
      onClick={(event) => {
        if (!target) return;
        if (
          event.target instanceof Element &&
          event.target.closest("[data-github-attention]")
        ) {
          onOpenGithubAttention(target.id);
          return;
        }
        onOpen(target.id);
      }}
      {...attributes}
      {...(listeners ?? {})}
    >
      <PixelMatrix
        signal={signal}
        label={statusLabel ? `${statusLabel} workspace` : undefined}
      />
      <span className="conductor-workspace-copy">
        <span className="conductor-workspace-title">{workspace.title}</span>
        <WorkspaceMetadata
          branchLabel={branchLabel}
          signal={signal}
          summary={gitSummary}
          pullRequest={null}
        />
      </span>
      <GithubAttentionStatus attention={githubAttention} />
      {showJumpShortcut && jumpShortcut ? (
        <kbd
          aria-hidden
          className="pointer-events-none inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm bg-state-hover px-1.5 py-1 font-sans text-xs font-normal leading-none tabular-nums text-muted-foreground"
        >
          {jumpShortcut.label}
        </kbd>
      ) : null}
    </button>
  );

  const sortableRow = (
    <div
      ref={setNodeRef}
      style={style}
      className="conductor-workspace-sortable-row group/workspace flex min-w-0 items-center"
      data-dragging={isDragging || undefined}
      data-drop-target={isDropTarget || undefined}
    >
      {row}
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{sortableRow}</ContextMenuTrigger>
      <ContextMenuContent aria-label={`${workspace.title} actions`}>
        <ContextMenuItem onSelect={() => target && onOpen(target.id)}>
          <Icon name="ArrowRight" aria-hidden />
          Open workspace
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => target && onOpen(target.id, { split: true })}
        >
          <Icon name="Columns2" aria-hidden />
          Open in split
        </ContextMenuItem>
        {workspace.environmentId ? (
          <ContextMenuItem onSelect={() => onCreateConversation(workspace)}>
            <Icon name="MessageSquarePlus" aria-hidden />
            New conversation
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => onSetRead(workspace, !isExplicitlyRead)}
        >
          <Icon name={isExplicitlyRead ? "Mail" : "MailOpen"} aria-hidden />
          {isExplicitlyRead ? "Mark as unread" : "Mark as read"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onSetFocused(workspace, !focused)}>
          <Icon name={focused ? "PinOff" : "Pin"} aria-hidden />
          {focused ? "Remove from Focus" : "Add to Focus"}
        </ContextMenuItem>
        {workspace.environmentId ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={!gitSummary?.workspacePath}
              onSelect={() => {
                if (gitSummary?.workspacePath) {
                  void navigator.clipboard.writeText(gitSummary.workspacePath);
                }
              }}
            >
              <Icon name="Copy" aria-hidden />
              Copy path
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => onRequestRename(workspace, "display")}
            >
              <Icon name="Edit" aria-hidden />
              Rename sidebar label…
            </ContextMenuItem>
            {isWorktree ? (
              <>
                <ContextMenuItem
                  onSelect={() => onRequestRename(workspace, "branch")}
                >
                  <Icon name="GitBranch" aria-hidden />
                  Rename branch…
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => onRequestRename(workspace, "folder")}
                >
                  <Icon name="Folder" aria-hidden />
                  Rename folder…
                </ContextMenuItem>
              </>
            ) : null}
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={archivePending}
              className="text-destructive focus:bg-destructive/15 focus:text-destructive data-[last-hovered]:bg-destructive/15 data-[last-hovered]:text-destructive"
              onSelect={() => onRequestArchive(workspace)}
            >
              <Icon name="Archive" aria-hidden />
              Archive workspace
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function WorkspaceDragPreview({
  workspace,
}: {
  workspace: ConductorWorkspace;
}) {
  const signal = workspaceSignal(workspace.threads);
  const statusLabel = signalLabel(signal);

  return (
    <div className="conductor-workspace-drag-preview" aria-hidden>
      <div className="conductor-workspace-row">
        <PixelMatrix
          signal={signal}
          label={statusLabel ? `${statusLabel} workspace` : undefined}
        />
        <span className="conductor-workspace-copy">
          <span className="conductor-workspace-title">{workspace.title}</span>
          <WorkspaceMetadata
            branchLabel={
              workspace.branchName ??
              `${workspace.threads.length} conversation${workspace.threads.length === 1 ? "" : "s"}`
            }
            signal={signal}
            summary={null}
            pullRequest={null}
          />
        </span>
      </div>
    </div>
  );
}

function ProjectDragPreview({
  project,
  customization,
}: {
  project: ConductorProject;
  customization: ProjectCustomization | undefined;
}) {
  const signal = workspaceSignal(
    project.workspaces.flatMap((workspace) => workspace.threads),
  );
  const projectLabel =
    customization?.name ?? project.repositoryName ?? project.name;
  const projectIcon = customization?.icon ?? null;

  return (
    <div className="conductor-project-drag-preview" aria-hidden>
      {projectIcon ? (
        projectIcon.kind === "emoji" ? (
          <span className="conductor-project-glyph conductor-project-glyph--emoji">
            {projectIcon.value}
          </span>
        ) : (
          <ProjectGlyphIcon
            name={projectIcon.name}
            className="conductor-project-glyph"
            aria-hidden
          />
        )
      ) : (
        <Icon
          name="Folder"
          className="size-3.5 text-muted-foreground"
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-foreground">
        {projectLabel}
      </span>
      <PixelMatrix signal={signal} />
    </div>
  );
}

function ProjectSection({
  project,
  gitSummaries,
  customization,
  githubAccountLogin,
  githubAccounts,
  activeThreadId,
  collapsed,
  archivePending,
  dragDisabled,
  isDropTarget,
  dropTargetWorkspaceKey,
  workspaceDragDisabled,
  jumpShortcuts,
  showJumpShortcuts,
  onToggle,
  onCreate,
  onCreateConversation,
  onOpen,
  onOpenGithubAttention,
  onRequestArchive,
  onRequestRename,
  onSetRead,
  onSetFocused,
  onRequestRenameProject,
  onOpenDetails,
  onRequestChangeIcon,
  onRequestGithubCatalog,
  onSetGithubAccount,
  sidebarSpaces,
  githubAttention,
}: {
  project: ConductorProject;
  gitSummaries: ReadonlyMap<string, WorkspaceGitSummary>;
  customization: ProjectCustomization | undefined;
  githubAccountLogin: string | null;
  githubAccounts: readonly GithubAccountOption[];
  activeThreadId: string | null;
  collapsed: boolean;
  archivePending: boolean;
  dragDisabled: boolean;
  isDropTarget: boolean;
  dropTargetWorkspaceKey: string | null;
  workspaceDragDisabled: boolean;
  jumpShortcuts: ReadonlyMap<
    string,
    { ariaKeyshortcuts: string; label: string }
  >;
  showJumpShortcuts: boolean;
  onToggle: () => void;
  onCreate: () => void;
  onCreateConversation: (workspace: ConductorWorkspace) => void;
  onOpen: (threadId: string, options?: { split?: boolean }) => void;
  onOpenGithubAttention: (threadId: string) => void;
  onRequestArchive: (workspace: ConductorWorkspace) => void;
  onRequestRename: (workspace: ConductorWorkspace, scope: RenameScope) => void;
  onSetRead: (workspace: ConductorWorkspace, read: boolean) => void;
  onSetFocused: (workspace: ConductorWorkspace, focused: boolean) => void;
  onRequestRenameProject: () => void;
  onOpenDetails: () => void;
  onRequestChangeIcon: () => void;
  onRequestGithubCatalog: () => void;
  onSetGithubAccount: (accountLogin: string | null) => void;
  sidebarSpaces: SidebarSpaces | null;
  githubAttention: ConductorGithubAttention | null;
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
    opacity: isDragging ? 0.24 : undefined,
  };
  const contentId = `conductor-project-${project.id}`;
  const signal = workspaceSignal(
    project.workspaces.flatMap((workspace) => workspace.threads),
  );
  const projectLabel =
    customization?.name ?? project.repositoryName ?? project.name;
  const projectIcon = customization?.icon ?? null;
  const projectIconNode = projectIcon ? (
    projectIcon.kind === "emoji" ? (
      <span
        className="conductor-project-glyph conductor-project-glyph--emoji"
        aria-hidden
      >
        {projectIcon.value}
      </span>
    ) : (
      <ProjectGlyphIcon
        name={projectIcon.name}
        className="conductor-project-glyph"
        aria-hidden
      />
    )
  ) : null;

  return (
    <section
      ref={setNodeRef}
      style={style}
      className="conductor-project-sortable min-w-0"
      data-expanded={!collapsed || undefined}
      data-dragging={isDragging || undefined}
      data-drop-target={isDropTarget || undefined}
      aria-label={projectLabel}
    >
      <ContextMenu onOpenChange={(open) => open && onRequestGithubCatalog()}>
        <ContextMenuTrigger asChild>
          <div className="min-w-0">
            <SectionHeader
              title={projectLabel}
              meta={
                githubAccountLogin ? (
                  <span className="max-w-24 truncate text-2xs font-normal text-muted-foreground">
                    @{githubAccountLogin}
                  </span>
                ) : null
              }
              icon={projectIconNode}
              contentId={contentId}
              collapsed={collapsed}
              signal={signal}
              onToggle={onToggle}
              onCreate={onCreate}
              createLabel={`New workspace in ${projectLabel}`}
              dragBindings={{ attributes, listeners, setActivatorNodeRef }}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent aria-label={`${projectLabel} actions`}>
          <ContextMenuItem onSelect={onOpenDetails}>
            <Icon name="Info" aria-hidden />
            Details
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={onRequestRenameProject}>
            <Icon name="Edit" aria-hidden />
            Rename…
          </ContextMenuItem>
          <ContextMenuItem onSelect={onRequestChangeIcon}>
            <Icon name="Palette" aria-hidden />
            Change icon…
          </ContextMenuItem>
          {sidebarSpaces && sidebarSpaces.spaces.length > 1 ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Icon name="Layers" aria-hidden />
                Move to Space
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {sidebarSpaces.spaces.map((space) => (
                  <ContextMenuItem
                    key={space.id}
                    disabled={space.projectIds.includes(project.id)}
                    onSelect={() =>
                      sidebarSpaces.moveProject(project.id, space.id)
                    }
                  >
                    {space.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Icon name="Github" aria-hidden />
              GitHub Account
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {githubAccounts.length === 0 ? (
                <ContextMenuItem disabled>
                  No authenticated accounts
                </ContextMenuItem>
              ) : (
                <ContextMenuRadioGroup
                  value={githubAccountLogin ?? "__none__"}
                  onValueChange={(value) =>
                    onSetGithubAccount(value === "__none__" ? null : value)
                  }
                >
                  {githubAccounts.map((account) => (
                    <ContextMenuRadioItem
                      key={account.login}
                      value={account.login}
                    >
                      @{account.login}
                    </ContextMenuRadioItem>
                  ))}
                  <ContextMenuRadioItem value="__none__">
                    Not set
                  </ContextMenuRadioItem>
                </ContextMenuRadioGroup>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>
      <SectionContent id={contentId} collapsed={collapsed}>
        <SortableContext
          items={project.workspaces.map((workspace) =>
            workspaceDndId(workspace.key),
          )}
          strategy={verticalListSortingStrategy}
        >
          <div className="conductor-workspace-list space-y-0.5">
            {project.workspaces.map((workspace) => (
              <WorkspaceRow
                key={workspace.key}
                workspace={workspace}
                gitSummary={
                  workspace.environmentId
                    ? (gitSummaries.get(workspace.environmentId) ?? null)
                    : null
                }
                activeThreadId={activeThreadId}
                archivePending={archivePending}
                dragDisabled={
                  workspaceDragDisabled || project.workspaces.length < 2
                }
                focused={false}
                isDropTarget={dropTargetWorkspaceKey === workspace.key}
                shortcutEnabled={!collapsed}
                jumpShortcut={jumpShortcuts.get(workspace.key) ?? null}
                showJumpShortcut={showJumpShortcuts}
                onCreateConversation={onCreateConversation}
                onOpen={onOpen}
                onOpenGithubAttention={onOpenGithubAttention}
                onRequestArchive={onRequestArchive}
                onRequestRename={onRequestRename}
                onSetRead={onSetRead}
                onSetFocused={onSetFocused}
                githubAttention={githubAttention}
              />
            ))}
          </div>
        </SortableContext>
      </SectionContent>
    </section>
  );
}

function SpaceRepositoryEmptyState({
  activeSpace,
  customizations,
  onAddRepository,
  onMoveProjects,
  projects,
  spaces,
}: {
  activeSpace: SidebarSpaces["spaces"][number];
  customizations: Readonly<Record<string, ProjectCustomization>>;
  onAddRepository: () => void;
  onMoveProjects: (projectIds: readonly string[], spaceId: string) => void;
  projects: readonly ConductorProject[];
  spaces: SidebarSpaces["spaces"];
}) {
  const [selectedProjectIds, setSelectedProjectIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const selectedCount = selectedProjectIds.size;
  const allSelected = selectedCount === projects.length;

  const toggleProject = (projectId: string) => {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  return (
    <section
      className="conductor-space-empty"
      aria-label={`${activeSpace.name} repositories`}
    >
      <span className="conductor-space-empty-icon" aria-hidden>
        <Icon name="Layers" className="size-4" />
      </span>
      <div className="min-w-0">
        <h2>This Space has no repositories</h2>
        <p>Move a repository here to keep this Space focused.</p>
      </div>
      {projects.length > 0 ? (
        <>
          <div className="conductor-space-empty-selection">
            <span>
              {selectedCount > 0
                ? `${selectedCount} selected`
                : `${projects.length} available`}
            </span>
            <button
              type="button"
              onClick={() =>
                setSelectedProjectIds(
                  allSelected
                    ? new Set()
                    : new Set(projects.map((project) => project.id)),
                )
              }
            >
              {allSelected ? "Clear" : "Select all"}
            </button>
          </div>
          <ul className="conductor-space-empty-list">
            {projects.map((project) => {
              const label =
                customizations[project.id]?.name ??
                project.repositoryName ??
                project.name;
              const sourceSpace = spaces.find((space) =>
                space.projectIds.includes(project.id),
              );
              const selected = selectedProjectIds.has(project.id);
              return (
                <li key={project.id}>
                  <label data-selected={selected || undefined}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleProject(project.id)}
                    />
                    <Icon name="Folder" className="size-3.5" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-left">
                      <span className="block truncate font-medium">
                        {label}
                      </span>
                      {sourceSpace ? (
                        <span className="block truncate text-2xs text-muted-foreground">
                          From {sourceSpace.name}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <Button
            type="button"
            size="sm"
            disabled={selectedCount === 0}
            className="conductor-space-empty-submit"
            onClick={() =>
              onMoveProjects([...selectedProjectIds], activeSpace.id)
            }
          >
            Move {selectedCount || "selected"}{" "}
            {selectedCount === 1 ? "repository" : "repositories"}
            <Icon name="ArrowRight" className="size-3.5" aria-hidden />
          </Button>
        </>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onAddRepository}
        >
          <Icon name="Plus" className="size-3.5" aria-hidden />
          Add repository
        </Button>
      )}
    </section>
  );
}

function FocusSection({
  workspaces,
  gitSummaries,
  activeThreadId,
  archivePending,
  collapsed,
  jumpShortcuts,
  showJumpShortcuts,
  onToggle,
  onCreateConversation,
  onOpen,
  onOpenGithubAttention,
  onRequestArchive,
  onRequestRename,
  onSetRead,
  onSetFocused,
  githubAttentionByProjectId,
}: {
  workspaces: readonly ConductorWorkspace[];
  gitSummaries: ReadonlyMap<string, WorkspaceGitSummary>;
  activeThreadId: string | null;
  archivePending: boolean;
  collapsed: boolean;
  jumpShortcuts: ReadonlyMap<
    string,
    { ariaKeyshortcuts: string; label: string }
  >;
  showJumpShortcuts: boolean;
  onToggle: () => void;
  onCreateConversation: (workspace: ConductorWorkspace) => void;
  onOpen: (threadId: string, options?: { split?: boolean }) => void;
  onOpenGithubAttention: (threadId: string) => void;
  onRequestArchive: (workspace: ConductorWorkspace) => void;
  onRequestRename: (workspace: ConductorWorkspace, scope: RenameScope) => void;
  onSetRead: (workspace: ConductorWorkspace, read: boolean) => void;
  onSetFocused: (workspace: ConductorWorkspace, focused: boolean) => void;
  githubAttentionByProjectId: Readonly<
    Record<string, ConductorGithubAttention | undefined>
  >;
}) {
  if (workspaces.length === 0) return null;

  return (
    <section className="conductor-focus-section min-w-0" aria-label="Focus">
      <button
        type="button"
        className="conductor-focus-heading"
        aria-expanded={!collapsed}
        aria-controls="conductor-focus-workspaces"
        onClick={onToggle}
      >
        <span>Focus</span>
        <Icon
          name="ChevronDown"
          className="conductor-section-caret size-3 text-muted-foreground"
          aria-hidden
        />
      </button>
      <SectionContent id="conductor-focus-workspaces" collapsed={collapsed}>
        <SortableContext
          items={workspaces.map((workspace) => workspaceDndId(workspace.key))}
          strategy={verticalListSortingStrategy}
        >
          <div className="conductor-workspace-list space-y-0.5">
            {workspaces.map((workspace) => (
              <WorkspaceRow
                key={workspace.key}
                workspace={workspace}
                gitSummary={
                  workspace.environmentId
                    ? (gitSummaries.get(workspace.environmentId) ?? null)
                    : null
                }
                activeThreadId={activeThreadId}
                archivePending={archivePending}
                dragDisabled
                focused
                isDropTarget={false}
                shortcutEnabled={!collapsed}
                jumpShortcut={jumpShortcuts.get(workspace.key) ?? null}
                showJumpShortcut={showJumpShortcuts}
                onCreateConversation={onCreateConversation}
                onOpen={onOpen}
                onOpenGithubAttention={onOpenGithubAttention}
                onRequestArchive={onRequestArchive}
                onRequestRename={onRequestRename}
                onSetRead={onSetRead}
                onSetFocused={onSetFocused}
                githubAttention={
                  githubAttentionByProjectId[
                    workspace.threads[0]?.projectId ?? ""
                  ] ?? null
                }
              />
            ))}
          </div>
        </SortableContext>
      </SectionContent>
    </section>
  );
}

export function ConductorSidebar({
  activeThreadId,
  experimental_spaces: sidebarSpaces,
  isCompactViewport,
  onNavigate,
  searchQuery,
  githubAttentionByProjectId = {},
  onOpenGithubAttention,
}: PluginThreadListProps & {
  githubAttentionByProjectId?: Readonly<
    Record<string, ConductorGithubAttention | undefined>
  >;
  onOpenGithubAttention?: (threadId: string) => void;
}) {
  const state = useSidebarThreads();
  const actions = useSidebarThreadActions();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof conductorRpcContract>();
  const { isLoading, legacyWorkspaces, record } = useReconciliation();
  const [collapsedSections, setCollapsedSections] = useState(
    loadCollapsedSections,
  );
  const [projectOrder, setProjectOrder] = useState(loadProjectOrder);
  const [workspaceOrders, setWorkspaceOrders] = useState(loadWorkspaceOrders);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(
    null,
  );
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameThread, setRenameThread] = useState<PluginSidebarThread | null>(
    null,
  );
  const [customizations, setCustomizations] = useState(
    loadProjectCustomizations,
  );
  const [renameProjectTarget, setRenameProjectTarget] =
    useState<ProjectRenameTarget | null>(null);
  const [projectIconTarget, setProjectIconTarget] =
    useState<ProjectIconTarget | null>(null);
  const [githubCatalog, setGithubCatalog] = useState<GithubCatalog | null>(
    null,
  );
  const [addRepositoryOpen, setAddRepositoryOpen] = useState(false);
  const [addRepositoryPending, setAddRepositoryPending] = useState(false);
  const [projectAccountOverrides, setProjectAccountOverrides] = useState<
    Readonly<Record<string, string | null>>
  >({});
  const [gitSummaries, setGitSummaries] = useState<
    ReadonlyMap<string, WorkspaceGitSummary>
  >(() => new Map());
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      // Let normal finger movement scroll the panel. A steady hold starts reorder.
      activationConstraint: { delay: 300, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const projection = useMemo(
    () =>
      buildConductorProjection(state.threads, state.projects, legacyWorkspaces),
    [legacyWorkspaces, state.projects, state.threads],
  );
  const activeSpace =
    sidebarSpaces?.spaces.find(
      (space) => space.id === sidebarSpaces.activeSpaceId,
    ) ?? null;
  const activeSpaceProjectIds = activeSpace
    ? new Set(activeSpace.projectIds)
    : null;
  const spaceProjects = activeSpaceProjectIds
    ? projection.projects.filter((project) =>
        activeSpaceProjectIds.has(project.id),
      )
    : projection.projects;
  const loadGithubCatalog = useCallback(async () => {
    const catalog = await rpc.call("readGithubCatalog", {});
    setGithubCatalog(catalog);
  }, [rpc]);

  async function createGithubProject(
    repository: GithubRepositoryOption,
    accountLogin: string | null,
  ) {
    if (!githubCatalog) {
      throw new Error("GitHub repository catalog is not loaded");
    }
    setAddRepositoryPending(true);
    try {
      await rpc.call("createGithubProject", {
        accountLogin,
        hostId: githubCatalog.hostId,
        name: repository.nameWithOwner,
        remoteUrl: repository.url,
      });
    } finally {
      setAddRepositoryPending(false);
    }
  }

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

  useEffect(() => {
    if (state.status !== "ready" || isLoading) return;
    const normalized = Object.fromEntries(
      projection.projects.map((project) => [
        project.id,
        orderWorkspaceKeys(
          project.workspaces.map((workspace) => workspace.key),
          workspaceOrders[project.id] ?? [],
        ),
      ]),
    );
    if (workspaceOrdersEqual(normalized, workspaceOrders)) return;
    setWorkspaceOrders(normalized);
    saveWorkspaceOrders(normalized);
  }, [isLoading, projection.projects, state.status, workspaceOrders]);

  const query = searchQuery.trim().toLocaleLowerCase();
  const personalThreads = projection.personalThreads.filter((thread) =>
    query
      ? threadDisplayTitle(thread).toLocaleLowerCase().includes(query)
      : true,
  );
  const projectById = new Map(
    spaceProjects.map((project) => [project.id, project]),
  );
  const orderedProjects = orderProjectIds(
    spaceProjects.map((project) => project.id),
    projectOrder,
  )
    .map((id) => projectById.get(id))
    .filter((project): project is ConductorProject => project !== undefined)
    .map((project) => {
      const projectMatches = [
        project.name,
        project.repositoryName ?? "",
        customizations[project.id]?.name ?? "",
      ].some((value) => value.toLocaleLowerCase().includes(query));
      return {
        ...project,
        workspaces: orderWorkspaceKeys(
          project.workspaces.map((workspace) => workspace.key),
          workspaceOrders[project.id] ?? [],
        )
          .map((workspaceKey) =>
            project.workspaces.find(
              (workspace) => workspace.key === workspaceKey,
            ),
          )
          .filter((workspace): workspace is ConductorWorkspace => {
            if (!workspace) return false;
            if (!query || projectMatches) return true;
            return [
              workspace.title,
              workspace.branchName ?? "",
              ...workspace.threads.map(threadDisplayTitle),
            ].some((value) => value.toLocaleLowerCase().includes(query));
          }),
      };
    })
    .filter((project) => {
      if (!query) return true;
      return (
        project.workspaces.length > 0 ||
        [
          project.name,
          project.repositoryName ?? "",
          customizations[project.id]?.name ?? "",
        ].some((value) => value.toLocaleLowerCase().includes(query))
      );
    });

  const focusedWorkspaces = orderedProjects.flatMap((project) =>
    project.workspaces.filter((workspace) =>
      workspace.threads.some((thread) => thread.isPinned),
    ),
  );
  const projects = orderedProjects
    .map((project) => ({
      ...project,
      workspaces: project.workspaces.filter(
        (workspace) => !workspace.threads.some((thread) => thread.isPinned),
      ),
    }))
    .filter((project) => project.workspaces.length > 0);
  const focusCollapsed = query ? false : collapsedSections.has("focus");

  const visibleWorkspaces = [
    ...(focusCollapsed ? [] : focusedWorkspaces),
    ...projects.flatMap((project) =>
      query || !collapsedSections.has(`project:${project.id}`)
        ? project.workspaces
        : [],
    ),
  ];
  const visibleEnvironmentSignature = [
    ...new Set(
      visibleWorkspaces.flatMap((workspace) =>
        workspace.environmentId ? [workspace.environmentId] : [],
      ),
    ),
  ]
    .sort()
    .slice(0, 50)
    .join("\u0000");

  useEffect(() => {
    if (!visibleEnvironmentSignature) {
      setGitSummaries(new Map());
      return;
    }
    let cancelled = false;
    const environmentIds = visibleEnvironmentSignature.split("\u0000");
    const refresh = async () => {
      const result = await rpc.call("readWorkspaceGitSummaries", {
        environmentIds,
      });
      if (cancelled) return;
      setGitSummaries(
        new Map(
          result.summaries.map((summary) => [summary.environmentId, summary]),
        ),
      );
    };
    void refresh().catch(() => undefined);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh().catch(() => undefined);
      }
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [rpc, visibleEnvironmentSignature]);
  // Digit assignments mirror the jump handler below: 1–8 in visible order and
  // 9 for the last row. Held long enough, the chord modifier reveals them as
  // pills — the same affordance bb's own chrome uses for its shortcuts.
  const jumpShortcutByWorkspaceKey = new Map<
    string,
    { ariaKeyshortcuts: string; label: string }
  >(
    visibleWorkspaces.flatMap((workspace, index) => {
      const digit = workspaceJumpDigitForIndex(index, visibleWorkspaces.length);
      return digit === null
        ? []
        : [[workspace.key, jumpShortcutPresentation(digit)] as const];
    }),
  );
  const showJumpShortcuts = useShortcutHintModifierHeld();

  const activeWorkspaceKey = dragState
    ? workspaceKeyFromDndId(dragState.activeId)
    : null;
  const overWorkspaceKey = dragState?.overId
    ? workspaceKeyFromDndId(dragState.overId)
    : null;
  const activeWorkspaceProjectId = activeWorkspaceKey
    ? projection.projects.find((project) =>
        project.workspaces.some(
          (workspace) => workspace.key === activeWorkspaceKey,
        ),
      )?.id
    : null;
  const overWorkspaceProjectId = overWorkspaceKey
    ? projection.projects.find((project) =>
        project.workspaces.some(
          (workspace) => workspace.key === overWorkspaceKey,
        ),
      )?.id
    : null;
  const dropTargetWorkspaceKey =
    activeWorkspaceProjectId &&
    activeWorkspaceProjectId === overWorkspaceProjectId &&
    overWorkspaceKey !== activeWorkspaceKey
      ? overWorkspaceKey
      : null;
  const draggedWorkspace = activeWorkspaceKey
    ? projection.projects
        .flatMap((project) => project.workspaces)
        .find((workspace) => workspace.key === activeWorkspaceKey)
    : null;
  const draggedProject = dragState?.activeId
    ? (projects.find((project) => project.id === dragState.activeId) ?? null)
    : null;
  const dropTargetProjectId =
    draggedProject &&
    dragState?.overId &&
    dragState.overId !== draggedProject.id &&
    projects.some((project) => project.id === dragState.overId)
      ? dragState.overId
      : null;

  const jumpDialogOpen =
    renameTarget !== null ||
    renameThread !== null ||
    archiveTarget !== null ||
    renameProjectTarget !== null ||
    projectIconTarget !== null ||
    addRepositoryOpen;
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

  function openThread(threadId: string, options?: { split?: boolean }) {
    actions.open(threadId, options);
    onNavigate();
  }

  function openGithubAttention(threadId: string) {
    onOpenGithubAttention?.(threadId);
    openThread(threadId);
  }

  function createWorkspaceConversation(workspace: ConductorWorkspace) {
    if (!workspace.environmentId) return;
    const target = pickWorkspaceThread(workspace, activeThreadId);
    actions.openNewThread({
      projectId: target?.projectId,
      focusPrompt: true,
      experimental_sameEnvironment: {
        environmentId: workspace.environmentId,
        locked: true,
      },
    });
    onNavigate();
  }

  function requestSetGithubAccount(
    project: ConductorProject,
    accountLogin: string | null,
  ) {
    const previous = projectAccountOverrides[project.id];
    setProjectAccountOverrides((current) => ({
      ...current,
      [project.id]: accountLogin,
    }));
    void rpc
      .call("setProjectGithubAccount", {
        accountLogin,
        projectId: project.id,
      })
      .catch(() => {
        setProjectAccountOverrides((current) => {
          const next = { ...current };
          if (previous === undefined) delete next[project.id];
          else next[project.id] = previous;
          return next;
        });
      });
  }

  function updateCustomization(
    projectId: string,
    patch: Partial<ProjectCustomization>,
  ) {
    setCustomizations((current) => {
      const next = patchProjectCustomization(current, projectId, patch);
      saveProjectCustomizations(next);
      return next;
    });
  }

  function requestRenameProject(project: ConductorProject) {
    const defaultName = project.repositoryName ?? project.name;
    const customName = customizations[project.id]?.name ?? null;
    setRenameProjectTarget({
      projectId: project.id,
      defaultName,
      currentName: customName ?? defaultName,
      hasOverride: customName !== null,
    });
  }

  function requestChangeProjectIcon(project: ConductorProject) {
    const customization = customizations[project.id];
    setProjectIconTarget({
      projectId: project.id,
      projectLabel:
        customization?.name ?? project.repositoryName ?? project.name,
      currentIcon: customization?.icon ?? null,
    });
  }

  function setWorkspaceFocused(
    workspace: ConductorWorkspace,
    focused: boolean,
  ) {
    const pinnedThreads = workspace.threads.filter((thread) => thread.isPinned);
    if (!focused) {
      for (const thread of pinnedThreads) {
        void actions.setPinned(thread.id, false);
      }
      return;
    }
    const target = pickWorkspaceThread(workspace, activeThreadId);
    if (target) void actions.setPinned(target.id, true);
  }

  function setWorkspaceRead(workspace: ConductorWorkspace, read: boolean) {
    const target = pickWorkspaceThread(workspace, activeThreadId);
    const threads = read
      ? workspace.threads.filter(
          (thread) => conversationSignal(thread) === "awaiting-reply",
        )
      : target
        ? [target]
        : [];
    const targets = threads.length > 0 ? threads : target ? [target] : [];
    for (const thread of targets) {
      void actions.setRead(thread.id, read);
    }
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
    const activeWorkspaceKey = workspaceKeyFromDndId(String(event.active.id));
    const overWorkspaceKey = event.over
      ? workspaceKeyFromDndId(String(event.over.id))
      : null;
    if (
      activeWorkspaceKey &&
      overWorkspaceKey &&
      activeWorkspaceKey !== overWorkspaceKey
    ) {
      const activeProject = projection.projects.find((project) =>
        project.workspaces.some(
          (workspace) => workspace.key === activeWorkspaceKey,
        ),
      );
      const overProject = projection.projects.find((project) =>
        project.workspaces.some(
          (workspace) => workspace.key === overWorkspaceKey,
        ),
      );
      if (!activeProject || activeProject.id !== overProject?.id) return;
      setWorkspaceOrders((current) => {
        const availableKeys = activeProject.workspaces.map(
          (workspace) => workspace.key,
        );
        const normalized = orderWorkspaceKeys(
          availableKeys,
          current[activeProject.id] ?? [],
        );
        const next = moveWorkspaceKey(
          normalized,
          activeWorkspaceKey,
          overWorkspaceKey,
        );
        const nextOrders = { ...current, [activeProject.id]: next };
        saveWorkspaceOrders(nextOrders);
        return nextOrders;
      });
      return;
    }
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

  function onDragEndWithFeedback(event: DragEndEvent) {
    setDragState(null);
    onDragEnd(event);
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
        <button
          type="button"
          className="flex min-h-8 items-center gap-2 rounded-md border border-dashed px-3 text-xs font-medium text-muted-foreground hover:border-solid hover:bg-state-hover hover:text-foreground"
          onClick={() => setAddRepositoryOpen(true)}
        >
          <Icon name="Plus" className="size-3.5" aria-hidden />
          Add repository
        </button>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={({ active }) =>
            setDragState({ activeId: String(active.id), overId: null })
          }
          onDragOver={({ active, over }) =>
            setDragState({
              activeId: String(active.id),
              overId: over ? String(over.id) : null,
            })
          }
          onDragCancel={() => setDragState(null)}
          onDragEnd={onDragEndWithFeedback}
        >
          <FocusSection
            workspaces={focusedWorkspaces}
            gitSummaries={gitSummaries}
            activeThreadId={activeThreadId}
            archivePending={archivePending}
            collapsed={focusCollapsed}
            jumpShortcuts={jumpShortcutByWorkspaceKey}
            showJumpShortcuts={showJumpShortcuts}
            onToggle={() => toggleSection("focus")}
            onCreateConversation={createWorkspaceConversation}
            onOpen={openThread}
            onOpenGithubAttention={openGithubAttention}
            onRequestArchive={(workspace) => {
              void requestArchive(workspace);
            }}
            onRequestRename={(workspace, scope) => {
              void requestRename(workspace, scope).catch(() => undefined);
            }}
            onSetRead={setWorkspaceRead}
            onSetFocused={setWorkspaceFocused}
            githubAttentionByProjectId={githubAttentionByProjectId}
          />
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
                  gitSummaries={gitSummaries}
                  customization={customizations[project.id]}
                  githubAccountLogin={
                    projectAccountOverrides[project.id] === undefined
                      ? project.githubAccountLogin
                      : projectAccountOverrides[project.id]
                  }
                  githubAccounts={accountsForRepository(
                    githubCatalog,
                    project.repositoryName,
                  )}
                  activeThreadId={activeThreadId}
                  collapsed={collapsed}
                  archivePending={archivePending}
                  dragDisabled={Boolean(query) || projects.length < 2}
                  isDropTarget={dropTargetProjectId === project.id}
                  dropTargetWorkspaceKey={dropTargetWorkspaceKey}
                  workspaceDragDisabled={Boolean(query)}
                  jumpShortcuts={jumpShortcutByWorkspaceKey}
                  showJumpShortcuts={showJumpShortcuts}
                  onToggle={() => toggleSection(sectionId)}
                  onCreate={() => {
                    actions.openNewThread({
                      projectId: project.id,
                      focusPrompt: true,
                      experimental_startGithubWorkflow: true,
                    });
                    onNavigate();
                  }}
                  onCreateConversation={createWorkspaceConversation}
                  onOpen={openThread}
                  onOpenGithubAttention={openGithubAttention}
                  onRequestArchive={(workspace) => {
                    void requestArchive(workspace);
                  }}
                  onRequestRename={(workspace, scope) => {
                    void requestRename(workspace, scope).catch(() => undefined);
                  }}
                  onSetRead={setWorkspaceRead}
                  onSetFocused={setWorkspaceFocused}
                  onRequestRenameProject={() => requestRenameProject(project)}
                  onOpenDetails={() =>
                    openRepositoryDetails(navigate, project.id)
                  }
                  onRequestChangeIcon={() => requestChangeProjectIcon(project)}
                  onRequestGithubCatalog={() => {
                    void loadGithubCatalog().catch(() => undefined);
                  }}
                  onSetGithubAccount={(accountLogin) =>
                    requestSetGithubAccount(project, accountLogin)
                  }
                  sidebarSpaces={sidebarSpaces ?? null}
                  githubAttention={
                    githubAttentionByProjectId[project.id] ?? null
                  }
                />
              );
            })}
          </SortableContext>
          <DragOverlay
            dropAnimation={{
              duration: 160,
              easing: "cubic-bezier(0.2, 0, 0, 1)",
            }}
          >
            {draggedProject ? (
              <ProjectDragPreview
                project={draggedProject}
                customization={customizations[draggedProject.id]}
              />
            ) : draggedWorkspace ? (
              <WorkspaceDragPreview workspace={draggedWorkspace} />
            ) : null}
          </DragOverlay>
        </DndContext>

        {activeSpace && spaceProjects.length === 0 && !query ? (
          <SpaceRepositoryEmptyState
            activeSpace={activeSpace}
            customizations={customizations}
            projects={projection.projects.filter(
              (project) => !activeSpaceProjectIds?.has(project.id),
            )}
            spaces={sidebarSpaces?.spaces ?? []}
            onAddRepository={() => setAddRepositoryOpen(true)}
            onMoveProjects={(projectIds, spaceId) =>
              sidebarSpaces?.moveProjects(projectIds, spaceId)
            }
          />
        ) : null}

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
                        onSetRead={(read) => {
                          void actions.setRead(thread.id, read);
                        }}
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
                          </span>
                          <SignalStatus signal={signal} />
                        </div>
                      </ConversationActionMenu>
                    </li>
                  );
                })}
              </ul>
            </SectionContent>
          </section>
        ) : null}

        {projects.length === 0 &&
        personalThreads.length === 0 &&
        (Boolean(query) || !activeSpace) ? (
          <p className="px-3 py-6 text-xs text-muted-foreground">
            {query ? "No matching conversations." : "No conversations yet."}
          </p>
        ) : null}
      </nav>
      <AddRepositoryDialog
        catalog={githubCatalog}
        open={addRepositoryOpen}
        pending={addRepositoryPending}
        onClose={() => setAddRepositoryOpen(false)}
        onCreate={createGithubProject}
        onLoad={loadGithubCatalog}
      />
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
      <RenameProjectDialog
        target={renameProjectTarget}
        onClose={() => setRenameProjectTarget(null)}
        onRename={(projectId, name) => updateCustomization(projectId, { name })}
      />
      <ProjectIconDialog
        target={projectIconTarget}
        onClose={() => setProjectIconTarget(null)}
        onSelect={(projectId, icon) => updateCustomization(projectId, { icon })}
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

function workspaceJumpDigitForIndex(
  index: number,
  count: number,
): number | null {
  if (count >= 9 && index === count - 1) return 9;
  return index < 8 ? index + 1 : null;
}

function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/u.test(navigator.platform)
  );
}

function jumpShortcutPresentation(digit: number): {
  ariaKeyshortcuts: string;
  label: string;
} {
  return isMacPlatform()
    ? { ariaKeyshortcuts: `Meta+${digit}`, label: `⌘ ${digit}` }
    : { ariaKeyshortcuts: `Control+${digit}`, label: `Ctrl + ${digit}` };
}

// Mirrors the hold-to-reveal behavior of bb's own shortcut hints: the bare
// chord modifier held for a beat reveals the hints; any other key or modifier
// dismisses them so ordinary chords never flash them.
const SHORTCUT_HINT_HOLD_DELAY_MS = 700;

function useShortcutHintModifierHeld(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = false;
    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (active) {
        active = false;
        setHeld(false);
      }
    };
    const isHintModifier = (key: string) =>
      key === "Control" || (isMacPlatform() && key === "Meta");
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isHintModifier(event.key)) {
        clear();
        return;
      }
      if (timer !== null || active) return;
      const otherModifierHeld =
        event.shiftKey ||
        event.altKey ||
        (event.key === "Meta" ? event.ctrlKey : event.metaKey);
      if (otherModifierHeld) {
        clear();
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        active = true;
        setHeld(true);
      }, SHORTCUT_HINT_HOLD_DELAY_MS);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (isHintModifier(event.key)) clear();
    };
    const handleBlur = () => clear();

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  return held;
}

function isJumpBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('[role="dialog"], [role="menu"]') !== null;
}
