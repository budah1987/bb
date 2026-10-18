import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { ProjectScriptsSection } from "./ProjectScriptsSection";
import type { ProjectScriptsController } from "./useProjectScripts";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type {
  Thread,
  ThreadListEntry,
  ThreadPullRequest,
  WorkspaceStatus,
} from "@bb/domain";
import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { BranchPicker } from "@/components/pickers/BranchPicker";
import { PluginThreadDetailsSections } from "@/components/plugin/PluginThreadDetailsSections";
import { PullRequestNextStepLabel } from "@/components/pull-request/PullRequestNextStepLabel";
import { PullRequestStateIcon } from "@/components/pull-request/PullRequestStatusPill";
import { ThreadStatusGlyph } from "@/components/thread/ThreadStatusGlyph";
import { ThreadTitle } from "@/components/thread/ThreadTitleMentions";
import { appToast } from "@/components/ui/app-toast";
import { DiffStatsTally } from "@/components/ui/diff-stats-tally";
import { selectWorkspaceChangedFilesSections } from "@/components/workspace/workspace-change-summary";
import { WorkspaceOpenTargetIcon } from "@/components/workspace-open-target/WorkspaceOpenTargetIcon";
import { useRequestEnvironmentAction } from "@/hooks/mutations/environment-mutations";
import { useEnvironmentMergeBaseBranches } from "@/hooks/queries/environment-queries";
import { useHosts } from "@/hooks/queries/host-queries";
import { useChildThreads, useThreads } from "@/hooks/queries/thread-queries";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { getPullRequestNextStep } from "@/lib/pull-request-display";
import { usePluginSlots } from "@/lib/plugin-slots";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { useOpenUrlByPreference } from "@/lib/url-open-routing";
import type { ThreadGitActionDialogTarget } from "@/components/dialogs/ThreadGitActionDialog";
import { usePaneContext } from "./PaneContext";
import {
  partitionThreadDetailsLineage,
  type ThreadDetailsLineageChild,
} from "./thread-details-lineage";
import type { ThreadHeaderGitAction } from "./useThreadGitActions";

const LINEAGE_INITIAL_COUNT = 6;
const LINEAGE_PAGE_COUNT = 12;

const ROW_SURFACE_CLASS =
  "hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const ROW_CONTENT_CLASS =
  "flex h-8 min-w-0 items-center gap-2.5 px-2.5 text-left text-sm font-medium text-foreground/80";
const ROW_CLASS = `${ROW_CONTENT_CLASS} w-full rounded-lg transition-[scale] active:scale-[0.97] ${ROW_SURFACE_CLASS}`;
const STATIC_ROW_CLASS = `${ROW_CONTENT_CLASS} w-full rounded-lg`;
const SPLIT_GROUP_CLASS =
  "flex w-full items-center rounded-lg hover:bg-state-hover has-[[data-state=open]]:bg-state-hover";
const SPLIT_PRIMARY_CLASS = `${ROW_CONTENT_CLASS} flex-1 rounded-s-lg ${ROW_SURFACE_CLASS}`;
const SPLIT_SECONDARY_CLASS = `flex h-8 w-8 shrink-0 items-center justify-center rounded-e-lg text-muted-foreground data-[state=open]:bg-state-hover ${ROW_SURFACE_CLASS}`;
const SPLIT_SEPARATOR_CLASS = "h-4 w-px shrink-0 bg-border/65";
const ROW_ICON_CLASS = "size-4 shrink-0 text-muted-foreground";
const ROW_LABEL_CLASS = "min-w-0 flex-1 truncate";
const META_ACTION_CLASS =
  "flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60";

export interface ThreadDetailsOpenIn {
  preferredTarget: WorkspaceOpenTarget;
  targets: WorkspaceOpenTarget[];
  onOpenPreferredTarget: () => Promise<void>;
  onOpenTarget: (targetId: WorkspaceOpenTarget["id"]) => Promise<void>;
}

export interface ThreadDetailsParent {
  id: string;
  projectId: string;
  title: string;
}

export interface ThreadDetailsPopoverProps {
  projectScripts: ProjectScriptsController;
  thread: Thread;
  isThreadRunning: boolean;
  hostId: string | null;
  openIn: ThreadDetailsOpenIn | null;
  workspaceStatus: WorkspaceStatus | undefined;
  pullRequest: ThreadPullRequest | null;
  isPullRequestActionPending: boolean;
  onMarkPullRequestReady: (() => void) | null;
  gitActions: readonly ThreadHeaderGitAction[];
  onGitAction: (target: ThreadGitActionDialogTarget) => void;
  onOpenChanges: (() => void) | null;
  parent: ThreadDetailsParent | null;
}

export function ThreadDetailsPopover(props: ThreadDetailsPopoverProps) {
  const [open, setOpen] = useState(false);
  const { isFocused } = usePaneContext();
  const shortcut = useAppCommandShortcut("thread.details.toggle");
  useAppCommandHandler("thread.details.toggle", () => {
    if (!isFocused) return false;
    setOpen((value) => !value);
    return true;
  });
  const label = shortcut
    ? `Thread details (${shortcut.label})`
    : "Thread details";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            HEADER_ICON_BUTTON_CLASS,
            CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
            "data-[state=open]:bg-state-active data-[state=open]:text-foreground",
          )}
          aria-label={label}
          aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
        >
          <Icon name="ListView" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        mobileTitle="Thread details"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.focus();
          }
        }}
        className="w-70 overflow-hidden rounded-3xl border-border/65 bg-popover/90 p-0 shadow-lg backdrop-blur-xl backdrop-saturate-150"
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("a[href]") !== null
          ) {
            setOpen(false);
          }
        }}
      >
        <div className="max-h-[min(40rem,calc(var(--radix-popover-content-available-height)-1rem))] overflow-y-auto overscroll-contain">
          <ThreadDetailsContent {...props} onNavigate={() => setOpen(false)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ThreadDetailsContent({
  projectScripts,
  thread,
  isThreadRunning,
  hostId,
  openIn,
  workspaceStatus,
  pullRequest,
  isPullRequestActionPending,
  onMarkPullRequestReady,
  gitActions,
  onGitAction,
  onOpenChanges,
  parent,
  onNavigate,
}: ThreadDetailsPopoverProps & { onNavigate: () => void }) {
  const hosts = useHosts({ enabled: hostId !== null });
  const machineName =
    hostId === null
      ? null
      : (hosts.data?.find((host) => host.id === hostId)?.name ?? null);
  const showWorkspace = machineName !== null || openIn !== null;
  const showVersionControl =
    workspaceStatus !== undefined || pullRequest !== null;
  const { threadDetailsSections } = usePluginSlots();
  const hostGitActions = threadDetailsSections.some(
    (section) => section.replacesHostGitActions === true,
  )
    ? []
    : gitActions;

  return (
    <div className="[&>section+section]:border-t [&>section+section]:border-border/65">
      {showWorkspace ? (
        <DetailsSection title="Workspace">
          {machineName !== null ? (
            <div className={STATIC_ROW_CLASS} title={machineName}>
              <Icon name="Laptop" className={ROW_ICON_CLASS} aria-hidden />
              <span className={ROW_LABEL_CLASS}>{machineName}</span>
            </div>
          ) : null}
          {openIn !== null ? <OpenInRow openIn={openIn} /> : null}
        </DetailsSection>
      ) : null}
      {thread.projectId !== PERSONAL_PROJECT_ID ? (
        <ProjectScriptsSection
          controller={projectScripts}
          projectId={thread.projectId}
          environmentId={thread.environmentId}
          onNavigate={onNavigate}
        />
      ) : null}
      {showVersionControl ? (
        <DetailsSection title="Version control">
          <BranchRow
            environmentId={thread.environmentId}
            isThreadRunning={isThreadRunning}
            workspaceStatus={workspaceStatus}
          />
          {pullRequest !== null ? (
            <PullRequestRow
              pullRequest={pullRequest}
              isPending={isPullRequestActionPending}
              onMarkReady={onMarkPullRequestReady}
            />
          ) : null}
          <PluginThreadDetailsSections
            threadId={thread.id}
            projectId={thread.projectId}
            environmentId={thread.environmentId}
            closeDetails={onNavigate}
          />
          {hostGitActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={ROW_CLASS}
              onClick={() => {
                onNavigate();
                onGitAction(action.target);
              }}
            >
              <Icon name="FolderGit" className={ROW_ICON_CLASS} aria-hidden />
              <span className={ROW_LABEL_CLASS}>{action.label}</span>
            </button>
          ))}
          <ChangesRows
            workspaceStatus={workspaceStatus}
            onOpenChanges={
              onOpenChanges === null
                ? null
                : () => {
                    onNavigate();
                    onOpenChanges();
                  }
            }
          />
        </DetailsSection>
      ) : null}
      <LineageSection thread={thread} parent={parent} />
    </div>
  );
}

function DetailsSection({
  title,
  heading,
  actions,
  children,
}: {
  title: string;
  heading?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col px-2 pt-2 pb-2.5">
      {heading !== undefined ? (
        <div className="mb-1 flex min-h-8 min-w-0 items-center justify-between gap-2 px-1.5">
          <h3 className="m-0 min-w-0 truncate text-xs font-medium text-muted-foreground select-none">
            {heading}
          </h3>
          {actions ? (
            <div className="flex shrink-0 items-center gap-1">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function OpenInRow({ openIn }: { openIn: ThreadDetailsOpenIn }) {
  const [pendingTargetId, setPendingTargetId] =
    useState<WorkspaceOpenTargetId | null>(null);
  const run = (
    targetId: WorkspaceOpenTargetId,
    action: () => Promise<void>,
  ) => {
    if (pendingTargetId !== null) return;
    setPendingTargetId(targetId);
    void action().finally(() => setPendingTargetId(null));
  };
  const otherTargets = openIn.targets.filter(
    (target) => target.id !== openIn.preferredTarget.id,
  );
  const primary = (
    <button
      type="button"
      className={otherTargets.length > 0 ? SPLIT_PRIMARY_CLASS : ROW_CLASS}
      onClick={() =>
        run(openIn.preferredTarget.id, openIn.onOpenPreferredTarget)
      }
    >
      <WorkspaceOpenTargetIcon
        target={openIn.preferredTarget}
        className={cn(
          "size-4 shrink-0",
          pendingTargetId !== null && "animate-shine-icon",
        )}
      />
      <span className={ROW_LABEL_CLASS}>
        Open in {openIn.preferredTarget.label}
      </span>
    </button>
  );
  if (otherTargets.length === 0) return primary;
  return (
    <div className={SPLIT_GROUP_CLASS}>
      {primary}
      <span aria-hidden="true" className={SPLIT_SEPARATOR_CLASS} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Choose another app"
            className={SPLIT_SECONDARY_CLASS}
          >
            <Icon name="ChevronDown" className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {otherTargets.map((target) => (
            <DropdownMenuItem
              key={target.id}
              onSelect={() =>
                run(target.id, () => openIn.onOpenTarget(target.id))
              }
            >
              <WorkspaceOpenTargetIcon target={target} className="size-4" />
              <span className="min-w-0 flex-1 truncate">{target.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function BranchRow({
  environmentId,
  isThreadRunning,
  workspaceStatus,
}: {
  environmentId: string | null;
  isThreadRunning: boolean;
  workspaceStatus: WorkspaceStatus | undefined;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const branches = useEnvironmentMergeBaseBranches(environmentId ?? "", {
    enabled: pickerOpen,
    query: searchQuery,
  });
  const requestEnvironmentAction = useRequestEnvironmentAction();
  const branch = workspaceStatus?.branch.currentBranch ?? null;
  if (branch === null) return null;
  const mergeBase = workspaceStatus?.mergeBase ?? null;
  const ahead = mergeBase?.aheadCount ?? 0;
  const behind = mergeBase?.behindCount ?? 0;
  const comparison =
    mergeBase === null
      ? null
      : `${ahead} ahead, ${behind} behind ${mergeBase.mergeBaseBranch}`;
  const disabled =
    environmentId === null ||
    isThreadRunning ||
    requestEnvironmentAction.isPending;
  const title = [
    branch,
    comparison,
    isThreadRunning ? "Stop the agent to switch branches" : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const checkout = async (target: string, create: boolean) => {
    if (environmentId === null || (!create && target === branch)) return;
    const toastId = appToast.loading(
      create ? `Creating ${target}` : `Switching to ${target}`,
    );
    try {
      const response = await requestEnvironmentAction.mutateAsync({
        id: environmentId,
        action: "checkout_branch",
        options: { branch: target, create },
      });
      if (response.action !== "checkout_branch") {
        throw new Error("Expected checkout branch action response.");
      }
      appToast.success(response.message, { id: toastId });
    } catch (error) {
      appToast.error("Failed to switch branch", {
        id: toastId,
        description: getMutationErrorMessage({
          error,
          fallbackMessage: "The branch did not change",
        }),
      });
    }
  };

  return (
    <BranchPicker
      value={branch}
      options={branches.data?.branches ?? []}
      remoteOptions={branches.data?.remoteBranches ?? []}
      loading={branches.isFetching}
      disabled={disabled}
      menuLabel="Switch branch"
      popoverAlign="end"
      onOpenChange={setPickerOpen}
      onSearchQueryChange={setSearchQuery}
      onChange={(target) => void checkout(target, false)}
      onCreateBranch={(target) => void checkout(target, true)}
      trigger={
        <button
          type="button"
          className={cn(
            ROW_CLASS,
            "group/branch disabled:pointer-events-auto disabled:active:scale-100 disabled:hover:bg-transparent",
          )}
          title={title}
          aria-label={`Branch ${branch}`}
        >
          <Icon name="GitBranch" className={ROW_ICON_CLASS} aria-hidden />
          <span className={ROW_LABEL_CLASS}>{branch}</span>
          {ahead > 0 || behind > 0 ? (
            <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
              {ahead > 0 ? `↑${ahead}` : null}
              {ahead > 0 && behind > 0 ? " " : null}
              {behind > 0 ? `↓${behind}` : null}
            </span>
          ) : null}
          <Icon
            name="ChevronDown"
            className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/branch:opacity-100 group-focus-visible/branch:opacity-100 group-disabled/branch:opacity-0 group-data-[state=open]/branch:opacity-100"
            aria-hidden
          />
        </button>
      }
    />
  );
}

function PullRequestRow({
  pullRequest,
  isPending,
  onMarkReady,
}: {
  pullRequest: ThreadPullRequest;
  isPending: boolean;
  onMarkReady: (() => void) | null;
}) {
  const openUrl = useOpenUrlByPreference();
  const nextStep = getPullRequestNextStep(pullRequest);
  const canMarkReady = pullRequest.state === "draft" && onMarkReady !== null;
  return (
    <div className="pb-2">
      <button
        type="button"
        className={ROW_CLASS}
        title={`#${pullRequest.number} ${pullRequest.title}`}
        onClick={() => openUrl(pullRequest.url)}
      >
        <PullRequestStateIcon pullRequest={pullRequest} />
        <span className={ROW_LABEL_CLASS}>{pullRequest.title}</span>
      </button>
      <div className="-mt-1 flex h-6 min-w-0 items-center gap-0.5 ps-9 pe-1 text-xs text-muted-foreground">
        <span className="me-1 shrink-0 tabular-nums">
          #{pullRequest.number}
        </span>
        <span className="flex-1" />
        {canMarkReady ? (
          <button
            type="button"
            disabled={isPending}
            className={cn(META_ACTION_CLASS, "text-primary")}
            onClick={onMarkReady}
          >
            {isPending ? "Marking…" : "Ready"}
          </button>
        ) : nextStep ? (
          <span className="flex shrink-0 items-center px-1.5">
            <PullRequestNextStepLabel nextStep={nextStep} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ChangesRows({
  workspaceStatus,
  onOpenChanges,
}: {
  workspaceStatus: WorkspaceStatus | undefined;
  onOpenChanges: (() => void) | null;
}) {
  const sections = selectWorkspaceChangedFilesSections(workspaceStatus);
  return sections.map((section) => {
    const content = (
      <>
        <Icon name="FileDiff" className={ROW_ICON_CLASS} aria-hidden />
        <span className={ROW_LABEL_CLASS}>
          {section.kind === "committed" ? "Changes" : section.label}
        </span>
        <DiffStatsTally
          insertions={section.stats.insertions}
          deletions={section.stats.deletions}
          className="shrink-0 text-xs font-normal tabular-nums"
        />
      </>
    );
    return onOpenChanges === null ? (
      <div key={section.kind} className={STATIC_ROW_CLASS}>
        {content}
      </div>
    ) : (
      <button
        key={section.kind}
        type="button"
        className={ROW_CLASS}
        title={`${section.files.length} files`}
        onClick={onOpenChanges}
      >
        {content}
      </button>
    );
  });
}

function LineageSection({
  thread,
  parent,
}: {
  thread: Thread;
  parent: ThreadDetailsParent | null;
}) {
  const childThreadsQuery = useChildThreads({
    enabled: true,
    parentThreadId: thread.id,
  });
  const forksQuery = useThreads({
    projectId: thread.projectId,
    sourceThreadId: thread.id,
    originKind: "fork",
    archived: false,
  });
  const children = (childThreadsQuery.data ?? []).filter(
    (child) => child.originKind === null,
  );
  const forks = forksQuery.data ?? [];
  const lineage = partitionThreadDetailsLineage(children);
  if (parent === null && children.length === 0 && forks.length === 0) {
    return null;
  }
  const active = [
    ...lineage.running,
    ...forks.map((fork) => ({ thread: fork, indicator: "none" as const })),
  ];

  return (
    <DetailsSection
      title="Lineage"
      heading={
        lineage.running.length > 0
          ? `Lineage · ${lineage.running.length} running`
          : "Lineage"
      }
    >
      {parent !== null ? (
        <Link
          to={getThreadRoutePath({
            projectId: parent.projectId,
            threadId: parent.id,
          })}
          title={parent.title}
          aria-label={`Parent thread: ${parent.title}`}
          className={cn(ROW_CLASS, "group no-underline")}
        >
          <Icon
            name="ArrowTurnBackward"
            className={ROW_ICON_CLASS}
            aria-hidden
          />
          <span className={ROW_LABEL_CLASS}>
            <ThreadTitle title={parent.title} />
          </span>
          <span className="shrink-0 text-2xs font-normal text-muted-foreground">
            Parent
          </span>
        </Link>
      ) : null}
      <LineageGroup items={active} />
      {lineage.previous.length > 0 ? (
        <PreviousAgents
          items={lineage.previous}
          failedCount={lineage.previousFailedCount}
        />
      ) : null}
    </DetailsSection>
  );
}

function PreviousAgents({
  items,
  failedCount,
}: {
  items: readonly ThreadDetailsLineageChild[];
  failedCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex h-8 w-full items-center gap-2 rounded-md ps-2 pe-2.5 text-left text-xs font-medium text-muted-foreground/70 hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="shrink-0">
          Previous agents{expanded ? null : ` (${items.length})`}
        </span>
        <span aria-hidden className="h-px min-w-2 flex-1 bg-border/65" />
        {failedCount > 0 ? (
          <span className="shrink-0 text-2xs leading-none text-destructive">
            {failedCount} failed
          </span>
        ) : null}
        <Icon
          name="ChevronDown"
          aria-hidden
          className={cn(
            "size-3 shrink-0 transition-transform",
            !expanded && "rotate-180",
          )}
        />
      </button>
      {expanded ? <LineageGroup items={items} /> : null}
    </div>
  );
}

function LineageGroup({
  items,
}: {
  items: readonly ThreadDetailsLineageChild[];
}) {
  const [visibleCount, setVisibleCount] = useState(LINEAGE_INITIAL_COUNT);
  if (items.length === 0) return null;
  const visible = items.slice(0, visibleCount);
  const hiddenCount = items.length - visible.length;
  return (
    <>
      <ul className="m-0 max-h-54 list-none overflow-y-auto overscroll-contain p-0">
        {visible.map((item) => (
          <li key={item.thread.id}>
            <LineageRow item={item} />
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setVisibleCount((count) => count + LINEAGE_PAGE_COUNT)}
          className={cn(
            ROW_CLASS,
            "text-muted-foreground/70 hover:text-foreground/80",
          )}
        >
          <Icon name="Plus" className="size-4 shrink-0" aria-hidden />
          Show {Math.min(hiddenCount, LINEAGE_PAGE_COUNT)} more
        </button>
      ) : null}
    </>
  );
}

function lineageStatusLabel(item: ThreadDetailsLineageChild): string | null {
  if (item.thread.status === "error" || item.indicator === "queued-failed") {
    return "Failed";
  }
  switch (item.indicator) {
    case "waiting-for-input":
      return "Needs input";
    case "queued-waiting":
      return "Queued";
    case "none":
      return item.thread.originKind === "fork" ? "Fork" : "Done";
    default:
      return null;
  }
}

function LineageRow({ item }: { item: ThreadDetailsLineageChild }) {
  const related: ThreadListEntry = item.thread;
  const title = getThreadDisplayTitle(related);
  const status = lineageStatusLabel(item);
  const failed = status === "Failed";
  const idleIcon: IconName =
    related.originKind === "fork" ? "Fork" : "ChildThread";
  return (
    <Link
      to={getThreadRoutePath({
        projectId: related.projectId,
        threadId: related.id,
      })}
      title={title}
      className={cn(ROW_CLASS, "no-underline")}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_[data-icon-root]]:size-4">
        {item.indicator === "none" ? (
          <Icon name={idleIcon} aria-hidden="true" />
        ) : (
          <ThreadStatusGlyph indicator={item.indicator} size="compact" />
        )}
      </span>
      <span className={cn(ROW_LABEL_CLASS, "text-foreground/85")}>
        <ThreadTitle title={title} />
      </span>
      {status !== null ? (
        <span
          className={cn(
            "shrink-0 text-2xs font-normal",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {status}
        </span>
      ) : null}
    </Link>
  );
}
