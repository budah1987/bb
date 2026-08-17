import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { EnvironmentPreviewProvider } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import { appToast } from "@/components/ui/app-toast";
import {
  useControlEnvironmentDocker,
  useStartEnvironmentDevServer,
  useUpdateEnvironment,
} from "@/hooks/mutations/environment-mutations";
import {
  useEnvironment,
  useEnvironmentPreviews,
  useEnvironmentWorkStatus,
} from "@/hooks/queries/environment-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useGithubAccounts } from "@/hooks/queries/system-queries";
import {
  useCloseTerminal,
  useEnvironmentTerminals,
  useRestartTerminal,
} from "@/hooks/queries/thread-terminal-queries";
import { useThread } from "@/hooks/queries/thread-queries";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { useSetFixedSecondaryPanelTab } from "@/lib/fixed-panel-tabs";
import { useOpenFixedPreviewPanel } from "@/lib/fixed-panel-tabs";
import { parseGithubRepositoryName } from "@/lib/github-repository";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { resolvePreviewProviderStatus } from "@/lib/preview-provider-status";
import { getPluginPanelRoutePath } from "@/lib/route-paths";
import { statusTierClassName } from "@/lib/status-tier";
import { GithubAccountRailRow } from "./GithubAccountRailRow";
import { RailRow } from "./RailRow";
import {
  RAIL_BODY_TEXT_CLASS,
  RAIL_INTERACTIVE_CLASS,
} from "./railStyleTokens";

type PreviewPreference = "auto" | "local" | "vercel";

const PREVIEW_PREFERENCE_PREFIX = "bb.environment.previewSource";
const NON_WEB_SERVICE_PATTERN =
  /(?:^|[-_\s])(db|database|postgres|redis|mysql|mongo|queue|broker)(?:$|[-_\s])/iu;
const WEB_SERVICE_PATTERN =
  /(?:^|[-_\s])(web|app|frontend|front-end|ui|client)(?:$|[-_\s])/iu;
const COMMON_NON_WEB_PORTS = new Set([3306, 5432, 5672, 6379, 9092, 27017]);

function previewPreferenceKey(environmentId: string): string {
  return `${PREVIEW_PREFERENCE_PREFIX}.${encodeURIComponent(environmentId)}`;
}

function readPreviewPreference(
  environmentId: string | null | undefined,
): PreviewPreference {
  if (!environmentId || typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(
    previewPreferenceKey(environmentId),
  );
  return stored === "local" || stored === "vercel" ? stored : "auto";
}

function chooseBestProvider(
  providers: readonly EnvironmentPreviewProvider[],
): EnvironmentPreviewProvider | null {
  const suitability = (provider: EnvironmentPreviewProvider): number => {
    if (provider.source === "terminal") return 0;
    if (WEB_SERVICE_PATTERN.test(provider.label)) return 1;
    if (
      NON_WEB_SERVICE_PATTERN.test(provider.label) ||
      (provider.port !== null && COMMON_NON_WEB_PORTS.has(provider.port))
    ) {
      return 3;
    }
    return 2;
  };
  return (
    [...providers].sort(
      (left, right) =>
        (left.state === "ready"
          ? 0
          : left.state === "building"
            ? 1
            : left.state === "failed"
              ? 2
              : 3) -
          (right.state === "ready"
            ? 0
            : right.state === "building"
              ? 1
              : right.state === "failed"
                ? 2
                : 3) ||
        suitability(left) - suitability(right) ||
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
    )[0] ?? null
  );
}

export function selectAdaptivePreview(args: {
  preference: PreviewPreference;
  providers: readonly EnvironmentPreviewProvider[];
}): {
  provider: EnvironmentPreviewProvider | null;
  source: "local" | "vercel";
} {
  const local = args.providers.filter((provider) => provider.kind === "local");
  const deployment = args.providers.filter(
    (provider) => provider.kind === "deployment",
  );
  const preferredSource =
    args.preference === "local"
      ? "local"
      : args.preference === "vercel"
        ? "vercel"
        : deployment.length > 0
          ? "vercel"
          : "local";
  const source =
    preferredSource === "local" && local.length === 0 && deployment.length > 0
      ? "vercel"
      : preferredSource === "vercel" &&
          deployment.length === 0 &&
          local.length > 0
        ? "local"
        : preferredSource;
  return {
    provider: chooseBestProvider(source === "local" ? local : deployment),
    source,
  };
}

function parseDockerContainerId(providerId: string): string | null {
  const match = /^docker:([^:]+):\d+$/u.exec(providerId);
  return match?.[1] ?? null;
}

export function EnvironmentSection({
  enabled = true,
  threadId,
}: {
  enabled?: boolean;
  threadId: string;
}) {
  const navigate = useNavigate();
  const [preference, setPreference] = useState<PreviewPreference>("auto");
  const [isStartDialogOpen, setIsStartDialogOpen] = useState(false);
  const [serverTitle, setServerTitle] = useState("Dev server");
  const [serverCommand, setServerCommand] = useState(
    "pnpm dev -- --port {port}",
  );
  const threadQuery = useThread(threadId, { enabled });
  const environmentId = threadQuery.data?.environmentId;
  const environmentQuery = useEnvironment(environmentId, { enabled });
  const environment = environmentQuery.data;
  const statusQuery = useEnvironmentWorkStatus(environmentId, undefined, {
    enabled,
  });
  const previewsQuery = useEnvironmentPreviews(environmentId, { enabled });
  const navigationQuery = useSidebarNavigation({ enabled });
  const project = navigationQuery.data?.projects.find(
    (candidate) => candidate.id === threadQuery.data?.projectId,
  );
  const repositoryLabel =
    parseGithubRepositoryName(project?.gitRemoteUrl ?? null) ??
    project?.name ??
    "Repository";
  const githubAccountsQuery = useGithubAccounts({
    ...(environment?.hostId === undefined
      ? {}
      : { hostId: environment.hostId }),
    enabled: enabled && environment !== undefined,
  });
  const githubAccounts = githubAccountsQuery.data?.accounts ?? [];
  const selectedGithubAccountLogin =
    environment?.githubAccountLogin ??
    githubAccounts.find((account) => account.active)?.login ??
    githubAccounts[0]?.login ??
    null;
  const updateEnvironment = useUpdateEnvironment();
  const setSecondaryPanelTab = useSetFixedSecondaryPanelTab(threadId, threadId);
  const openPreviewPanel = useOpenFixedPreviewPanel(threadId, threadId);
  const environmentTerminalsQuery = useEnvironmentTerminals(
    environmentId ?? "",
    { enabled },
  );
  const closeTerminal = useCloseTerminal();
  const restartTerminal = useRestartTerminal();
  const controlDocker = useControlEnvironmentDocker();
  const startDevServer = useStartEnvironmentDevServer();

  useEffect(() => {
    setPreference(readPreviewPreference(environmentId));
  }, [environmentId]);

  const providers = useMemo(
    () => previewsQuery.data?.providers ?? [],
    [previewsQuery.data?.providers],
  );
  const adaptivePreview = useMemo(
    () => selectAdaptivePreview({ preference, providers }),
    [preference, providers],
  );
  const localProvidersExist = providers.some(
    (provider) => provider.kind === "local",
  );
  const deploymentsExist = providers.some(
    (provider) => provider.kind === "deployment",
  );
  const provider = adaptivePreview.provider;
  const isLocal = adaptivePreview.source === "local";
  const previewStatus = provider
    ? resolvePreviewProviderStatus({
        now: previewsQuery.dataUpdatedAt,
        provider,
      })
    : {
        label: previewsQuery.isError
          ? "Failed"
          : previewsQuery.isLoading
            ? "Loading"
            : isLocal
              ? "Stopped"
              : "None",
        tier: previewsQuery.isError
          ? ("destructive" as const)
          : ("muted" as const),
      };
  const terminal =
    provider?.source === "terminal" && provider.port !== null
      ? (environmentTerminalsQuery.data?.sessions.find(
          (session) => session.devServerPort === provider.port,
        ) ?? null)
      : null;
  const dockerContainerId =
    provider?.source === "docker" ? parseDockerContainerId(provider.id) : null;
  const previewBusy =
    closeTerminal.isPending ||
    restartTerminal.isPending ||
    controlDocker.isPending ||
    startDevServer.isPending;

  const setPreviewPreference = useCallback(
    (next: PreviewPreference) => {
      setPreference(next);
      if (environmentId) {
        window.localStorage.setItem(previewPreferenceKey(environmentId), next);
      }
    },
    [environmentId],
  );

  const handleGithubAccountChange = useCallback(
    async (login: string) => {
      if (!environmentId || environment?.githubAccountLogin === login) return;
      const toastId = appToast.loading(`Switching to @${login}`);
      try {
        await updateEnvironment.mutateAsync({
          id: environmentId,
          githubAccountLogin: login,
        });
        appToast.success(`Using @${login} for this worktree`, { id: toastId });
      } catch (error) {
        appToast.error("GitHub account was not changed", {
          id: toastId,
          description: getMutationErrorMessage({
            error,
            fallbackMessage: `Could not use @${login}`,
          }),
        });
      }
    },
    [environment?.githubAccountLogin, environmentId, updateEnvironment],
  );

  const openProvider = useCallback(() => {
    if (previewsQuery.isError) {
      void previewsQuery.refetch();
      return;
    }
    if (!provider) {
      if (isLocal) setIsStartDialogOpen(true);
      return;
    }
    openPreviewPanel({
      environmentId: environmentId ?? null,
      label: isLocal ? "Local preview" : "Vercel preview",
      providerId: provider.id,
    });
  }, [environmentId, isLocal, openPreviewPanel, previewsQuery, provider]);

  const runPreviewAction = useCallback(async () => {
    if (!environmentId) return;
    if (previewsQuery.isError) {
      await previewsQuery.refetch();
      return;
    }
    if (!isLocal) {
      const url = provider?.branchUrl ?? provider?.url;
      if (url) {
        await copyToClipboardWithToast(url, {
          successMessage: "Preview URL copied",
        });
      }
      return;
    }
    if (!provider) {
      setIsStartDialogOpen(true);
      return;
    }
    if (provider.state === "ready") {
      if (terminal) {
        await closeTerminal.mutateAsync({
          mode: "force",
          terminalId: terminal.id,
        });
      } else if (dockerContainerId) {
        await controlDocker.mutateAsync({
          action: "stop",
          containerId: dockerContainerId,
          environmentId,
        });
      }
      return;
    }
    if (terminal) {
      await restartTerminal.mutateAsync({ terminalId: terminal.id });
    } else if (dockerContainerId) {
      await controlDocker.mutateAsync({
        action: "restart",
        containerId: dockerContainerId,
        environmentId,
      });
    } else {
      setIsStartDialogOpen(true);
    }
  }, [
    closeTerminal,
    controlDocker,
    dockerContainerId,
    environmentId,
    isLocal,
    provider,
    previewsQuery,
    restartTerminal,
    terminal,
  ]);

  const startServer = useCallback(async () => {
    if (!environmentId || !serverTitle.trim() || !serverCommand.trim()) return;
    try {
      await startDevServer.mutateAsync({
        command: serverCommand.trim(),
        environmentId,
        threadId,
        title: serverTitle.trim(),
      });
      setIsStartDialogOpen(false);
      appToast.success("Local preview starting");
    } catch (error) {
      appToast.error("Local preview did not start", {
        description: getMutationErrorMessage({
          error,
          fallbackMessage: "Check the development command and try again.",
        }),
      });
    }
  }, [environmentId, serverCommand, serverTitle, startDevServer, threadId]);

  const workspace =
    statusQuery.data?.outcome === "available"
      ? statusQuery.data.workspace
      : null;
  const changes = workspace?.workingTree;
  const hasChanges = changes?.hasUncommittedChanges ?? false;
  const previewActionLabel = previewsQuery.isError
    ? "Retry previews"
    : !isLocal
      ? "Copy Vercel preview URL"
      : !provider
        ? "Start local preview"
        : provider.state === "ready"
          ? "Stop local preview"
          : "Restart local preview";
  const previewActionIcon = previewsQuery.isError
    ? "RotateCcw"
    : !isLocal
      ? "Copy"
      : !provider
        ? "Play"
        : provider.state === "ready"
          ? "Square"
          : "RotateCcw";

  return (
    <>
      <div className="flex min-w-0 flex-col">
        <RailRow
          icon="Github"
          label={repositoryLabel}
          showsChevron
          onSelect={() =>
            navigate(
              getPluginPanelRoutePath({
                pluginId: "conductor-workspaces",
                path: "repository-details",
                subPath: threadQuery.data?.projectId,
              }),
            )
          }
        />
        <RailRow
          icon="FileDiff"
          label="Changes"
          onSelect={() => setSecondaryPanelTab("git-diff")}
          showsChevron
          trailing={
            statusQuery.isError ? (
              <span className="text-xs text-destructive">Unavailable</span>
            ) : statusQuery.isLoading ? (
              <span className="text-xs text-muted-foreground">Loading</span>
            ) : hasChanges && changes ? (
              <span className="shrink-0 text-xs tabular-nums">
                <span className="text-success">+{changes.insertions}</span>{" "}
                <span className="text-destructive">−{changes.deletions}</span>
              </span>
            ) : (workspace?.mergeBase?.aheadCount ?? 0) > 0 ? (
              <span className="text-xs text-muted-foreground">
                {workspace?.mergeBase?.aheadCount} commits
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Clean</span>
            )
          }
        />
        <RailRow
          icon="GitBranch"
          label={
            workspace?.branch.currentBranch ??
            environment?.branchName ??
            "No branch"
          }
          trailing={environment?.isWorktree ? "Worktree" : null}
        />
        <GithubAccountRailRow
          accounts={githubAccounts}
          disabled={updateEnvironment.isPending}
          isLoading={
            environmentQuery.isLoading || githubAccountsQuery.isLoading
          }
          onChange={(login) => void handleGithubAccountChange(login)}
          value={selectedGithubAccountLogin}
        />
        <div className="flex min-w-0 items-center">
          <button
            type="button"
            disabled={!previewsQuery.isError && !provider && !isLocal}
            onClick={openProvider}
            className={cn(
              RAIL_INTERACTIVE_CLASS,
              RAIL_BODY_TEXT_CLASS,
              "min-w-0 flex-1 cursor-pointer text-muted-foreground disabled:pointer-events-none disabled:opacity-60",
            )}
          >
            <Icon
              name={isLocal ? "Browser" : "Container"}
              className="size-4 shrink-0"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">
              {isLocal ? "Local preview" : "Vercel preview"}
            </span>
            <span
              className={cn(
                "shrink-0 text-xs",
                statusTierClassName(previewStatus.tier),
              )}
            >
              {previewStatus.label}
            </span>
          </button>
          {localProvidersExist && deploymentsExist ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Choose preview source"
                  className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.96]"
                >
                  <Icon name="ChevronDown" className="size-3" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" mobileTitle="Preview source">
                {(["auto", "local", "vercel"] as const).map((source) => (
                  <DropdownMenuItem
                    key={source}
                    onSelect={() => setPreviewPreference(source)}
                  >
                    <span className="min-w-0 flex-1 capitalize">{source}</span>
                    <Icon
                      name="Check"
                      className={cn(
                        "size-4",
                        preference === source ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden
                    />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <button
            type="button"
            aria-label={previewActionLabel}
            disabled={
              previewBusy ||
              (!isLocal && !provider?.url && !provider?.branchUrl)
            }
            onClick={() => void runPreviewAction()}
            className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon
              name={previewBusy ? "Spinner" : previewActionIcon}
              className={cn("size-4", previewBusy && "animate-spin")}
              aria-hidden
            />
          </button>
        </div>
      </div>

      <Dialog open={isStartDialogOpen} onOpenChange={setIsStartDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start local preview</DialogTitle>
            <DialogDescription>
              BB keeps this server attached to the environment and reuses its
              assigned port.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <label className="grid gap-1.5 text-sm">
              Name
              <Input
                value={serverTitle}
                onChange={(event) => setServerTitle(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              Command
              <Input
                value={serverCommand}
                onChange={(event) => setServerCommand(event.target.value)}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Include {"{port}"} where the assigned port belongs.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsStartDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                startDevServer.isPending ||
                !serverTitle.trim() ||
                !serverCommand.includes("{port}")
              }
              onClick={() => void startServer()}
            >
              {startDevServer.isPending ? "Starting…" : "Start preview"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
