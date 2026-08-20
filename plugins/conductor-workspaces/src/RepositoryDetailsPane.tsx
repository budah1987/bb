import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  useRpc,
  type PluginNavPanelProps,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import {
  buildConductorProjection,
  pickWorkspaceThread,
  type ConductorWorkspace,
} from "./projection";
import { loadProjectCustomizations } from "./project-customizations";
import {
  conversationSignal,
  signalLabel,
  workspaceSignal,
} from "./thread-state";
import { useReconciliation } from "./useReconciliation";
import type { conductorRpcContract } from "./rpc-contract";

const REPOSITORY_DETAILS_PATH = "repository-details";
const REPOSITORY_DETAIL_TABS = [
  "overview",
  "git",
  "github",
  "manager",
] as const;
const MANAGER_REASONING_LEVELS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultracode",
  "max",
  "ultra",
] as const;
const MANAGER_PERMISSION_MODES = ["accept-edits", "auto", "full"] as const;
const MANAGER_SERVICE_TIERS = ["default", "fast"] as const;

type RepositoryDetailTab = (typeof REPOSITORY_DETAIL_TABS)[number];

function selectValue<T extends string>(
  value: string,
  options: readonly T[],
): T | null {
  for (const option of options) {
    if (option === value) return option;
  }
  return null;
}

function actionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

export function repositoryDetailsSubPath(projectId: string): string {
  return encodeURIComponent(projectId);
}

function projectIdFromSubPath(subPath: string): string | null {
  if (!subPath) return null;
  try {
    return decodeURIComponent(subPath.split("/")[0] ?? "") || null;
  } catch {
    return null;
  }
}

export function openRepositoryDetails(
  navigate: {
    toPluginPanel(path: string, options?: { subPath?: string }): void;
  },
  projectId: string,
) {
  navigate.toPluginPanel(REPOSITORY_DETAILS_PATH, {
    subPath: repositoryDetailsSubPath(projectId),
  });
}

function hasLiveWork(thread: PluginSidebarThread): boolean {
  return Object.values(thread.activity).some((count) => count > 0);
}

function formatRelativeTime(timestamp: number): string {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 60_000),
  );
  if (elapsedMinutes < 1) return "Now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function WorkspaceStatus({ workspace }: { workspace: ConductorWorkspace }) {
  const signal = workspaceSignal(workspace.threads);
  if (signal === "passive") {
    return <span className="repository-details-status">Idle</span>;
  }
  return (
    <span className="repository-details-status" data-signal={signal}>
      {signalLabel(signal)}
    </span>
  );
}

function WorkspaceRow({
  workspace,
  onOpen,
  onUpdateFromMain,
  updateState,
}: {
  workspace: ConductorWorkspace;
  onOpen: () => void;
  onUpdateFromMain?: () => void;
  updateState?: WorkspaceUpdateState;
}) {
  const updateStatusId = useId();
  const isUpdating = updateState?.status === "updating";
  const updateLabel = isUpdating
    ? "Updating…"
    : updateState?.status === "success"
      ? "Check again"
      : updateState?.status === "error"
        ? "Retry update"
        : "Update from main";

  return (
    <article className="repository-details-workspace">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-medium">{workspace.title}</h3>
          <WorkspaceStatus workspace={workspace} />
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {workspace.branchName ?? "No Git branch"}
        </p>
      </div>
      <div className="repository-details-workspace-meta">
        <span className="tabular-nums text-xs text-muted-foreground">
          {workspace.threads.length}{" "}
          {workspace.threads.length === 1 ? "conversation" : "conversations"}
        </span>
        <span className="tabular-nums text-xs text-muted-foreground">
          {formatRelativeTime(workspace.updatedAt)}
        </span>
        <Button variant="outline" size="sm" onClick={onOpen}>
          Open workspace
        </Button>
        {onUpdateFromMain ? (
          <div className="repository-details-update-action">
            <Button
              variant="outline"
              size="sm"
              aria-busy={isUpdating}
              aria-describedby={
                updateState?.message ? updateStatusId : undefined
              }
              disabled={isUpdating}
              onClick={onUpdateFromMain}
            >
              {updateLabel}
            </Button>
            {updateState?.message ? (
              <span
                id={updateStatusId}
                className="repository-details-update-status"
                data-status={updateState.status}
                role={updateState.status === "error" ? "alert" : "status"}
              >
                {updateState.message}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

type ManagerSettings = {
  enabled: boolean;
  providerId: string;
  model: string;
  reasoningLevel:
    | "none"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "ultracode"
    | "max"
    | "ultra";
  serviceTier: "default" | "fast";
  permissionMode: "accept-edits" | "auto" | "full";
};

type WorkspaceUpdateState = {
  status: "updating" | "success" | "error";
  message: string | null;
};

type ManagerFeedback = {
  tone: "success" | "error";
  message: string;
};

function ManagerPanel({
  projectId,
  onOpenThread,
}: {
  projectId: string;
  onOpenThread: (threadId: string) => void;
}) {
  const rpc = useRpc<typeof conductorRpcContract>();
  const [settings, setSettings] = useState<ManagerSettings | null>(null);
  const [focus, setFocus] = useState("");
  const [status, setStatus] = useState<
    "loading" | "ready" | "saving" | "running"
  >("loading");
  const [feedback, setFeedback] = useState<ManagerFeedback | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const actionRequestRef = useRef(0);
  const busyRef = useRef(false);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  useEffect(() => {
    let active = true;
    actionRequestRef.current += 1;
    busyRef.current = false;
    setStatus("loading");
    setFeedback(null);
    setFocus("");
    void rpc
      .call("readProjectManager", { projectId })
      .then((result) => {
        if (!active) return;
        setSettings(result);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSettings(null);
        setStatus("ready");
        setFeedback({
          tone: "error",
          message: actionErrorMessage(
            error,
            "Could not load manager settings.",
          ),
        });
      });
    return () => {
      active = false;
    };
  }, [loadVersion, projectId, rpc]);

  async function save() {
    if (!settings || busyRef.current) return;
    busyRef.current = true;
    const requestId = ++actionRequestRef.current;
    setStatus("saving");
    setFeedback(null);
    try {
      const result = await rpc.call("updateProjectManager", {
        projectId,
        settings,
      });
      if (
        requestId !== actionRequestRef.current ||
        projectIdRef.current !== projectId
      ) {
        return;
      }
      setSettings(result);
      setStatus("ready");
      setFeedback({ tone: "success", message: "Settings saved." });
    } catch (error: unknown) {
      if (
        requestId !== actionRequestRef.current ||
        projectIdRef.current !== projectId
      ) {
        return;
      }
      setStatus("ready");
      setFeedback({
        tone: "error",
        message: actionErrorMessage(error, "Could not save manager settings."),
      });
    } finally {
      if (requestId === actionRequestRef.current) busyRef.current = false;
    }
  }

  async function run() {
    if (!settings?.enabled || busyRef.current) return;
    busyRef.current = true;
    const requestId = ++actionRequestRef.current;
    setStatus("running");
    setFeedback(null);
    try {
      await rpc.call("updateProjectManager", { projectId, settings });
      const result = await rpc.call("runProjectManager", {
        projectId,
        ...(focus.trim() ? { prompt: focus.trim() } : {}),
      });
      if (
        requestId !== actionRequestRef.current ||
        projectIdRef.current !== projectId
      ) {
        return;
      }
      setStatus("ready");
      onOpenThread(result.threadId);
    } catch (error: unknown) {
      if (
        requestId !== actionRequestRef.current ||
        projectIdRef.current !== projectId
      ) {
        return;
      }
      setStatus("ready");
      setFeedback({
        tone: "error",
        message: actionErrorMessage(error, "Could not start the briefing."),
      });
    } finally {
      if (requestId === actionRequestRef.current) busyRef.current = false;
    }
  }

  if (status === "loading") {
    return (
      <p className="repository-details-empty" role="status" aria-live="polite">
        Loading manager settings…
      </p>
    );
  }
  if (!settings) {
    return (
      <div className="repository-details-empty">
        <p className="text-destructive" role="alert">
          {feedback?.message ?? "Could not load manager settings."}
        </p>
        <Button
          className="mt-3"
          variant="outline"
          size="sm"
          onClick={() => setLoadVersion((version) => version + 1)}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div
      id="repository-details-panel-manager"
      className="repository-details-content repository-manager-panel t-panel-slide"
      data-open="true"
      role="tabpanel"
      aria-labelledby="repository-details-tab-manager"
    >
      <section className="repository-manager-intro">
        <div>
          <h2>Repository manager</h2>
          <p>
            A lightweight agent reviews active work and creates a briefing
            thread when you ask.
          </p>
        </div>
      </section>

      <section className="repository-manager-run">
        <label htmlFor="repository-manager-focus">Briefing focus</label>
        <textarea
          id="repository-manager-focus"
          value={focus}
          disabled={status === "saving" || status === "running"}
          onChange={(event) => setFocus(event.target.value)}
          placeholder="Optional: focus on release risk, review work, or blockers."
        />
        <Button
          onClick={() => void run()}
          disabled={
            !settings.enabled || status === "running" || status === "saving"
          }
        >
          {status === "running" ? "Starting…" : "Run briefing"}
        </Button>
        {feedback ? (
          <p
            className={
              feedback.tone === "error"
                ? "text-xs text-destructive"
                : "repository-manager-feedback text-xs"
            }
            role={feedback.tone === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </p>
        ) : null}
      </section>

      <details className="repository-manager-settings-disclosure">
        <summary>
          Agent settings{settings.enabled ? "" : " · Manager disabled"}
        </summary>
        <div className="repository-manager-settings-content">
          <label className="repository-manager-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={status === "saving" || status === "running"}
              onChange={(event) =>
                setSettings({ ...settings, enabled: event.target.checked })
              }
            />
            Enable repository manager
          </label>

          <fieldset
            className="repository-manager-settings"
            aria-label="Manager agent settings"
            disabled={status === "saving" || status === "running"}
          >
            <label>
              <span>Provider</span>
              <input
                value={settings.providerId}
                onChange={(event) =>
                  setSettings({ ...settings, providerId: event.target.value })
                }
              />
            </label>
            <label>
              <span>Model</span>
              <input
                value={settings.model}
                onChange={(event) =>
                  setSettings({ ...settings, model: event.target.value })
                }
              />
            </label>
            <label>
              <span>Reasoning</span>
              <select
                value={settings.reasoningLevel}
                onChange={(event) => {
                  const reasoningLevel = selectValue(
                    event.target.value,
                    MANAGER_REASONING_LEVELS,
                  );
                  if (reasoningLevel) {
                    setSettings({ ...settings, reasoningLevel });
                  }
                }}
              >
                {MANAGER_REASONING_LEVELS.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Permission</span>
              <select
                value={settings.permissionMode}
                onChange={(event) => {
                  const permissionMode = selectValue(
                    event.target.value,
                    MANAGER_PERMISSION_MODES,
                  );
                  if (permissionMode) {
                    setSettings({ ...settings, permissionMode });
                  }
                }}
              >
                <option value="accept-edits">Accept edits</option>
                <option value="auto">Auto</option>
                <option value="full">Full access</option>
              </select>
            </label>
            <label>
              <span>Service tier</span>
              <select
                value={settings.serviceTier}
                onChange={(event) => {
                  const serviceTier = selectValue(
                    event.target.value,
                    MANAGER_SERVICE_TIERS,
                  );
                  if (serviceTier) {
                    setSettings({ ...settings, serviceTier });
                  }
                }}
              >
                <option value="default">Default</option>
                <option value="fast">Fast</option>
              </select>
            </label>
          </fieldset>

          <div className="repository-manager-actions">
            <Button
              variant="outline"
              onClick={() => void save()}
              disabled={status === "saving" || status === "running"}
            >
              {status === "saving" ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}

export interface RepositoryDetailsNativeGithubContext {
  githubAccountLogin: string | null;
  projectId: string;
  repositoryName: string | null;
}

export function RepositoryDetailsPane({
  subPath,
  renderNativeGithub,
}: PluginNavPanelProps & {
  renderNativeGithub?: (
    context: RepositoryDetailsNativeGithubContext,
  ) => ReactNode;
}) {
  const state = useSidebarThreads();
  const actions = useSidebarThreadActions();
  const rpc = useRpc<typeof conductorRpcContract>();
  const { isLoading, legacyWorkspaces } = useReconciliation();
  const [tab, setTab] = useState<RepositoryDetailTab>("overview");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [updateStates, setUpdateStates] = useState<
    Record<string, WorkspaceUpdateState>
  >({});
  const projectId = projectIdFromSubPath(subPath);
  const updateProjectVersionRef = useRef(0);
  const updatingEnvironmentIdsRef = useRef(new Set<string>());
  const customizations = useMemo(loadProjectCustomizations, []);
  const projection = useMemo(
    () =>
      buildConductorProjection(state.threads, state.projects, legacyWorkspaces),
    [legacyWorkspaces, state.projects, state.threads],
  );
  const project = projection.projects.find(
    (candidate) => candidate.id === projectId,
  );
  const nativeProject = state.projects.find(
    (candidate) => candidate.id === projectId,
  );

  useEffect(() => {
    updateProjectVersionRef.current += 1;
    updatingEnvironmentIdsRef.current.clear();
    setUpdateStates({});
  }, [projectId]);

  if (state.status === "loading" || isLoading) {
    return (
      <p
        className="repository-details-message"
        role="status"
        aria-live="polite"
      >
        Loading repository details…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="repository-details-message">
        <p className="text-destructive" role="alert">
          Couldn’t load repository details.
        </p>
        <Button
          className="mt-3 min-h-10"
          variant="outline"
          onClick={() => window.location.reload()}
        >
          Reload bb
        </Button>
      </div>
    );
  }
  if (projectId === null) {
    return (
      <p className="repository-details-message">
        Open a repository’s context menu in Conductor, then select Details.
      </p>
    );
  }
  if (!project || !nativeProject) {
    return (
      <p className="repository-details-message">
        This repository is no longer available.
      </p>
    );
  }

  const label =
    customizations[project.id]?.name ?? project.repositoryName ?? project.name;
  const conversationCount = project.workspaces.reduce(
    (count, workspace) => count + workspace.threads.length,
    0,
  );
  const workingCount = project.workspaces.filter((workspace) =>
    workspace.threads.some(hasLiveWork),
  ).length;
  const attentionCount = project.workspaces.filter((workspace) =>
    workspace.threads.some((thread) =>
      ["failed", "waiting", "ready"].includes(conversationSignal(thread)),
    ),
  ).length;

  function openWorkspace(workspace: ConductorWorkspace) {
    const thread = pickWorkspaceThread(workspace, null);
    if (thread) actions.open(thread.id);
  }

  async function updateFromMain(environmentId: string) {
    if (updatingEnvironmentIdsRef.current.has(environmentId)) return;
    updatingEnvironmentIdsRef.current.add(environmentId);
    const projectVersion = updateProjectVersionRef.current;
    setUpdateStates((states) => ({
      ...states,
      [environmentId]: { status: "updating", message: null },
    }));
    try {
      const result = await rpc.call("updateWorkspaceFromMain", {
        environmentId,
      });
      if (projectVersion !== updateProjectVersionRef.current) return;
      setUpdateStates((states) => ({
        ...states,
        [environmentId]: { status: "success", message: result.message },
      }));
    } catch (error: unknown) {
      if (projectVersion !== updateProjectVersionRef.current) return;
      setUpdateStates((states) => ({
        ...states,
        [environmentId]: {
          status: "error",
          message: actionErrorMessage(
            error,
            "Could not update this workspace from main.",
          ),
        },
      }));
    } finally {
      updatingEnvironmentIdsRef.current.delete(environmentId);
    }
  }

  function updateFromMainAction(environmentId: string | null) {
    if (environmentId === null) return undefined;
    return () => void updateFromMain(environmentId);
  }

  function selectTabFromKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % REPOSITORY_DETAIL_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + REPOSITORY_DETAIL_TABS.length) %
        REPOSITORY_DETAIL_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = REPOSITORY_DETAIL_TABS.length - 1;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = REPOSITORY_DETAIL_TABS[nextIndex];
    if (!nextTab) return;
    setTab(nextTab);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <main className="repository-details-pane">
      <header className="repository-details-header">
        <div className="min-w-0">
          <p className="repository-details-eyebrow">Repository</p>
          <h1>{label}</h1>
          <p className="repository-details-description">
            {nativeProject.experimental_gitRemoteUrl ??
              "No Git remote is configured."}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() =>
            actions.openNewThread({
              projectId: project.id,
              focusPrompt: true,
              experimental_startGithubWorkflow: true,
            })
          }
        >
          <Icon name="Plus" aria-hidden />
          New workspace
        </Button>
      </header>

      <nav
        className="repository-details-tabs"
        aria-label="Repository details"
        role="tablist"
      >
        {REPOSITORY_DETAIL_TABS.map((value, index) => (
          <button
            key={value}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            id={`repository-details-tab-${value}`}
            type="button"
            role="tab"
            aria-controls={`repository-details-panel-${value}`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={(event) => selectTabFromKeyboard(event, index)}
          >
            {value === "git"
              ? "Git"
              : value === "github"
                ? "GitHub"
                : value === "manager"
                  ? "Manager"
                  : "Overview"}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div
          id="repository-details-panel-overview"
          className="repository-details-content"
          role="tabpanel"
          aria-labelledby="repository-details-tab-overview"
        >
          <section
            className="repository-details-summary"
            aria-label="Repository summary"
          >
            <div>
              <strong>{project.workspaces.length}</strong>
              <span>Workspaces</span>
            </div>
            <div>
              <strong>{conversationCount}</strong>
              <span>Conversations</span>
            </div>
            <div>
              <strong>{workingCount}</strong>
              <span>Working</span>
            </div>
            <div>
              <strong>{attentionCount}</strong>
              <span>Need attention</span>
            </div>
          </section>
          <section>
            <div className="repository-details-section-heading">
              <div>
                <h2>Workspaces</h2>
                <p>Live work grouped by environment.</p>
              </div>
            </div>
            <div className="repository-details-workspaces">
              {project.workspaces.length === 0 ? (
                <p className="repository-details-empty">
                  No active workspaces.
                </p>
              ) : (
                project.workspaces.map((workspace) => (
                  <WorkspaceRow
                    key={workspace.key}
                    workspace={workspace}
                    onOpen={() => openWorkspace(workspace)}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      ) : tab === "git" ? (
        <div
          id="repository-details-panel-git"
          className="repository-details-content"
          role="tabpanel"
          aria-labelledby="repository-details-tab-git"
        >
          <section className="repository-details-git-summary">
            <div>
              <span>Remote</span>
              {nativeProject.experimental_gitRemoteUrl ? (
                <a
                  href={nativeProject.experimental_gitRemoteUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {project.repositoryName ??
                    nativeProject.experimental_gitRemoteUrl}
                </a>
              ) : (
                <strong>Not configured</strong>
              )}
            </div>
            <div>
              <span>GitHub account</span>
              <strong>
                {project.githubAccountLogin
                  ? `@${project.githubAccountLogin}`
                  : "Not set"}
              </strong>
            </div>
          </section>
          <section>
            <div className="repository-details-section-heading">
              <div>
                <h2>Branches and pull requests</h2>
                <p>Git state reported by each active workspace.</p>
              </div>
            </div>
            <div className="repository-details-workspaces">
              {project.workspaces.length === 0 ? (
                <p className="repository-details-empty">
                  No active Git workspaces.
                </p>
              ) : (
                project.workspaces.map((workspace) => (
                  <WorkspaceRow
                    key={workspace.key}
                    workspace={workspace}
                    onOpen={() => openWorkspace(workspace)}
                    onUpdateFromMain={updateFromMainAction(
                      workspace.environmentId,
                    )}
                    updateState={
                      workspace.environmentId
                        ? updateStates[workspace.environmentId]
                        : undefined
                    }
                  />
                ))
              )}
            </div>
          </section>
        </div>
      ) : tab === "github" ? (
        <div
          id="repository-details-panel-github"
          className="repository-details-content"
          role="tabpanel"
          aria-labelledby="repository-details-tab-github"
        >
          {renderNativeGithub?.({
            githubAccountLogin: project.githubAccountLogin,
            projectId: project.id,
            repositoryName: project.repositoryName,
          }) ?? (
            <p className="repository-details-empty">
              Native GitHub details are unavailable.
            </p>
          )}
        </div>
      ) : (
        <ManagerPanel projectId={project.id} onOpenThread={actions.open} />
      )}
    </main>
  );
}
