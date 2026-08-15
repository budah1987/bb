import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  GitHostPullRequestCheck,
  ThreadPullRequest,
  WorkspaceStatus,
} from "@bb/domain";
import type { GithubAccount } from "@bb/host-daemon-contract";
import type {
  EnvironmentPullRequestResponse,
  PullRequestMergeMethod,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { BranchPicker } from "@/components/pickers/BranchPicker";
import { PullRequestStatusPill } from "./PullRequestStatusPill";
import {
  getPullRequestAttentionDisplay,
  getPullRequestChecksDisplay,
  getPullRequestMergeabilityDisplay,
  getPullRequestReviewDisplay,
} from "@/lib/pull-request-display";
import { useUrlAnchorClickHandler } from "@/lib/url-open-routing";

const MERGE_METHODS: readonly {
  label: string;
  method: PullRequestMergeMethod;
}[] = [
  { label: "Merge", method: "merge" },
  { label: "Squash and merge", method: "squash" },
  { label: "Rebase and merge", method: "rebase" },
];

export interface PullRequestCreateInput {
  baseBranch: string;
  body: string;
  draft: boolean;
  title: string;
}

export interface PullRequestMetadataSuggestion {
  body: string;
  title: string;
}

export interface PullRequestPanelProps {
  archiveErrorMessage: string | null;
  baseBranchOptions: readonly string[];
  defaultBaseBranch: string;
  isActionPending: boolean;
  githubAccounts: readonly GithubAccount[];
  isGithubAccountLoading: boolean;
  isLoading: boolean;
  onArchive: () => void;
  onAskAgentToFix: (check: GitHostPullRequestCheck) => void;
  onAskAgentToResolve: (pullRequest: ThreadPullRequest) => void;
  onConvertToDraft: () => void;
  onCommitChanges: () => void;
  onCreate: (input: PullRequestCreateInput) => void;
  onGenerateMetadata: (
    baseBranch: string,
  ) => Promise<PullRequestMetadataSuggestion>;
  onGithubAccountChange: (login: string) => void;
  onMarkReady: () => void;
  onMerge: (method: PullRequestMergeMethod) => void;
  onRefresh: () => void;
  onReviewChanges: () => void;
  pullRequestResponse: EnvironmentPullRequestResponse | undefined;
  selectedGithubAccountLogin: string | null;
  threadTitle: string;
  workspaceStatus: WorkspaceStatus | undefined;
}

type PullRequestCreateFormProps = Pick<
  PullRequestPanelProps,
  | "baseBranchOptions"
  | "defaultBaseBranch"
  | "isActionPending"
  | "githubAccounts"
  | "isGithubAccountLoading"
  | "onCommitChanges"
  | "onCreate"
  | "onGenerateMetadata"
  | "onGithubAccountChange"
  | "onReviewChanges"
  | "threadTitle"
  | "selectedGithubAccountLogin"
  | "workspaceStatus"
>;

export interface PullRequestCreateDialogProps extends Omit<
  PullRequestCreateFormProps,
  "onCreate"
> {
  onCreate: (input: PullRequestCreateInput) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

function GithubAccountPicker({
  accounts,
  disabled,
  isLoading,
  onChange,
  value,
}: {
  accounts: readonly GithubAccount[];
  disabled: boolean;
  isLoading: boolean;
  onChange: (login: string) => void;
  value: string | null;
}) {
  const selectedAccount =
    accounts.find((account) => account.login === value) ?? null;
  const triggerLabel = isLoading
    ? "Loading accounts…"
    : selectedAccount
      ? `@${selectedAccount.login}`
      : "No GitHub account";

  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-foreground">
        GitHub account
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full justify-between bg-transparent px-3 font-normal active:scale-[0.96] motion-reduce:transition-none"
            disabled={disabled || isLoading || accounts.length === 0}
            aria-label="Choose GitHub account"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon
                name={isLoading ? "Spinner" : "Github"}
                className={cn("size-4 shrink-0", isLoading && "animate-spin")}
                aria-hidden="true"
              />
              <span className="truncate">{triggerLabel}</span>
            </span>
            <Icon
              name="ChevronDown"
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-64"
          mobileTitle="GitHub account"
        >
          <DropdownMenuLabel>Use for this worktree</DropdownMenuLabel>
          {accounts.map((account) => (
            <DropdownMenuItem
              key={`${account.host}:${account.login}`}
              className="min-h-11 gap-2"
              onSelect={() => onChange(account.login)}
            >
              <Icon
                name="Github"
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">@{account.login}</span>
              {account.active ? (
                <span className="text-xs text-muted-foreground">
                  CLI default
                </span>
              ) : null}
              <Icon
                name="Check"
                className={cn(
                  "size-4 shrink-0 text-foreground",
                  account.login === value ? "opacity-100" : "opacity-0",
                )}
                aria-hidden="true"
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-xs leading-5 text-muted-foreground text-pretty">
        Used for pushes, pull requests, checks, and merges in this worktree.
      </p>
    </div>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  const onClick = useUrlAnchorClickHandler(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      aria-label={label}
      className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground no-underline transition-[color,background-color,transform] duration-150 hover:bg-state-hover hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
    >
      <Icon name="ExternalLink" className="size-3.5" aria-hidden="true" />
    </a>
  );
}

function StatusSignal({
  className,
  icon,
  label,
}: {
  className: string;
  icon: IconName;
  label: string;
}) {
  return (
    <div className="flex min-h-10 items-center gap-2.5 px-3 py-2">
      <Icon name={icon} className={cn("size-4 shrink-0", className)} />
      <span className="min-w-0 flex-1 text-sm text-foreground">{label}</span>
    </div>
  );
}

function getCheckDisplay(check: GitHostPullRequestCheck): {
  className: string;
  icon: IconName;
  label: string;
  needsFix: boolean;
} {
  if (check.status === "queued" || check.status === "in_progress") {
    return {
      className: "text-warning-text",
      icon: "Clock",
      label: check.status === "queued" ? "Queued" : "Running",
      needsFix: false,
    };
  }
  switch (check.conclusion) {
    case "success":
    case "neutral":
    case "skipped":
      return {
        className: "text-success",
        icon: "CircleCheck",
        label:
          check.conclusion === "success"
            ? "Passed"
            : check.conclusion === "skipped"
              ? "Skipped"
              : "Neutral",
        needsFix: false,
      };
    case "failure":
    case "cancelled":
    case "timed_out":
    case "action_required":
    case "startup_failure":
    case "stale":
      return {
        className: "text-destructive",
        icon: "CircleX",
        label:
          check.conclusion === "timed_out"
            ? "Timed out"
            : check.conclusion === "action_required"
              ? "Action required"
              : check.conclusion === "startup_failure"
                ? "Startup failed"
                : check.conclusion === "cancelled"
                  ? "Cancelled"
                  : check.conclusion === "stale"
                    ? "Stale"
                    : "Failed",
        needsFix: true,
      };
    case "unknown":
    case null:
      return {
        className: "text-warning-text",
        icon: "AlertTriangle",
        label: "Unknown",
        needsFix: false,
      };
  }
}

function CheckRow({
  check,
  isActionPending,
  onAskAgentToFix,
}: {
  check: GitHostPullRequestCheck;
  isActionPending: boolean;
  onAskAgentToFix: (check: GitHostPullRequestCheck) => void;
}) {
  const display = getCheckDisplay(check);
  return (
    <li className="group flex min-h-12 items-center gap-2 px-3 py-2 transition-[background-color,opacity,transform,filter] duration-250 ease-out hover:bg-state-hover motion-reduce:transition-none">
      <Icon
        name={display.icon}
        className={cn("size-4 shrink-0", display.className)}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium text-foreground"
          title={check.name}
        >
          {check.name}
        </p>
        <p className={cn("text-xs", display.className)}>{display.label}</p>
      </div>
      {display.needsFix ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-10 shrink-0 px-2 text-xs active:scale-[0.96] motion-reduce:transition-none"
          disabled={isActionPending}
          onClick={() => onAskAgentToFix(check)}
        >
          Ask agent
        </Button>
      ) : null}
      {check.url ? (
        <ExternalLink href={check.url} label={`Open ${check.name} check`} />
      ) : null}
    </li>
  );
}

function CreatePullRequestForm({
  baseBranchOptions,
  defaultBaseBranch,
  isActionPending,
  githubAccounts,
  isGithubAccountLoading,
  onCommitChanges,
  onCreate,
  onGenerateMetadata,
  onGithubAccountChange,
  onReviewChanges,
  threadTitle,
  selectedGithubAccountLogin,
  showHeader = true,
  workspaceStatus,
}: PullRequestCreateFormProps & { showHeader?: boolean }) {
  const [title, setTitle] = useState(threadTitle);
  const [body, setBody] = useState("");
  const [baseBranch, setBaseBranch] = useState(defaultBaseBranch);
  const [draft, setDraft] = useState(false);
  const [isGeneratingMetadata, setIsGeneratingMetadata] = useState(false);
  const editedFieldsRef = useRef({ body: false, title: false });
  const generationRequestRef = useRef(0);

  useEffect(() => {
    setTitle(threadTitle);
  }, [threadTitle]);
  useEffect(() => {
    setBaseBranch(defaultBaseBranch);
  }, [defaultBaseBranch]);

  const generateMetadata = useCallback(
    async (nextBaseBranch: string) => {
      const requestId = generationRequestRef.current + 1;
      generationRequestRef.current = requestId;
      setIsGeneratingMetadata(true);
      try {
        const metadata = await onGenerateMetadata(nextBaseBranch);
        if (generationRequestRef.current !== requestId) return;
        if (!editedFieldsRef.current.title) {
          setTitle(metadata.title);
        }
        if (!editedFieldsRef.current.body) {
          setBody(metadata.body);
        }
      } catch {
        // Metadata generation is an enhancement; the editable fallbacks stay
        // available when inference or the connection is unavailable.
      } finally {
        if (generationRequestRef.current === requestId) {
          setIsGeneratingMetadata(false);
        }
      }
    },
    [onGenerateMetadata],
  );

  useEffect(() => {
    void generateMetadata(defaultBaseBranch);
    return () => {
      generationRequestRef.current += 1;
    };
  }, [defaultBaseBranch, generateMetadata]);

  const currentBranch = workspaceStatus?.branch.currentBranch ?? null;
  const hasUncommittedChanges =
    workspaceStatus?.workingTree.hasUncommittedChanges === true;
  const previousHasUncommittedChangesRef = useRef(hasUncommittedChanges);
  useEffect(() => {
    const previousValue = previousHasUncommittedChangesRef.current;
    previousHasUncommittedChangesRef.current = hasUncommittedChanges;
    if (previousValue && !hasUncommittedChanges) {
      void generateMetadata(baseBranch);
    }
  }, [baseBranch, generateMetadata, hasUncommittedChanges]);
  const canSubmit =
    title.trim().length > 0 && baseBranch.trim().length > 0 && !isActionPending;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    onCreate({
      baseBranch: baseBranch.trim(),
      body,
      draft,
      title: title.trim(),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-y-auto pb-5",
        showHeader ? "px-4 pt-4" : "px-6 pt-5",
      )}
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
        {showHeader ? (
          <header className="space-y-1">
            <div className="flex size-9 items-center justify-center rounded-lg bg-surface-raised text-foreground shadow-[0_1px_2px_color-mix(in_oklab,var(--ink)_10%,transparent)]">
              <Icon
                name="GitPullRequest"
                className="size-4"
                aria-hidden="true"
              />
            </div>
            <h2 className="pt-2 text-base font-semibold text-foreground text-balance">
              Create a pull request
            </h2>
            <p className="max-w-[58ch] text-sm leading-5 text-muted-foreground text-pretty">
              BB will push{" "}
              {currentBranch ? (
                <strong className="font-medium text-foreground">
                  {currentBranch}
                </strong>
              ) : (
                "this branch"
              )}{" "}
              to origin, then create the pull request.
            </p>
            {isGeneratingMetadata ? (
              <p
                className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground"
                role="status"
              >
                <Icon
                  name="Spinner"
                  className="size-3 animate-spin"
                  aria-hidden="true"
                />
                Drafting title and description…
              </p>
            ) : null}
          </header>
        ) : isGeneratingMetadata ? (
          <p
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            role="status"
          >
            <Icon
              name="Spinner"
              className="size-3 animate-spin"
              aria-hidden="true"
            />
            Drafting title and description…
          </p>
        ) : null}

        {hasUncommittedChanges ? (
          <div className="rounded-lg bg-warning/10 px-3 py-3 text-warning-text">
            <div className="flex gap-2 text-xs leading-5">
              <Icon name="AlertTriangle" className="mt-0.5 size-4 shrink-0" />
              <p>Uncommitted files won’t be included in this pull request.</p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={onReviewChanges}
              >
                Review changes
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 bg-transparent"
                disabled={isActionPending}
                onClick={onCommitChanges}
              >
                Commit changes
              </Button>
            </div>
          </div>
        ) : null}

        <GithubAccountPicker
          accounts={githubAccounts}
          disabled={isActionPending}
          isLoading={isGithubAccountLoading}
          onChange={onGithubAccountChange}
          value={selectedGithubAccountLogin}
        />

        <label className="grid gap-1.5 text-xs font-medium text-foreground">
          Title
          <Input
            value={title}
            onChange={(event) => {
              editedFieldsRef.current.title = true;
              setTitle(event.target.value);
            }}
            placeholder="Summarize the change"
            autoComplete="off"
            disabled={isActionPending}
          />
        </label>

        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground">
            Base branch
          </span>
          <BranchPicker
            value={baseBranch}
            options={baseBranchOptions}
            currentBranch={currentBranch}
            priorityOptions={[defaultBaseBranch]}
            onChange={(nextBaseBranch) => {
              setBaseBranch(nextBaseBranch);
              void generateMetadata(nextBaseBranch);
            }}
            disabled={isActionPending}
            placeholder="Choose a base branch"
            triggerLabel="Base branch"
            menuKind="base"
            className="w-full"
          />
        </div>

        <label className="grid gap-1.5 text-xs font-medium text-foreground">
          Description{" "}
          <span className="font-normal text-muted-foreground">Optional</span>
          <textarea
            value={body}
            onChange={(event) => {
              editedFieldsRef.current.body = true;
              setBody(event.target.value);
            }}
            placeholder="What changed, and why?"
            disabled={isActionPending}
            rows={6}
            className="min-h-28 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          />
        </label>

        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm text-foreground">
          <Checkbox
            checked={draft}
            onCheckedChange={(checked) => setDraft(checked === true)}
            disabled={isActionPending}
          />
          <span>
            Create as draft
            <span className="block text-xs leading-5 text-muted-foreground">
              Use a draft while checks or review work are still in progress.
            </span>
          </span>
        </label>

        <Button
          type="submit"
          disabled={!canSubmit}
          className="min-h-11 w-full active:scale-[0.96] motion-reduce:transition-none"
        >
          {isActionPending
            ? "Creating pull request…"
            : draft
              ? "Create draft pull request"
              : "Create pull request"}
        </Button>
      </div>
    </form>
  );
}

export function PullRequestCreateDialog({
  onCreate,
  onOpenChange,
  open,
  workspaceStatus,
  ...formProps
}: PullRequestCreateDialogProps) {
  const currentBranch = workspaceStatus?.branch.currentBranch ?? null;
  const handleCreate = (input: PullRequestCreateInput) => {
    void onCreate(input).then((created) => {
      if (created) {
        onOpenChange(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        compactContentClassName="h-dvh max-h-dvh rounded-none"
        className="flex max-h-[min(48rem,calc(100dvh-2rem))] max-w-[36rem] flex-col gap-0 overflow-hidden p-0 max-md:h-full max-md:max-h-none max-md:w-full"
      >
        <DialogHeader className="px-6 pt-6">
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-surface-raised text-foreground shadow-[0_1px_2px_color-mix(in_oklab,var(--ink)_10%,transparent)]">
            <Icon name="GitPullRequest" className="size-4" aria-hidden="true" />
          </div>
          <DialogTitle>Create a pull request</DialogTitle>
          <DialogDescription>
            BB will push {currentBranch ?? "this branch"} to origin, then create
            the pull request.
          </DialogDescription>
        </DialogHeader>
        <CreatePullRequestForm
          {...formProps}
          workspaceStatus={workspaceStatus}
          onCreate={handleCreate}
          showHeader={false}
        />
      </DialogContent>
    </Dialog>
  );
}

function PullRequestActions({
  archiveErrorMessage,
  isActionPending,
  onArchive,
  onConvertToDraft,
  onMarkReady,
  onMerge,
  pullRequest,
}: Pick<
  PullRequestPanelProps,
  | "isActionPending"
  | "archiveErrorMessage"
  | "onArchive"
  | "onConvertToDraft"
  | "onMarkReady"
  | "onMerge"
> & { pullRequest: ThreadPullRequest }) {
  if (pullRequest.state === "merged" || pullRequest.state === "closed") {
    return (
      <div className="grid gap-3">
        {archiveErrorMessage ? (
          <div
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <p className="font-medium">Couldn’t archive workspace</p>
            <p className="mt-0.5 text-xs leading-5">{archiveErrorMessage}</p>
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full active:scale-[0.96] motion-reduce:transition-none"
          disabled={isActionPending}
          onClick={onArchive}
        >
          <Icon name="Archive" className="size-4" aria-hidden="true" />
          {isActionPending ? "Archiving…" : "Archive workspace"}
        </Button>
      </div>
    );
  }
  if (pullRequest.state === "draft") {
    return (
      <Button
        type="button"
        className="min-h-11 w-full active:scale-[0.96] motion-reduce:transition-none"
        disabled={isActionPending}
        onClick={onMarkReady}
      >
        {isActionPending ? "Marking ready…" : "Mark ready for review"}
      </Button>
    );
  }

  const canMerge = pullRequest.attention === "ready_to_merge";
  const attention = getPullRequestAttentionDisplay(pullRequest);
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        className="min-h-11 min-w-0 flex-1 active:scale-[0.96] motion-reduce:transition-none"
        disabled={isActionPending || !canMerge}
        onClick={() => onMerge("merge")}
        aria-label={canMerge ? "Merge pull request" : attention.label}
      >
        {isActionPending
          ? "Updating…"
          : canMerge
            ? "Merge pull request"
            : attention.label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0 active:scale-[0.96] motion-reduce:transition-none"
            disabled={isActionPending}
            aria-label="Pull request actions"
          >
            <Icon name="ChevronDown" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" mobileTitle="Pull request actions">
          {MERGE_METHODS.map((action) => (
            <DropdownMenuItem
              key={action.method}
              disabled={!canMerge}
              onSelect={() => onMerge(action.method)}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onConvertToDraft}>
            Convert to draft
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function PullRequestDetails({
  archiveErrorMessage,
  githubAccounts,
  isGithubAccountLoading,
  isActionPending,
  onArchive,
  onAskAgentToFix,
  onAskAgentToResolve,
  onConvertToDraft,
  onGithubAccountChange,
  onMarkReady,
  onMerge,
  onRefresh,
  pullRequest,
  selectedGithubAccountLogin,
}: Pick<
  PullRequestPanelProps,
  | "isActionPending"
  | "archiveErrorMessage"
  | "githubAccounts"
  | "isGithubAccountLoading"
  | "onArchive"
  | "onAskAgentToFix"
  | "onAskAgentToResolve"
  | "onConvertToDraft"
  | "onGithubAccountChange"
  | "onMarkReady"
  | "onMerge"
  | "onRefresh"
  | "selectedGithubAccountLogin"
> & { pullRequest: ThreadPullRequest }) {
  const signals = useMemo(() => {
    const checks = getPullRequestChecksDisplay(pullRequest);
    if (pullRequest.state === "merged") {
      return [
        {
          label: "Merged",
          icon: "GitMerge" as const,
          className: "text-success",
        },
        checks,
      ];
    }
    if (pullRequest.state === "closed") {
      return [
        {
          label: "Closed without merge",
          icon: "CircleX" as const,
          className: "text-muted-foreground",
        },
        checks,
      ];
    }
    return [
      checks,
      getPullRequestReviewDisplay(pullRequest),
      getPullRequestMergeabilityDisplay(pullRequest),
    ];
  }, [pullRequest]);
  const recoveryCopy = getPullRequestRecoveryCopy(pullRequest.attention);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <header className="px-4 pb-4 pt-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <PullRequestStatusPill pullRequest={pullRequest} />
                <span className="text-xs tabular-nums text-muted-foreground">
                  #{pullRequest.number}
                </span>
              </div>
              <h2 className="mt-2 text-base font-semibold leading-6 text-foreground text-balance">
                {pullRequest.title}
              </h2>
              <p
                className="mt-1 truncate text-xs text-muted-foreground"
                title={`${pullRequest.headRefName} → ${pullRequest.baseRefName}`}
              >
                {pullRequest.headRefName} → {pullRequest.baseRefName}
              </p>
            </div>
            <ExternalLink
              href={pullRequest.url}
              label={`Open pull request ${pullRequest.number}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 shrink-0 active:scale-[0.96] motion-reduce:transition-none"
              onClick={onRefresh}
              aria-label="Refresh pull request"
            >
              <Icon
                name="ArrowReloadHorizontal"
                className="size-4"
                aria-hidden="true"
              />
            </Button>
          </div>
          <div className="mt-4">
            <GithubAccountPicker
              accounts={githubAccounts}
              disabled={isActionPending}
              isLoading={isGithubAccountLoading}
              onChange={onGithubAccountChange}
              value={selectedGithubAccountLogin}
            />
          </div>
        </header>

        <section className="mx-4 overflow-hidden rounded-xl bg-surface-raised shadow-[0_0_0_1px_color-mix(in_oklab,var(--ink)_8%,transparent),0_1px_2px_color-mix(in_oklab,var(--ink)_6%,transparent)]">
          {signals.map((signal, index) => (
            <div
              key={signal.label}
              className={cn(index > 0 && "border-t border-border/70")}
            >
              <StatusSignal {...signal} />
            </div>
          ))}
        </section>
        {recoveryCopy ? (
          <section className="mx-4 mt-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3">
            <p className="text-sm font-medium text-foreground">
              {recoveryCopy.title}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {recoveryCopy.description}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 min-h-10"
              disabled={isActionPending}
              onClick={() => onAskAgentToResolve(pullRequest)}
            >
              Ask agent to resolve
            </Button>
          </section>
        ) : null}

        <section className="mt-5">
          <div className="flex min-h-10 items-center justify-between gap-3 px-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Checks
            </h3>
            <span className="text-xs tabular-nums text-muted-foreground">
              {pullRequest.checks.passedCount}/{pullRequest.checks.totalCount}{" "}
              passed
            </span>
          </div>
          {pullRequest.checks.items.length > 0 ? (
            <ul className="divide-y divide-border/70">
              {pullRequest.checks.items.map((check, index) => (
                <CheckRow
                  key={`${check.name}:${index}`}
                  check={check}
                  isActionPending={isActionPending}
                  onAskAgentToFix={onAskAgentToFix}
                />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-5 text-sm text-muted-foreground">
              No CI checks are configured for this pull request.
            </p>
          )}
        </section>
      </div>

      <footer className="shrink-0 border-t border-border bg-sidebar px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <PullRequestActions
          archiveErrorMessage={archiveErrorMessage}
          isActionPending={isActionPending}
          onArchive={onArchive}
          onConvertToDraft={onConvertToDraft}
          onMarkReady={onMarkReady}
          onMerge={onMerge}
          pullRequest={pullRequest}
        />
      </footer>
    </div>
  );
}

function getPullRequestRecoveryCopy(attention: ThreadPullRequest["attention"]) {
  switch (attention) {
    case "conflicts":
      return {
        title: "This pull request has merge conflicts",
        description:
          "Ask the agent to update the branch, resolve the conflicts, and verify the result.",
      };
    case "changes_requested":
      return {
        title: "Review changes are requested",
        description:
          "Ask the agent to inspect the review feedback, make the requested changes, and update the pull request.",
      };
    case "blocked":
      return {
        title: "This pull request is blocked",
        description:
          "Ask the agent to identify the merge requirement that is blocking it and resolve what it can.",
      };
    default:
      return null;
  }
}

export function PullRequestPanel(props: PullRequestPanelProps) {
  if (props.isLoading && props.pullRequestResponse === undefined) {
    return (
      <div className="space-y-3 px-4 py-4" aria-label="Loading pull request">
        <Skeleton className="h-4 w-24 rounded-sm" />
        <Skeleton className="h-6 w-4/5 rounded-sm" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  if (props.pullRequestResponse?.outcome === "unavailable") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8 text-center">
        <div className="max-w-sm">
          <Icon
            name="AlertTriangle"
            className="mx-auto size-5 text-warning-text"
          />
          <h2 className="mt-3 text-sm font-semibold text-foreground">
            Pull request unavailable
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground text-pretty">
            {props.pullRequestResponse.message}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4 min-h-10"
            onClick={props.onRefresh}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (props.pullRequestResponse?.outcome === "available") {
    return (
      <PullRequestDetails
        {...props}
        pullRequest={props.pullRequestResponse.pullRequest}
      />
    );
  }
  return <CreatePullRequestForm {...props} />;
}
