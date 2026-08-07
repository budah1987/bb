import { useEffect, useMemo, useState } from "react";
import type { GithubPullRequest } from "@bb/host-daemon-contract";
import { gitBranchNameSchema } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  CONTROL_HOVER_TRANSITION,
  LIST_HOVER_TRANSITION,
} from "@bb/shared-ui/motion";
import {
  ProjectSelector,
  type ProjectSelectorOption,
} from "@/components/pickers/ProjectSelector";
import "./GithubWorkflowDialog.css";

export type GithubWorkflowStartMode =
  | "existing-branch"
  | "new-branch"
  | "pull-request";
export type GithubWorkflowCheckoutMode = "local" | "worktree";

export interface GithubWorkflowSelection {
  checkoutMode: GithubWorkflowCheckoutMode;
  projectId: string;
  start:
    | {
        kind: "existing-branch";
        branchName: string;
      }
    | {
        kind: "new-branch";
        baseBranch: string;
        branchName: string;
      }
    | {
        kind: "pull-request";
        pullRequest: GithubPullRequest;
        localBranchName: string;
      };
}

interface GithubWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: readonly ProjectSelectorOption[];
  projectId: string | null;
  onProjectChange: (projectId: string) => void;
  branches: readonly string[];
  defaultBranch: string | null;
  currentBranch: string | null;
  branchesLoading?: boolean;
  branchesError?: string | null;
  pullRequests: readonly GithubPullRequest[];
  pullRequestsLoading?: boolean;
  pullRequestsError?: string | null;
  localDisabledReason?: string | null;
  worktreeDisabledReason?: string | null;
  onApply: (selection: GithubWorkflowSelection) => void;
}

const BRANCH_TYPES = [
  { value: "feature", label: "Feature" },
  { value: "fix", label: "Fix" },
  { value: "chore", label: "Chore" },
  { value: "docs", label: "Docs" },
  { value: "refactor", label: "Refactor" },
  { value: "", label: "No prefix" },
] as const;

function toBranchSlug(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._/-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-/.]+|[-/.]+$/gu, "");
}

function pullRequestLocalBranch(pullRequest: GithubPullRequest): string {
  const headSlug = toBranchSlug(pullRequest.headBranch).replaceAll("/", "-");
  return `pr-${pullRequest.number}-${headSlug}`;
}

function ChoiceButton(props: {
  active: boolean;
  title: string;
  description: string;
  icon: "GitBranch" | "GitPullRequest" | "Laptop" | "FolderGit" | "Plus";
  disabledReason?: string | null;
  onClick: () => void;
}) {
  const disabled = Boolean(props.disabledReason);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.active}
      disabled={disabled}
      title={props.disabledReason ?? undefined}
      onClick={props.onClick}
      className={cn(
        "flex min-h-20 min-w-0 flex-1 items-start gap-3 rounded-lg border px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        CONTROL_HOVER_TRANSITION,
        props.active
          ? "border-foreground/25 bg-state-active"
          : "border-border hover:bg-state-hover",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted">
        <Icon name={props.icon} className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {props.title}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {props.disabledReason ?? props.description}
        </span>
      </span>
      <Icon
        name="Check"
        className={cn(
          "ml-auto mt-1 size-4 shrink-0",
          props.active ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
    </button>
  );
}

export function GithubWorkflowDialog({
  open,
  onOpenChange,
  projects,
  projectId,
  onProjectChange,
  branches,
  defaultBranch,
  currentBranch,
  branchesLoading = false,
  branchesError,
  pullRequests,
  pullRequestsLoading = false,
  pullRequestsError,
  localDisabledReason,
  worktreeDisabledReason,
  onApply,
}: GithubWorkflowDialogProps) {
  const [startMode, setStartMode] =
    useState<GithubWorkflowStartMode>("existing-branch");
  const [checkoutMode, setCheckoutMode] =
    useState<GithubWorkflowCheckoutMode>("worktree");
  const [existingBranch, setExistingBranch] = useState("");
  const [existingBranchQuery, setExistingBranchQuery] = useState("");
  const [branchType, setBranchType] = useState("feature");
  const [branchSlug, setBranchSlug] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [selectedPullRequestNumber, setSelectedPullRequestNumber] = useState<
    number | null
  >(null);

  const fallbackBaseBranch =
    currentBranch ?? defaultBranch ?? branches[0] ?? "";
  const resolvedBaseBranch = baseBranch || fallbackBaseBranch;
  const branchName = `${branchType ? `${branchType}/` : ""}${toBranchSlug(branchSlug)}`;
  const branchNameValid = gitBranchNameSchema.safeParse(branchName).success;
  const branchNameTaken =
    branchName.length > 0 &&
    branches.some(
      (branch) => branch === branchName || branch.endsWith(`/${branchName}`),
    );
  const selectedPullRequest =
    pullRequests.find(
      (pullRequest) => pullRequest.number === selectedPullRequestNumber,
    ) ?? null;
  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedProjectHasGithub =
    selectedProject?.githubRepository !== undefined;
  const filteredExistingBranches = useMemo(() => {
    const query = existingBranchQuery.trim().toLocaleLowerCase();
    if (!query) return branches;
    return branches.filter((branch) =>
      branch.toLocaleLowerCase().includes(query),
    );
  }, [branches, existingBranchQuery]);

  useEffect(() => {
    if (!open) return;
    setBaseBranch(fallbackBaseBranch);
  }, [fallbackBaseBranch, open]);

  useEffect(() => {
    if (!open) return;
    setExistingBranch((current) =>
      current && branches.includes(current) ? current : fallbackBaseBranch,
    );
  }, [branches, fallbackBaseBranch, open]);

  useEffect(() => {
    setExistingBranchQuery("");
  }, [projectId]);

  useEffect(() => {
    if (startMode === "pull-request" && !selectedProjectHasGithub) {
      setStartMode("existing-branch");
    }
  }, [selectedProjectHasGithub, startMode]);

  useEffect(() => {
    if (
      checkoutMode === "worktree" &&
      worktreeDisabledReason &&
      !localDisabledReason
    ) {
      setCheckoutMode("local");
    }
  }, [checkoutMode, localDisabledReason, worktreeDisabledReason]);

  useEffect(() => {
    if (
      selectedPullRequestNumber !== null &&
      !pullRequests.some(
        (pullRequest) => pullRequest.number === selectedPullRequestNumber,
      )
    ) {
      setSelectedPullRequestNumber(null);
    }
  }, [pullRequests, selectedPullRequestNumber]);

  const canApply =
    selectedProject !== undefined &&
    (checkoutMode === "local"
      ? !localDisabledReason
      : !worktreeDisabledReason) &&
    (startMode === "existing-branch"
      ? existingBranch.length > 0 && branches.includes(existingBranch)
      : startMode === "new-branch"
        ? resolvedBaseBranch.length > 0 && branchNameValid && !branchNameTaken
        : selectedPullRequest !== null);

  const handleApply = () => {
    if (!canApply || !projectId) return;
    if (startMode === "existing-branch") {
      onApply({
        projectId,
        checkoutMode,
        start: { kind: "existing-branch", branchName: existingBranch },
      });
    } else if (startMode === "new-branch") {
      onApply({
        projectId,
        checkoutMode,
        start: {
          kind: "new-branch",
          baseBranch: resolvedBaseBranch,
          branchName,
        },
      });
    } else if (selectedPullRequest) {
      onApply({
        projectId,
        checkoutMode,
        start: {
          kind: "pull-request",
          pullRequest: selectedPullRequest,
          localBranchName: pullRequestLocalBranch(selectedPullRequest),
        },
      });
    }
    onOpenChange(false);
  };

  const applyLabel =
    checkoutMode === "worktree"
      ? startMode === "new-branch"
        ? "Create branch & worktree"
        : "Create worktree"
      : startMode === "new-branch"
        ? "Create branch"
        : "Use branch";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        compactContentClassName="h-dvh max-h-dvh rounded-none"
        className="flex max-h-[min(760px,calc(100dvh-2rem))] w-[min(44rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 max-md:h-full max-md:max-h-none max-md:w-full"
      >
        <DialogHeader className="relative shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>Start new work</DialogTitle>
          <DialogDescription>
            Choose a repository, starting point, and workspace for this thread.
          </DialogDescription>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 md:hidden"
              aria-label="Close repository workflow"
            >
              <Icon name="X" aria-hidden />
            </Button>
          </DialogClose>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="space-y-5">
            <section aria-labelledby="workflow-repository-label">
              <div
                id="workflow-repository-label"
                className="mb-2 text-xs font-medium text-muted-foreground"
              >
                Repository
              </div>
              {projects.length > 0 ? (
                <ProjectSelector
                  projects={projects}
                  value={projectId}
                  onChange={(nextProjectId) => {
                    if (nextProjectId) onProjectChange(nextProjectId);
                  }}
                  className="h-10 w-full justify-between rounded-lg border px-3"
                  modal={false}
                />
              ) : (
                <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  Add a repository project before starting this workflow.
                </div>
              )}
            </section>

            <section aria-labelledby="workflow-start-label">
              <div
                id="workflow-start-label"
                className="mb-2 text-xs font-medium text-muted-foreground"
              >
                Start from
              </div>
              <div
                className="grid gap-2 sm:grid-cols-3"
                role="radiogroup"
                aria-label="Starting point"
              >
                <ChoiceButton
                  active={startMode === "existing-branch"}
                  title="Existing branch"
                  description="Start from a branch that already exists."
                  icon="GitBranch"
                  onClick={() => setStartMode("existing-branch")}
                />
                <ChoiceButton
                  active={startMode === "new-branch"}
                  title="New branch"
                  description="Create a named branch from an existing base."
                  icon="Plus"
                  onClick={() => setStartMode("new-branch")}
                />
                <ChoiceButton
                  active={startMode === "pull-request"}
                  title="Pull request"
                  description="Use the head commit from an open pull request."
                  icon="GitPullRequest"
                  disabledReason={
                    selectedProjectHasGithub
                      ? null
                      : "Requires a GitHub remote."
                  }
                  onClick={() => setStartMode("pull-request")}
                />
              </div>

              <div className="t-page-slide mt-3 min-h-[17rem] rounded-lg bg-muted/35">
                <div
                  className="page flex flex-col gap-3 p-3 sm:p-4"
                  data-state={
                    startMode === "existing-branch" ? "active" : "inactive"
                  }
                  aria-hidden={startMode !== "existing-branch"}
                  inert={startMode !== "existing-branch"}
                >
                  {branchesLoading ? (
                    <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
                      Loading branches…
                    </div>
                  ) : branchesError ? (
                    <div className="grid flex-1 place-items-center px-4 text-center text-sm text-destructive">
                      {branchesError}
                    </div>
                  ) : branches.length === 0 ? (
                    <div className="grid flex-1 place-items-center px-4 text-center text-sm text-muted-foreground">
                      No branches were found for this repository.
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Icon
                          name="Search"
                          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                          aria-hidden
                        />
                        <Input
                          value={existingBranchQuery}
                          onChange={(event) =>
                            setExistingBranchQuery(event.target.value)
                          }
                          placeholder="Search branches"
                          aria-label="Search branches"
                          className="pl-9"
                        />
                      </div>
                      {filteredExistingBranches.length === 0 ? (
                        <div className="grid flex-1 place-items-center px-4 text-center text-sm text-muted-foreground">
                          No branches match “{existingBranchQuery.trim()}”.
                        </div>
                      ) : (
                        <div
                          className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1"
                          role="radiogroup"
                          aria-label="Existing branches"
                        >
                          {filteredExistingBranches.map((branch) => (
                            <button
                              key={branch}
                              type="button"
                              role="radio"
                              aria-checked={branch === existingBranch}
                              onClick={() => setExistingBranch(branch)}
                              className={cn(
                                "flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.96] motion-reduce:active:scale-100",
                                LIST_HOVER_TRANSITION,
                                branch === existingBranch
                                  ? "bg-state-active"
                                  : "hover:bg-state-hover",
                              )}
                            >
                              <Icon
                                name="GitBranch"
                                className="size-4 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                {branch}
                              </span>
                              <Icon
                                name="Check"
                                className={cn(
                                  "size-4 shrink-0 transition-opacity motion-reduce:transition-none",
                                  branch === existingBranch
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                                aria-hidden
                              />
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div
                  className="page space-y-4 p-3 sm:p-4"
                  data-state={
                    startMode === "new-branch" ? "active" : "inactive"
                  }
                  aria-hidden={startMode !== "new-branch"}
                  inert={startMode !== "new-branch"}
                >
                  <div>
                    <div
                      id="github-workflow-base-branch-label"
                      className="mb-1.5 block text-xs font-medium text-muted-foreground"
                    >
                      Base branch
                    </div>
                    {branchesError ? (
                      <div className="flex h-9 items-center rounded-md border border-destructive/30 px-3 text-sm text-destructive">
                        {branchesError}
                      </div>
                    ) : (
                      <select
                        id="github-workflow-base-branch"
                        aria-labelledby="github-workflow-base-branch-label"
                        value={resolvedBaseBranch}
                        disabled={branchesLoading || branches.length === 0}
                        onChange={(event) => setBaseBranch(event.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                      >
                        {resolvedBaseBranch &&
                        !branches.includes(resolvedBaseBranch) ? (
                          <option value={resolvedBaseBranch}>
                            {resolvedBaseBranch}
                          </option>
                        ) : null}
                        {branches.map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))}
                      </select>
                    )}
                    {!branchesError &&
                    !branchesLoading &&
                    branches.length === 0 ? (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        No branches are available for this repository.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label
                      htmlFor="github-workflow-branch-name"
                      className="mb-1.5 block text-xs font-medium text-muted-foreground"
                    >
                      Branch name
                    </label>
                    <div className="flex min-w-0 gap-2">
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-32 shrink-0 justify-between px-3"
                          >
                            {BRANCH_TYPES.find(
                              (type) => type.value === branchType,
                            )?.label ?? "Prefix"}
                            <Icon name="ChevronDown" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-44">
                          <DropdownMenuLabel>Branch type</DropdownMenuLabel>
                          {BRANCH_TYPES.map((type) => (
                            <DropdownMenuItem
                              key={type.value}
                              onSelect={() => setBranchType(type.value)}
                            >
                              <span className="flex-1">{type.label}</span>
                              {type.value ? (
                                <span className="text-muted-foreground">
                                  {type.value}/
                                </span>
                              ) : null}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Input
                        id="github-workflow-branch-name"
                        value={branchSlug}
                        onChange={(event) => setBranchSlug(event.target.value)}
                        placeholder="short-description"
                        aria-invalid={branchSlug.length > 0 && !branchNameValid}
                      />
                    </div>
                    <div className="mt-1.5 min-h-4 truncate font-mono text-xs text-muted-foreground">
                      {branchName || "Enter a branch name"}
                    </div>
                    {branchNameTaken ? (
                      <p className="mt-1 text-xs text-destructive">
                        This branch already exists. Choose a new name.
                      </p>
                    ) : null}
                  </div>
                </div>

                <div
                  className="page flex flex-col p-3 sm:p-4"
                  data-state={
                    startMode === "pull-request" ? "active" : "inactive"
                  }
                  aria-hidden={startMode !== "pull-request"}
                  inert={startMode !== "pull-request"}
                >
                  {pullRequestsLoading ? (
                    <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
                      Loading pull requests…
                    </div>
                  ) : pullRequestsError ? (
                    <div className="grid flex-1 place-items-center px-4 text-center text-sm text-destructive">
                      {pullRequestsError}
                    </div>
                  ) : pullRequests.length === 0 ? (
                    <div className="grid flex-1 place-items-center px-4 text-center text-sm text-muted-foreground">
                      No open pull requests were found for this repository.
                    </div>
                  ) : (
                    <div
                      className="max-h-[15rem] space-y-1 overflow-y-auto pr-1"
                      role="radiogroup"
                      aria-label="Open pull requests"
                    >
                      {pullRequests.map((pullRequest) => (
                        <button
                          key={pullRequest.number}
                          type="button"
                          role="radio"
                          aria-checked={
                            pullRequest.number === selectedPullRequestNumber
                          }
                          onClick={() =>
                            setSelectedPullRequestNumber(pullRequest.number)
                          }
                          className={cn(
                            "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                            LIST_HOVER_TRANSITION,
                            pullRequest.number === selectedPullRequestNumber
                              ? "bg-state-active"
                              : "hover:bg-state-hover",
                          )}
                        >
                          <Icon
                            name="GitPullRequest"
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="shrink-0 text-xs text-muted-foreground">
                                #{pullRequest.number}
                              </span>
                              <span className="truncate text-sm font-medium">
                                {pullRequest.title}
                              </span>
                              {pullRequest.isDraft ? (
                                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                  Draft
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {pullRequest.headRepository}:
                              {pullRequest.headBranch} →{" "}
                              {pullRequest.baseBranch}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section aria-labelledby="workflow-checkout-label">
              <div
                id="workflow-checkout-label"
                className="mb-2 text-xs font-medium text-muted-foreground"
              >
                Work in
              </div>
              <div
                className="flex flex-col gap-2 sm:flex-row"
                role="radiogroup"
                aria-label="Checkout location"
              >
                <ChoiceButton
                  active={checkoutMode === "worktree"}
                  title="New worktree"
                  description="Keep the current checkout untouched and work in an isolated directory."
                  icon="FolderGit"
                  disabledReason={worktreeDisabledReason}
                  onClick={() => setCheckoutMode("worktree")}
                />
                <ChoiceButton
                  active={checkoutMode === "local"}
                  title="Current checkout"
                  description="Switch this repository in place before the thread starts."
                  icon="Laptop"
                  disabledReason={localDisabledReason}
                  onClick={() => setCheckoutMode("local")}
                />
              </div>
            </section>
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t bg-background px-4 py-3 sm:px-5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!canApply} onClick={handleApply}>
            {applyLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
