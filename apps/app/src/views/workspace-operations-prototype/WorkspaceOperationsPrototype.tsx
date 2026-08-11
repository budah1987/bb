import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@bb/shared-ui/sheet";
import { Switch } from "@bb/shared-ui/switch";
import { cn } from "@bb/shared-ui/lib/utils";
import "./WorkspaceOperationsPrototype.css";

type WorkspaceState =
  | "working"
  | "waiting"
  | "ready"
  | "paused"
  | "attention"
  | "idle";

interface WorkspaceFixture {
  id: string;
  name: string;
  state: WorkspaceState;
  stateLabel: string;
  agents: number;
  activity: readonly number[];
  git: string;
  main: string | null;
  nested?: boolean;
}

interface RepositoryFixture {
  id: string;
  name: string;
  summary: string;
  icon: IconName;
  workspaces: readonly WorkspaceFixture[];
}

type DetailTab =
  | "overview"
  | "git"
  | "manager"
  | "memory"
  | "activity"
  | "settings";

type PrototypeSurface = "details" | "workspace";

const REPOSITORIES: readonly RepositoryFixture[] = [
  {
    id: "bbamir",
    name: "BBamir",
    summary: "main changed · 3 PRs · 1 failed check",
    icon: "FolderGit",
    workspaces: [
      {
        id: "feature-auth",
        name: "feature/auth",
        state: "working",
        stateLabel: "Working",
        agents: 3,
        activity: [1, 2, 3, 2, 3, 3, 2, 1, 2],
        git: "↑2 ↓1 · 4 changes · PR #82 ✓",
        main: "Main changed 18 minutes ago",
      },
      {
        id: "fix-sidebar",
        name: "fix/sidebar",
        state: "waiting",
        stateLabel: "Needs reply",
        agents: 1,
        activity: [0, 1, 2, 0, 1, 2, 0, 0, 1],
        git: "↑1 · Clean · PR #79 · Review requested",
        main: null,
      },
      {
        id: "sidebar-tests",
        name: "sidebar-tests",
        state: "working",
        stateLabel: "Working",
        agents: 1,
        activity: [0, 2, 3, 1, 3, 2, 0, 2, 3],
        git: "3 changes · No PR",
        main: null,
        nested: true,
      },
      {
        id: "docs-refresh",
        name: "docs-refresh",
        state: "ready",
        stateLabel: "Ready",
        agents: 0,
        activity: [0, 0, 1, 0, 0, 0, 0, 0, 0],
        git: "↑3 · Clean · PR #84 ✓",
        main: null,
      },
      {
        id: "experiment-ai",
        name: "experiment-ai",
        state: "paused",
        stateLabel: "Paused",
        agents: 0,
        activity: [0, 0, 1, 1, 0, 0, 0, 0, 0],
        git: "↓6 · 12 changes · No PR",
        main: "Main changed",
      },
      {
        id: "release-18",
        name: "release/1.8",
        state: "attention",
        stateLabel: "Needs attention",
        agents: 2,
        activity: [3, 2, 3, 1, 2, 2, 1, 0, 1],
        git: "↑5 ↓2 · Conflict · PR #80 ×",
        main: "Checks failed",
      },
    ],
  },
  {
    id: "synara",
    name: "Synara",
    summary: "main current · 2 PRs · checks passing",
    icon: "Layers",
    workspaces: [
      {
        id: "right-rail",
        name: "feature/right-rail",
        state: "working",
        stateLabel: "Working",
        agents: 2,
        activity: [1, 2, 2, 3, 3, 2, 1, 3, 3],
        git: "↑4 · 7 changes · PR #45 ✓",
        main: null,
      },
      {
        id: "annotation-sync",
        name: "annotation-sync",
        state: "waiting",
        stateLabel: "Agent waiting",
        agents: 1,
        activity: [0, 1, 2, 1, 0, 0, 1, 0, 0],
        git: "↑1 ↓2 · 2 changes",
        main: "Main changed",
      },
      {
        id: "mobile-layout",
        name: "mobile-layout",
        state: "ready",
        stateLabel: "Ready",
        agents: 0,
        activity: [0, 0, 1, 0, 0, 0, 0, 0, 0],
        git: "↑2 · Clean · PR #44 ✓",
        main: null,
      },
      {
        id: "search-index",
        name: "search-index",
        state: "idle",
        stateLabel: "Idle",
        agents: 0,
        activity: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        git: "Clean · No PR",
        main: null,
      },
      {
        id: "release-preview",
        name: "release-preview",
        state: "attention",
        stateLabel: "Checks failed",
        agents: 1,
        activity: [2, 3, 2, 3, 1, 1, 0, 0, 1],
        git: "↑6 · Clean · PR #41 ×",
        main: null,
      },
    ],
  },
  {
    id: "ghost",
    name: "Ghost",
    summary: "main changed · 1 conflict · 3 PRs",
    icon: "Github",
    workspaces: [
      {
        id: "editor-refresh",
        name: "editor-refresh",
        state: "working",
        stateLabel: "Working",
        agents: 3,
        activity: [1, 3, 3, 2, 3, 2, 3, 2, 1],
        git: "↑7 ↓1 · 14 changes · PR #214 ✓",
        main: "Main changed",
      },
      {
        id: "member-import",
        name: "member-import",
        state: "working",
        stateLabel: "Checks running",
        agents: 2,
        activity: [1, 2, 2, 1, 2, 2, 1, 1, 0],
        git: "↑3 · 6 changes · PR #209",
        main: null,
      },
      {
        id: "theme-api",
        name: "theme-api",
        state: "attention",
        stateLabel: "Conflict",
        agents: 1,
        activity: [2, 2, 1, 1, 0, 0, 0, 0, 0],
        git: "↑2 ↓4 · 5 changes · PR #201 ×",
        main: "Main changed",
      },
      {
        id: "docs-cleanup",
        name: "docs-cleanup",
        state: "ready",
        stateLabel: "Ready",
        agents: 0,
        activity: [0, 0, 1, 0, 0, 0, 0, 0, 0],
        git: "↑1 · Clean · PR #218 ✓",
        main: null,
      },
    ],
  },
  {
    id: "helmor",
    name: "Helmor",
    summary: "main current · 1 PR · clean",
    icon: "Workflow",
    workspaces: [
      {
        id: "daemon-events",
        name: "daemon-events",
        state: "working",
        stateLabel: "Working",
        agents: 2,
        activity: [1, 2, 3, 2, 3, 3, 2, 3, 2],
        git: "↑2 · 3 changes · PR #31 ✓",
        main: null,
      },
      {
        id: "cli-output",
        name: "cli-output",
        state: "ready",
        stateLabel: "Ready",
        agents: 0,
        activity: [0, 0, 1, 0, 0, 0, 0, 0, 0],
        git: "Clean · No PR",
        main: null,
      },
      {
        id: "websocket-test",
        name: "websocket-test",
        state: "idle",
        stateLabel: "Idle",
        agents: 0,
        activity: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        git: "↓1 · Clean · No PR",
        main: "Main changed",
      },
    ],
  },
  {
    id: "agent-toolkit",
    name: "Agent Toolkit",
    summary: "main changed · no pull requests",
    icon: "Toolbox",
    workspaces: [
      {
        id: "qmd-index",
        name: "qmd-index",
        state: "waiting",
        stateLabel: "Agent waiting",
        agents: 1,
        activity: [0, 1, 2, 1, 0, 0, 0, 1, 0],
        git: "↑1 ↓8 · 2 changes",
        main: "Main changed",
      },
      {
        id: "vault-sync",
        name: "vault-sync",
        state: "paused",
        stateLabel: "Paused",
        agents: 0,
        activity: [0, 0, 1, 0, 0, 0, 0, 0, 0],
        git: "↓3 · Clean · No PR",
        main: "Main changed",
      },
    ],
  },
];

const STATE_DOT_CLASS: Record<WorkspaceState, string> = {
  working: "bg-success",
  waiting: "bg-attention",
  ready: "bg-success/70",
  paused: "bg-muted-foreground/50",
  attention: "bg-destructive",
  idle: "border border-border bg-transparent",
};

const DETAIL_TABS: readonly { id: DetailTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "git", label: "Git" },
  { id: "manager", label: "Manager" },
  { id: "memory", label: "Memory" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];

const rowButtonClass =
  "w-full rounded-md text-left outline-none transition-colors hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring";

function ActivityMatrix({ values }: { values: readonly number[] }) {
  return (
    <span
      className="grid grid-cols-3 gap-px"
      aria-label="Recent agent activity"
      role="img"
    >
      {values.map((value, index) => (
        <span
          key={index}
          className={cn(
            "size-1 rounded-[1px]",
            value === 0 && "bg-muted-foreground/15",
            value === 1 && "bg-muted-foreground/35",
            value === 2 && "bg-foreground/55",
            value === 3 && "bg-foreground",
          )}
        />
      ))}
    </span>
  );
}

function WorkspaceCard({
  workspace,
  active,
  onOpen,
}: {
  workspace: WorkspaceFixture;
  active: boolean;
  onOpen(): void;
}) {
  const card = (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "page" : undefined}
      className={cn(
        rowButtonClass,
        "group flex min-w-0 items-start gap-2 px-2 py-2",
        workspace.nested && "ml-4 w-[calc(100%-1rem)]",
        active && "bg-state-active",
      )}
    >
      <span
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          STATE_DOT_CLASS[workspace.state],
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-foreground">
            {workspace.nested ? `↳ ${workspace.name}` : workspace.name}
          </span>
          {workspace.agents > 0 ? (
            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
              {workspace.agents} agent{workspace.agents === 1 ? "" : "s"}
            </span>
          ) : null}
          <ActivityMatrix values={workspace.activity} />
        </span>
        <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
          {workspace.stateLabel} · {workspace.git}
        </span>
        {workspace.main ? (
          <span
            className={cn(
              "mt-0.5 block truncate text-2xs",
              workspace.state === "attention"
                ? "text-destructive-text"
                : "text-warning-text",
            )}
          >
            {workspace.main}
          </span>
        ) : null}
      </span>
    </button>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent aria-label={`${workspace.name} actions`}>
        <ContextMenuItem onSelect={onOpen}>Open workspace</ContextMenuItem>
        <ContextMenuItem>Open in split</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem>View changes</ContextMenuItem>
        <ContextMenuItem disabled={!workspace.main}>
          Update from Main
        </ContextMenuItem>
        <ContextMenuItem>Open pull request</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem>Archive workspace</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ConductorNavigation({
  activeRepositoryId,
  activeWorkspaceId,
  onOpenDetails,
  onOpenDetailsInSplit,
  onOpenWorkspace,
}: {
  activeRepositoryId: string;
  activeWorkspaceId: string | null;
  onOpenDetails(repositoryId: string): void;
  onOpenDetailsInSplit(repositoryId: string): void;
  onOpenWorkspace(repositoryId: string, workspaceId: string): void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(["synara", "ghost", "helmor", "agent-toolkit"]),
  );
  const [query, setQuery] = useState("");
  const visibleRepositories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return REPOSITORIES;

    return REPOSITORIES.flatMap((repository) => {
      if (
        repository.name.toLowerCase().includes(normalizedQuery) ||
        repository.summary.toLowerCase().includes(normalizedQuery)
      ) {
        return [repository];
      }

      const workspaces = repository.workspaces.filter(
        (workspace) =>
          workspace.name.toLowerCase().includes(normalizedQuery) ||
          workspace.stateLabel.toLowerCase().includes(normalizedQuery) ||
          workspace.git.toLowerCase().includes(normalizedQuery),
      );
      return workspaces.length > 0 ? [{ ...repository, workspaces }] : [];
    });
  }, [query]);

  function toggleRepository(repositoryId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(repositoryId)) next.delete(repositoryId);
      else next.add(repositoryId);
      return next;
    });
  }

  return (
    <aside
      aria-label="Conductor navigation"
      className="flex h-full w-[292px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
        <Icon name="Layers" className="size-4" aria-hidden />
        <span className="text-sm font-semibold">Workspaces</span>
        <span className="min-w-0 flex-1" />
        <Button size="icon" variant="ghost" aria-label="Create repository">
          <Icon name="Plus" aria-hidden />
        </Button>
      </div>
      <div className="p-2">
        <label className="sr-only" htmlFor="prototype-repository-search">
          Search repositories and workspaces
        </label>
        <div className="relative">
          <Icon
            name="Search"
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="prototype-repository-search"
            className="h-8 bg-transparent pl-8 text-xs"
            placeholder="Search repositories and workspaces"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <div className="flex flex-col gap-2">
          {visibleRepositories.map((repository) => {
            const isCollapsed = query.trim()
              ? false
              : collapsed.has(repository.id);
            const isActive = activeRepositoryId === repository.id;
            return (
              <section key={repository.id} aria-label={repository.name}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div
                      className={cn(
                        "flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5",
                        isActive && !activeWorkspaceId && "bg-state-active",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleRepository(repository.id)}
                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${repository.name}`}
                        aria-expanded={!isCollapsed}
                      >
                        <Icon
                          name="ChevronDown"
                          className={cn(
                            "size-3 transition-transform motion-reduce:transition-none",
                            isCollapsed && "-rotate-90",
                          )}
                          aria-hidden
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenDetails(repository.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pr-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <Icon
                          name={repository.icon}
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                              {repository.name}
                            </span>
                            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                              {repository.workspaces.length}
                            </span>
                          </span>
                          <span className="block truncate text-2xs text-muted-foreground">
                            {repository.summary}
                          </span>
                        </span>
                      </button>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent aria-label={`${repository.name} actions`}>
                    <ContextMenuItem
                      onSelect={() => onOpenDetails(repository.id)}
                    >
                      Details
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => onOpenDetailsInSplit(repository.id)}
                    >
                      Open Details in Split
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem>New workspace</ContextMenuItem>
                    <ContextMenuItem>Fetch repository</ContextMenuItem>
                    <ContextMenuItem>Open on GitHub</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem>Repository settings</ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                {!isCollapsed ? (
                  <div className="mt-0.5 flex flex-col gap-0.5">
                    {repository.workspaces.map((workspace) => (
                      <WorkspaceCard
                        key={workspace.id}
                        workspace={workspace}
                        active={
                          activeRepositoryId === repository.id &&
                          activeWorkspaceId === workspace.id
                        }
                        onOpen={() =>
                          onOpenWorkspace(repository.id, workspace.id)
                        }
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
          {visibleRepositories.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-xs font-medium">No matching workspace</p>
              <p className="mt-1 text-2xs text-muted-foreground">
                Try a repository, branch, or state.
              </p>
              <Button
                className="prototype-tactile mt-3"
                size="sm"
                variant="ghost"
                onClick={() => setQuery("")}
              >
                Clear search
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function PaneHeader({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
      <div className="min-w-0 flex-1">{children}</div>
      {actions}
    </header>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-border-hairline py-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

function AttentionRow({
  icon,
  title,
  detail,
  action,
}: {
  icon: IconName;
  title: string;
  detail: string;
  action: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-border-hairline py-3 last:border-0">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-attention text-warning-text">
        <Icon name={icon} className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-foreground">
          {title}
        </span>
        <span className="block truncate text-2xs text-muted-foreground">
          {detail}
        </span>
      </span>
      <Button size="sm" variant="ghost">
        {action}
      </Button>
    </div>
  );
}

function OverviewPanel({ repository }: { repository: RepositoryFixture }) {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Needs attention
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Repository changes that can affect active work.
            </p>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            3 items
          </span>
        </div>
        <div className="mt-3 border-y border-border">
          <AttentionRow
            icon="GitBranch"
            title="Main changed in four workspaces"
            detail="Three updates are safe. feature/auth has an active agent."
            action="Review changes"
          />
          <AttentionRow
            icon="GitPullRequest"
            title="PR #80 has failed checks"
            detail="release/1.8 · integration-tests"
            action="Open checks"
          />
          <AttentionRow
            icon="MessageQuestion"
            title="One agent needs your reply"
            detail="fix/sidebar · waiting for layout direction"
            action="Open conversation"
          />
        </div>

        <div className="mt-9 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Workspaces
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Live state across {repository.name}.
            </p>
          </div>
          <Button size="sm" variant="outline">
            New workspace
          </Button>
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-border">
          {repository.workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              className="grid w-full grid-cols-[minmax(0,1fr)_110px_110px] items-center gap-3 border-b border-border-hairline px-3 py-2.5 text-left last:border-0 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    STATE_DOT_CLASS[workspace.state],
                  )}
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {workspace.name}
                  </span>
                  <span className="block truncate text-2xs text-muted-foreground">
                    {workspace.git}
                  </span>
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {workspace.stateLabel}
              </span>
              <span className="text-right text-xs tabular-nums text-muted-foreground">
                {workspace.agents > 0
                  ? `${workspace.agents} agent${workspace.agents === 1 ? "" : "s"}`
                  : "No agent"}
              </span>
            </button>
          ))}
        </div>
      </div>

      <aside className="min-w-0">
        <h2 className="text-xs font-semibold text-foreground">Repository</h2>
        <div className="mt-2 border-y border-border">
          <Metric label="Active workspaces" value="4" />
          <Metric label="Active agents" value="8" />
          <Metric label="Open pull requests" value="3" />
          <Metric label="Ready for review" value="4" />
        </div>
        <h2 className="mt-7 text-xs font-semibold text-foreground">
          Development servers
        </h2>
        <div className="mt-2 border-y border-border py-1">
          <RailLikeRow label="Web app" trailing=":3000" state="online" />
          <RailLikeRow label="API" trailing=":4000" state="online" />
          <RailLikeRow label="Storybook" trailing="Stopped" state="off" />
        </div>
        <h2 className="mt-7 text-xs font-semibold text-foreground">
          Related memory
        </h2>
        <div className="mt-2 border-y border-border py-1">
          <RailLikeRow label="Architecture decisions" trailing="18m" />
          <RailLikeRow label="Authentication notes" trailing="1h" />
          <RailLikeRow label="6 related sessions" trailing="" />
        </div>
      </aside>
    </div>
  );
}

function GitPanel() {
  const [updated, setUpdated] = useState(false);
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Repository Git
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Default branch: main · fetched 4 minutes ago
          </p>
        </div>
        <div className="flex items-center gap-2">
          {updated ? (
            <span className="text-xs text-success">3 updates queued</span>
          ) : null}
          <Button size="sm" variant="outline">
            Fetch
          </Button>
          <Button
            className="prototype-tactile"
            size="sm"
            onClick={() => setUpdated(true)}
          >
            Update eligible workspaces
          </Button>
        </div>
      </div>
      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] border-collapse text-left text-xs">
          <thead className="bg-surface-recessed text-2xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Workspace</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium">Main</th>
              <th className="px-3 py-2 font-medium">Changes</th>
              <th className="px-3 py-2 font-medium">Pull request</th>
              <th className="px-3 py-2 font-medium">Update</th>
            </tr>
          </thead>
          <tbody>
            {[
              [
                "feature/auth",
                "Working",
                "↑2 ↓1",
                "4 files",
                "#82 Passing",
                "Agent working",
              ],
              [
                "fix/sidebar",
                "Waiting",
                "↑1",
                "Clean",
                "#79 Review",
                "Eligible",
              ],
              [
                "sidebar-tests",
                "Working",
                "Current",
                "3 files",
                "—",
                "Agent working",
              ],
              [
                "docs-refresh",
                "Ready",
                "↑3",
                "Clean",
                "#84 Passing",
                "Eligible",
              ],
              ["experiment-ai", "Paused", "↓6", "12 files", "—", "Dirty"],
              [
                "release/1.8",
                "Attention",
                "↑5 ↓2",
                "8 files",
                "#80 Failed",
                "Conflict",
              ],
            ].map((row) => (
              <tr
                key={row[0]}
                className="border-t border-border-hairline hover:bg-state-hover"
              >
                {row.map((cell, index) => (
                  <td
                    key={cell}
                    className={cn(
                      "px-3 py-2.5 tabular-nums",
                      index === 0
                        ? "font-medium text-foreground"
                        : "text-muted-foreground",
                      index === 5 && cell === "Eligible" && "text-success",
                      index === 5 &&
                        cell === "Conflict" &&
                        "text-destructive-text",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="text-xs font-semibold">Recent main changes</h3>
          <div className="mt-2 border-y border-border">
            <ActivityLine time="8m" title="Update session API" meta="a73b92" />
            <ActivityLine time="42m" title="Merge PR #77" meta="33b016" />
            <ActivityLine
              time="2h"
              title="Add browser annotation events"
              meta="f195a0"
            />
          </div>
        </section>
        <section>
          <h3 className="text-xs font-semibold">Automatic updates</h3>
          <div className="mt-2 border-y border-border py-2">
            <SettingLine label="Clean inactive workspaces" checked />
            <SettingLine label="Published branches" checked={false} />
            <SettingLine label="Stop and notify on conflict" checked />
          </div>
        </section>
      </div>
    </div>
  );
}

function ManagerPanel() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Repository briefing</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Updated from verified repository data 4 minutes ago.
            </p>
          </div>
          <Button size="sm" variant="outline">
            Refresh
          </Button>
        </div>
        <div className="mt-5 border-y border-border">
          <AttentionRow
            icon="GitBranch"
            title="Three workspaces can update from main"
            detail="fix/sidebar, docs-refresh, and search-index are clean and inactive."
            action="Review"
          />
          <AttentionRow
            icon="ListTodo"
            title="Four annotations are ready for review"
            detail="All changes are available in the feature/auth preview."
            action="Review next"
          />
          <AttentionRow
            icon="MessageQuestion"
            title="fix/sidebar needs a decision"
            detail="The agent needs the compact breakpoint behavior."
            action="Reply"
          />
        </div>
        <form
          className="mt-8"
          onSubmit={(event) => {
            event.preventDefault();
            if (!question.trim()) return;
            setAnswer(
              "feature/auth has the clearest path to completion. Its checks pass, and four visual changes await your review.",
            );
            setQuestion("");
          }}
        >
          <label htmlFor="manager-question" className="text-xs font-semibold">
            Ask about this repository
          </label>
          <div className="mt-2 flex gap-2">
            <Input
              id="manager-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What needs my attention today?"
            />
            <Button className="prototype-tactile" type="submit">
              Ask
            </Button>
          </div>
        </form>
        {answer ? (
          <div className="mt-4 rounded-lg border border-border bg-surface-recessed p-4 text-sm leading-6">
            {answer}
            <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
              <button type="button" className="underline underline-offset-4">
                Open feature/auth
              </button>
              <button type="button" className="underline underline-offset-4">
                View supporting events
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <aside>
        <h3 className="text-xs font-semibold">Manager configuration</h3>
        <div className="mt-2 border-y border-border">
          <Metric label="Provider" value="OpenAI" />
          <Metric label="Model" value="GPT-5.4 mini" />
          <Metric label="Reasoning" value="Low" />
          <Metric label="Actions" value="Confirm" />
        </div>
        <Button className="mt-3 w-full" size="sm" variant="outline">
          Configure manager
        </Button>
      </aside>
    </div>
  );
}

function MemoryPanel() {
  const [query, setQuery] = useState("");
  const [openNote, setOpenNote] = useState<string | null>(null);
  const notes = [
    ["Architecture decisions", "Vault · Editable", "18 minutes ago"],
    ["Authentication notes", "Vault · Editable", "1 hour ago"],
    [".worktree-memory.md", "Workspace · Editable", "6 minutes ago"],
    ["Session: OAuth migration", "Session · Read-only", "Yesterday"],
    ["Browser feedback review", "Vault · Editable", "2 days ago"],
  ].filter(([title]) => title.toLowerCase().includes(query.toLowerCase()));

  if (openNote) {
    return (
      <div className="flex h-full min-h-0">
        <div className="min-w-0 flex-1 overflow-y-auto px-8 py-7">
          <button
            type="button"
            onClick={() => setOpenNote(null)}
            className="mb-6 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Icon name="ChevronLeft" className="size-3.5" aria-hidden />
            Related memory
          </button>
          <article className="mx-auto max-w-[68ch]">
            <h1 className="text-xl font-semibold">{openNote}</h1>
            <p className="mt-2 text-xs text-muted-foreground">
              Autosaved · Personal vault · Projects/BBamir
            </p>
            <div className="mt-7 space-y-5 text-sm leading-6">
              <p>
                BB keeps repository details separate from conversations. This
                preserves the workspace while making repository state easy to
                inspect.
              </p>
              <h2 className="text-base font-semibold">Current decisions</h2>
              <ul className="list-disc space-y-2 pl-5">
                <li>Repository names open the Repo Details pane.</li>
                <li>Workspace cards remain passive scan surfaces.</li>
                <li>Git actions live in the right rail and Repo Details.</li>
              </ul>
            </div>
          </article>
        </div>
        <aside className="hidden w-56 shrink-0 border-l border-border p-4 xl:block">
          <h2 className="text-xs font-semibold">Document</h2>
          <div className="mt-3 space-y-3 text-xs text-muted-foreground">
            <p>5 related notes</p>
            <p>3 backlinks</p>
            <p>#bbamir · #architecture</p>
          </div>
          <Button className="mt-5 w-full" size="sm" variant="outline">
            Open in Obsidian
          </Button>
        </aside>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Related memory</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Results from your vault, qmd index, and agent sessions.
          </p>
        </div>
        <Button size="sm" variant="outline">
          Open full vault
        </Button>
      </div>
      <label htmlFor="memory-search" className="sr-only">
        Search related memory
      </label>
      <div className="relative mt-5">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="memory-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-9"
          placeholder="Search related notes and sessions"
        />
      </div>
      <div className="mt-5 border-y border-border">
        {notes.length > 0 ? (
          notes.map(([title, source, modified]) => (
            <button
              key={title}
              type="button"
              onClick={() => setOpenNote(title)}
              className="flex w-full items-center gap-3 border-b border-border-hairline px-1 py-3 text-left last:border-0 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Icon
                name={source.includes("Session") ? "MessageSquare" : "File"}
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {title}
                </span>
                <span className="block truncate text-2xs text-muted-foreground">
                  {source}
                </span>
              </span>
              <span className="shrink-0 text-2xs text-muted-foreground">
                {modified}
              </span>
              <Icon name="ChevronRight" className="size-3" aria-hidden />
            </button>
          ))
        ) : (
          <div className="py-10 text-center">
            <p className="text-sm font-medium">No related memory found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a repository name, branch, decision, or session topic.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityLine({
  time,
  title,
  meta,
}: {
  time: string;
  title: string;
  meta: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border-hairline py-2.5 last:border-0">
      <span className="w-9 shrink-0 text-2xs tabular-nums text-muted-foreground">
        {time}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs">{title}</span>
      <span className="shrink-0 font-mono text-2xs text-muted-foreground">
        {meta}
      </span>
    </div>
  );
}

function ActivityPanel() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Repository activity</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Git, agent, server, review, and memory events.
          </p>
        </div>
        <Button size="sm" variant="outline">
          Filter
        </Button>
      </div>
      <div className="mt-5 border-y border-border">
        <ActivityLine
          time="10:42"
          title="feature/auth tests completed"
          meta="Agent"
        />
        <ActivityLine
          time="10:31"
          title="main received three commits"
          meta="Git"
        />
        <ActivityLine
          time="10:08"
          title="PR #82 passed all checks"
          meta="GitHub"
        />
        <ActivityLine
          time="09:54"
          title="Four annotations became ready"
          meta="Feedback"
        />
        <ActivityLine
          time="09:32"
          title="Web app restarted on port 3000"
          meta="Server"
        />
        <ActivityLine
          time="08:48"
          title="Architecture decisions updated"
          meta="Vault"
        />
      </div>
    </div>
  );
}

function SettingLine({ label, checked }: { label: string; checked: boolean }) {
  const [value, setValue] = useState(checked);
  return (
    <label className="flex min-h-9 items-center justify-between gap-4 px-1 text-xs">
      <span>{label}</span>
      <Switch checked={value} onCheckedChange={setValue} />
    </label>
  );
}

function SettingsPanel() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-6">
      <h2 className="text-base font-semibold">Repository settings</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Repository values override global BB defaults.
      </p>
      <div className="mt-7 grid gap-8 lg:grid-cols-2">
        <SettingsGroup title="Git updates">
          <SettingLine label="Automatic updates" checked />
          <SettingLine label="Clean inactive workspaces" checked />
          <SettingLine label="Published branches" checked={false} />
          <SettingLine label="Stop and notify on conflict" checked />
        </SettingsGroup>
        <SettingsGroup title="Development servers">
          <div className="flex min-h-10 items-center justify-between gap-4 px-1 text-xs">
            <span>Lifetime</span>
            <select className="rounded-md border border-input bg-background px-2 py-1.5 text-xs">
              <option>Keep running until stopped</option>
              <option>Stop after 30 minutes</option>
              <option>Stop when app closes</option>
            </select>
          </div>
          <SettingLine label="Agent can start servers" checked />
          <SettingLine label="Agent can restart servers" checked />
          <SettingLine label="Ask before stopping" checked />
        </SettingsGroup>
        <SettingsGroup title="Repository manager">
          <div className="flex min-h-9 items-center justify-between gap-4 px-1 text-xs">
            <span>Model</span>
            <span className="text-muted-foreground">GPT-5.4 mini</span>
          </div>
          <div className="flex min-h-9 items-center justify-between gap-4 px-1 text-xs">
            <span>Reasoning</span>
            <span className="text-muted-foreground">Low</span>
          </div>
          <SettingLine label="Refresh when details open" checked />
          <SettingLine label="Autonomous actions" checked={false} />
        </SettingsGroup>
        <SettingsGroup title="Browser feedback">
          <div className="flex min-h-10 items-center justify-between gap-4 px-1 text-xs">
            <span>Default send behavior</span>
            <select className="rounded-md border border-input bg-background px-2 py-1.5 text-xs">
              <option>Queue after current task</option>
              <option>Implement now</option>
              <option>Review and respond first</option>
            </select>
          </div>
          <SettingLine label="Keep drafts after app exit" checked />
          <SettingLine label="Require your review" checked />
        </SettingsGroup>
      </div>
    </div>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold">{title}</h3>
      <div className="mt-2 divide-y divide-border-hairline border-y border-border py-1">
        {children}
      </div>
    </section>
  );
}

function RepoDetailsPane({
  repository,
  initialTab,
  onOpenWorkspace,
}: {
  repository: RepositoryFixture;
  initialTab: DetailTab;
  onOpenWorkspace(): void;
}) {
  const [tab, setTab] = useState<DetailTab>(initialTab);
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <PaneHeader
        actions={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost">
              Fetch
            </Button>
            <Button className="prototype-tactile" size="sm" variant="outline">
              New workspace
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Repository actions"
                >
                  <Icon name="MoreHorizontal" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onOpenWorkspace}>
                  Open active workspace
                </DropdownMenuItem>
                <DropdownMenuItem>Open repository folder</DropdownMenuItem>
                <DropdownMenuItem>Open on GitHub</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Copy repository path</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      >
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            name={repository.icon}
            className="size-4 shrink-0"
            aria-hidden
          />
          <span className="truncate text-sm font-semibold">
            {repository.name}
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Repository Details
          </span>
        </div>
      </PaneHeader>
      <div className="shrink-0 overflow-x-auto border-b border-border px-3">
        <div
          role="tablist"
          aria-label="Repository details"
          className="flex min-w-max"
        >
          {DETAIL_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "relative px-3 py-2.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
                tab === item.id &&
                  "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "overview" ? <OverviewPanel repository={repository} /> : null}
        {tab === "git" ? <GitPanel /> : null}
        {tab === "manager" ? <ManagerPanel /> : null}
        {tab === "memory" ? <MemoryPanel /> : null}
        {tab === "activity" ? <ActivityPanel /> : null}
        {tab === "settings" ? <SettingsPanel /> : null}
      </div>
    </section>
  );
}

function RailLikeRow({
  label,
  trailing,
  state,
  onSelect,
}: {
  label: string;
  trailing: string;
  state?: "online" | "off" | "attention";
  onSelect?: () => void;
}) {
  const content = (
    <>
      {state ? (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            state === "online" && "bg-success",
            state === "off" && "bg-muted-foreground/30",
            state === "attention" && "bg-attention",
          )}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
        {trailing}
      </span>
    </>
  );
  const className =
    "flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground";
  return onSelect ? (
    <button
      type="button"
      onClick={onSelect}
      className={cn(className, "hover:bg-state-hover")}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function RailSection({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-t border-border-hairline first:border-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-2xs font-medium text-muted-foreground hover:bg-state-hover"
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {trailing ? <span className="tabular-nums">{trailing}</span> : null}
        <Icon
          name="ChevronRight"
          className={cn("size-3 transition-transform", open && "rotate-90")}
          aria-hidden
        />
      </button>
      {open ? <div className="pb-1">{children}</div> : null}
    </section>
  );
}

function FeedbackReview({ onFocusPin }: { onFocusPin(pin: number): void }) {
  const [items, setItems] = useState([
    { id: 1, title: "Login title spacing", state: "Ready for review" },
    { id: 2, title: "Submit button style", state: "Ready for review" },
    { id: 3, title: "Mobile menu alignment", state: "Needs your answer" },
    { id: 4, title: "Password helper text", state: "Ready for review" },
  ]);
  const ready = items.filter((item) => item.state === "Ready for review");
  const current = ready[0];
  return (
    <div className="px-1">
      <div className="flex items-center gap-3 px-2 py-1.5 text-2xs text-muted-foreground">
        <span>Active 2</span>
        <span className="font-medium tabular-nums text-foreground">
          Review {ready.length}
        </span>
        <span>Resolved 8</span>
      </div>
      {items.slice(0, 3).map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onFocusPin(item.id)}
          className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-state-hover"
        >
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border text-[9px] tabular-nums">
            {item.id}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-foreground">
              {item.title}
            </span>
            <span
              className={cn(
                "block truncate text-2xs",
                item.state === "Ready for review"
                  ? "text-success"
                  : "text-attention",
              )}
            >
              {item.state}
            </span>
          </span>
        </button>
      ))}
      <div className="flex gap-1 px-2 pb-2 pt-1">
        <Button
          className="flex-1"
          size="sm"
          variant="outline"
          disabled={!current}
          onClick={() => current && onFocusPin(current.id)}
        >
          Review next
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!current}
          onClick={() =>
            current &&
            setItems((value) => value.filter((item) => item.id !== current.id))
          }
        >
          Resolve
        </Button>
      </div>
    </div>
  );
}

function WorkspaceRail({
  focusedPin,
  onFocusPin,
}: {
  focusedPin: number | null;
  onFocusPin(pin: number): void;
}) {
  const [serverOnline, setServerOnline] = useState(true);
  return (
    <aside className="hidden w-72 shrink-0 border-l border-border bg-popover p-1.5 xl:block">
      <div className="px-2 py-2 text-xs font-semibold">Environment</div>
      <RailSection
        title="Local Servers"
        trailing={serverOnline ? "2 running" : "1 running"}
      >
        <RailLikeRow
          label="Web app"
          trailing={serverOnline ? ":3000" : "Stopped"}
          state={serverOnline ? "online" : "off"}
          onSelect={() => setServerOnline((value) => !value)}
        />
        <RailLikeRow label="API" trailing=":4000" state="online" />
      </RailSection>
      <RailSection title="Preview" trailing="Ready">
        <RailLikeRow label="localhost:3000/login" trailing="" />
      </RailSection>
      <RailSection title="Feedback" trailing="4 review">
        <FeedbackReview onFocusPin={onFocusPin} />
        {focusedPin ? (
          <div className="mx-2 mb-2 rounded-md bg-surface-recessed p-2 text-2xs text-muted-foreground">
            Pin {focusedPin} is focused in the browser.
          </div>
        ) : null}
      </RailSection>
      <RailSection title="Git" trailing="Main changed">
        <RailLikeRow label="4 changed files" trailing="" />
        <RailLikeRow label="Ahead 2 · Behind 1" trailing="" />
        <div className="flex gap-1 px-2 py-2">
          <Button
            className="prototype-tactile flex-1"
            size="sm"
            variant="outline"
          >
            Update from Main
          </Button>
        </div>
      </RailSection>
      <RailSection title="Memory" trailing="3 related">
        <RailLikeRow label="Architecture decisions" trailing="18m" />
        <RailLikeRow label="Authentication notes" trailing="1h" />
      </RailSection>
    </aside>
  );
}

function ConversationPane() {
  return (
    <section className="hidden min-w-[280px] flex-[0.7] flex-col border-r border-border lg:flex">
      <PaneHeader>
        <div>
          <div className="text-xs font-semibold">
            Update authentication flow
          </div>
          <div className="text-2xs text-muted-foreground">
            GPT-5.6 Terra · Working
          </div>
        </div>
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-[62ch] space-y-6 text-sm leading-6">
          <div className="rounded-lg bg-surface-recessed px-4 py-3">
            Update the login interface and keep the current authentication
            behavior.
          </div>
          <div>
            I updated the login layout and preserved the existing form behavior.
            Four visual changes are ready for review.
          </div>
          <div className="border-y border-border py-3 text-xs text-muted-foreground">
            Working on browser feedback · 2 minutes
          </div>
        </div>
      </div>
      <div className="border-t border-border p-3">
        <div className="rounded-lg border border-input bg-background px-3 py-2 text-xs text-muted-foreground">
          Message agent…
        </div>
      </div>
    </section>
  );
}

function BrowserPane({ initialDrafts = 0 }: { initialDrafts?: number }) {
  const [annotationMode, setAnnotationMode] = useState(initialDrafts > 0);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [focusedPin, setFocusedPin] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const visiblePins = Math.min(drafts, 4);

  function addDraft() {
    if (!annotationMode) return;
    setDrafts((value) => value + 1);
    setSent(false);
  }

  function sendDrafts() {
    setSent(true);
    setDrafts(0);
    setAnnotationMode(false);
  }

  return (
    <div className="flex min-w-0 flex-[1.3]">
      <section className="flex min-w-0 flex-1 flex-col bg-surface-recessed">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
          <Button size="icon" variant="ghost" aria-label="Go back">
            <Icon name="ChevronLeft" aria-hidden />
          </Button>
          <div className="min-w-0 flex-1 truncate rounded-md border border-input bg-surface-recessed px-3 py-1.5 text-xs text-muted-foreground">
            localhost:3000/login
          </div>
          <Button
            className="prototype-tactile"
            size="sm"
            variant={annotationMode ? "secondary" : "ghost"}
            aria-pressed={annotationMode}
            onClick={() => setAnnotationMode((value) => !value)}
          >
            <Icon name="ChatFeedback" aria-hidden />
            Annotate{drafts > 0 ? ` · ${drafts}` : ""}
          </Button>
        </div>
        <div className="relative min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
          <div className="mx-auto flex min-h-full max-w-3xl items-center justify-center">
            <div className="prototype-elevated-surface relative grid w-full overflow-hidden rounded-xl border bg-background md:grid-cols-[1fr_0.9fr]">
              <div className="hidden bg-surface-recessed p-10 md:block">
                <div className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  BBamir
                </div>
                <h1 className="mt-16 max-w-xs text-balance text-2xl font-semibold leading-tight">
                  Continue where your agents left off.
                </h1>
                <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
                  Your workspaces, conversations, and previews stay connected to
                  this machine.
                </p>
              </div>
              <div className="relative p-7 sm:p-10">
                <button
                  type="button"
                  onClick={addDraft}
                  className={cn(
                    "relative w-full text-left",
                    annotationMode &&
                      "cursor-crosshair rounded-md outline outline-1 outline-transparent hover:outline-attention",
                  )}
                >
                  <h2 className="text-xl font-semibold">Welcome back</h2>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Sign in to continue to BBamir.
                  </p>
                  {visiblePins >= 1 ? (
                    <AnnotationPin
                      number={1}
                      className="-right-3 -top-3"
                      focused={focusedPin === 1}
                    />
                  ) : null}
                </button>
                <div className="mt-8 space-y-4">
                  <label className="block text-xs font-medium">
                    Email address
                    <input
                      className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                      defaultValue="amir@example.com"
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Password
                    <input
                      type="password"
                      className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                      defaultValue="prototype"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={addDraft}
                    className={cn(
                      "prototype-tactile relative flex h-9 w-full items-center justify-center rounded-md bg-foreground text-sm font-medium text-background",
                      annotationMode &&
                        "cursor-crosshair outline outline-2 outline-attention/40",
                    )}
                  >
                    Sign in
                    {visiblePins >= 2 ? (
                      <AnnotationPin
                        number={2}
                        className="-right-3 -top-3"
                        focused={focusedPin === 2}
                      />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={addDraft}
                    className={cn(
                      "relative w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline",
                      annotationMode && "cursor-crosshair",
                    )}
                  >
                    Forgot your password?
                    {visiblePins >= 3 ? (
                      <AnnotationPin
                        number={3}
                        className="-right-3 -top-3"
                        focused={focusedPin === 3}
                      />
                    ) : null}
                  </button>
                </div>
                {visiblePins >= 4 ? (
                  <AnnotationPin
                    number={4}
                    className="right-4 top-1/2"
                    focused={focusedPin === 4}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
        {sent ? (
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-4 border-t border-border bg-background px-4 text-xs">
            <span className="text-success">
              Annotation batch queued after the current task.
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setSent(false)}
            >
              Dismiss
            </button>
          </div>
        ) : drafts > 0 ? (
          <div className="flex min-h-12 shrink-0 items-center gap-3 border-t border-border bg-background px-3">
            <span className="min-w-0 flex-1 text-xs tabular-nums">
              {drafts} draft comment{drafts === 1 ? "" : "s"}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setDrafts(0)}>
              Discard drafts
            </Button>
            <div className="flex items-center">
              <Button
                className="prototype-tactile rounded-r-none"
                size="sm"
                onClick={sendDrafts}
              >
                Send {drafts} to agent
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="rounded-l-none border-l border-background/25 px-2"
                    size="sm"
                    aria-label="Choose annotation send behavior"
                  >
                    <Icon name="ChevronDown" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem onSelect={sendDrafts}>
                    Implement now
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={sendDrafts}>
                    Queue after current task
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={sendDrafts}>
                    Review and respond first
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    Send to another conversation…
                  </DropdownMenuItem>
                  <DropdownMenuItem>Start a new conversation…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ) : null}
      </section>
      <WorkspaceRail focusedPin={focusedPin} onFocusPin={setFocusedPin} />
    </div>
  );
}

function AnnotationPin({
  number,
  className,
  focused,
}: {
  number: number;
  className: string;
  focused: boolean;
}) {
  return (
    <span
      className={cn(
        "prototype-annotation-pin absolute z-10 flex size-6 items-center justify-center rounded-full bg-attention text-[10px] font-bold tabular-nums text-background shadow-sm ring-2 ring-background",
        focused && "scale-110 ring-2 ring-ring",
        className,
      )}
      aria-label={`Annotation ${number}`}
    >
      {number}
    </span>
  );
}

function WorkspaceSurface({ initialDrafts }: { initialDrafts: number }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <ConversationPane />
      <BrowserPane initialDrafts={initialDrafts} />
    </div>
  );
}

export interface WorkspaceOperationsPrototypeProps {
  initialSurface?: PrototypeSurface;
  initialDetailTab?: DetailTab;
  initialDrafts?: number;
  compact?: boolean;
}

export function WorkspaceOperationsPrototype({
  initialSurface = "details",
  initialDetailTab = "overview",
  initialDrafts = 0,
  compact = false,
}: WorkspaceOperationsPrototypeProps) {
  const [surface, setSurface] = useState<PrototypeSurface>(initialSurface);
  const [repositoryId, setRepositoryId] = useState("bbamir");
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    initialSurface === "workspace" ? "feature-auth" : null,
  );
  const [detailsInSplit, setDetailsInSplit] = useState(false);
  const [compactNavigationOpen, setCompactNavigationOpen] = useState(false);
  const repository = useMemo(
    () =>
      REPOSITORIES.find((item) => item.id === repositoryId) ?? REPOSITORIES[0],
    [repositoryId],
  );

  function openDetails(nextRepositoryId: string) {
    setRepositoryId(nextRepositoryId);
    setWorkspaceId(null);
    setDetailsInSplit(false);
    setSurface("details");
  }

  function openWorkspace(nextRepositoryId: string, nextWorkspaceId: string) {
    setRepositoryId(nextRepositoryId);
    setWorkspaceId(nextWorkspaceId);
    setDetailsInSplit(false);
    setSurface("workspace");
  }

  return (
    <main
      className={cn(
        "workspace-operations-prototype flex h-screen min-h-[680px] w-full overflow-hidden bg-background text-foreground",
        compact && "max-w-[760px]",
      )}
    >
      {!compact ? (
        <ConductorNavigation
          activeRepositoryId={repositoryId}
          activeWorkspaceId={workspaceId}
          onOpenDetails={openDetails}
          onOpenDetailsInSplit={(nextRepositoryId) => {
            setRepositoryId(nextRepositoryId);
            setDetailsInSplit(true);
            setSurface("workspace");
          }}
          onOpenWorkspace={openWorkspace}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {compact ? (
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
            <Sheet
              open={compactNavigationOpen}
              onOpenChange={setCompactNavigationOpen}
            >
              <SheetTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Open navigation"
                >
                  <Icon name="AlignLeft" aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[320px] max-w-[88vw] p-0 [&>button]:hidden sm:max-w-[320px]"
              >
                <SheetTitle className="sr-only">Workspaces</SheetTitle>
                <ConductorNavigation
                  activeRepositoryId={repositoryId}
                  activeWorkspaceId={workspaceId}
                  onOpenDetails={(nextRepositoryId) => {
                    openDetails(nextRepositoryId);
                    setCompactNavigationOpen(false);
                  }}
                  onOpenDetailsInSplit={(nextRepositoryId) => {
                    openDetails(nextRepositoryId);
                    setCompactNavigationOpen(false);
                  }}
                  onOpenWorkspace={(nextRepositoryId, nextWorkspaceId) => {
                    openWorkspace(nextRepositoryId, nextWorkspaceId);
                    setCompactNavigationOpen(false);
                  }}
                />
              </SheetContent>
            </Sheet>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {surface === "details"
                ? `${repository.name} Details`
                : "feature/auth"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                surface === "details"
                  ? openWorkspace(repository.id, "feature-auth")
                  : openDetails(repository.id)
              }
            >
              {surface === "details" ? "Workspace" : "Details"}
            </Button>
          </div>
        ) : null}
        {detailsInSplit ? (
          <div className="flex min-h-0 flex-1">
            <ConversationPane />
            <RepoDetailsPane
              repository={repository}
              initialTab={initialDetailTab}
              onOpenWorkspace={() =>
                openWorkspace(repository.id, "feature-auth")
              }
            />
          </div>
        ) : (
          <div
            className="t-page-slide min-h-0 flex-1"
            data-page={surface === "details" ? "1" : "2"}
          >
            <section
              className="t-page flex min-h-0"
              data-page-id="1"
              aria-hidden={surface !== "details"}
              inert={surface !== "details" ? true : undefined}
            >
              <RepoDetailsPane
                repository={repository}
                initialTab={initialDetailTab}
                onOpenWorkspace={() =>
                  openWorkspace(repository.id, "feature-auth")
                }
              />
            </section>
            <section
              className="t-page flex min-h-0"
              data-page-id="2"
              aria-hidden={surface !== "workspace"}
              inert={surface !== "workspace" ? true : undefined}
            >
              <WorkspaceSurface initialDrafts={initialDrafts} />
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
