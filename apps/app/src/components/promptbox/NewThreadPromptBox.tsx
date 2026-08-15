import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import type { Host, ProjectSource, PromptTextMention } from "@bb/domain";
import type { ComposerView } from "@bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@bb/shared-ui/drawer";
import { Icon } from "@bb/shared-ui/icon";
import type { ComposerTextEffectSource } from "@/lib/composer-text-effects";
import { PluginComposerBanners } from "@/components/plugin/PluginComposerBanners";
import {
  PluginComposerHostProvider,
  PluginComposerViewProvider,
  type PluginComposerHost,
  usePluginComposerViewModel,
} from "@/components/plugin/plugin-composer-host";
import {
  useAppCommandContext,
  useAppCommandHandler,
} from "@/components/commands/AppCommandProvider";
import {
  ExecutionControls,
  type ExecutionControlsProps,
  type ExecutionPermissionConfig,
} from "@/components/promptbox/ExecutionControls";
import {
  PromptBoxInternal,
  type AttachmentsConfig,
  type HistoryConfig,
  type PromptBoxAction,
  type PromptBoxHandle,
  type TypeaheadConfig,
} from "@/components/promptbox/PromptBoxInternal";
import { usePromptVoice } from "@/components/promptbox/usePromptVoice";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  BranchPicker,
  type BranchPickerMenuKind,
} from "@/components/pickers/BranchPicker";
import {
  EnvironmentPickerUI,
  type EnvironmentPickerMachines,
  type EnvironmentPickerUIProps,
} from "@/components/pickers/EnvironmentPicker";
import { MachinePickerUI } from "@/components/pickers/MachinePicker";
import {
  encodeHostValue,
  type ParsedEnvironmentValue,
  parseEnvironmentValue,
} from "@/components/pickers/environment-picker-value";
import { PermissionModePicker } from "@/components/pickers/PermissionModePicker";
import {
  ProjectSelector,
  type ProjectSelectorCreateProjectConfig,
  type ProjectSelectorOption,
} from "@/components/pickers/ProjectSelector";
import {
  WorktreePicker,
  type ReuseThreadOption,
} from "@/components/pickers/WorktreePicker";
import { WorktreeBranchNameInput } from "@/components/pickers/WorktreeBranchNameInput";
import { selectPrimaryHost, useHosts } from "@/hooks/queries/host-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import {
  permissionDisplayForPromptMode,
  shouldDisablePermissionPickerForPromptMode,
} from "./effective-prompt-mode";
import type { WorktreeBranchPrefix } from "@/lib/worktree-branch-name";

const NEW_THREAD_PROMPT_BOX_MIN_HEIGHT = 80;
const OPEN_COMPOSER_OVERLAY_TRIGGER_SELECTOR =
  '[aria-haspopup][aria-expanded="true"]';
const DEFAULT_NEW_THREAD_COMPOSER_SCOPE = {
  kind: "new-thread",
  projectId: null,
} as const;

export interface NewThreadEnvironmentConfig {
  value: string;
  onChange: (value: string) => void;
  sources: readonly ProjectSource[];
  host: EnvironmentPickerUIProps["host"];
  isLocal: EnvironmentPickerUIProps["isLocal"];
  machines?: EnvironmentPickerMachines | null;
  /** Opens the guided machine-setup flow for a machine without a project
   * source (multi-machine menu only). */
  onRequestMachineSetup?: (host: Host) => void;
  /** When true, the picker's "Reuse existing worktree" entry is disabled.
   * Caller signals the project has no worktree envs available. */
  reuseDisabled?: boolean;
  worktreeDisabledReason?: string | null;
  /** Hides workspace controls when the caller has already fixed the target. */
  hidden?: boolean;
  disabled?: boolean;
}

export interface NewThreadBranchConfig {
  value: string | null;
  currentBranch?: string | null;
  isNew: boolean;
  hidden?: boolean;
  options: readonly string[];
  remoteOptions?: readonly string[];
  priorityOptions?: readonly string[];
  loading?: boolean;
  placeholder?: string;
  triggerLabel?: string;
  triggerTitle?: string;
  currentOptionLabel?: string | null;
  currentOptionTitle?: string;
  optionDisabledReason?: string | null;
  optionDisabledTitle?: string;
  createDisabledReason?: string | null;
  createDisabledTitle?: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  onOpenChange?: (open: boolean) => void;
  onSearchQueryChange?: (query: string) => void;
  onCreateBaseChange?: (value: string) => void;
  disabled?: boolean;
  /**
   * When provided, the picker exposes a "Create new branch" item. Only set
   * for `host:local` (work locally / on host). Managed-worktree mode uses
   * the picked branch as the branch source instead.
   */
  onCreate?: () => void;
}

export interface NewThreadWorktreeConfig {
  options: readonly ReuseThreadOption[];
  /** Currently-selected env id, or null when reuse mode is active but no
   * worktree has been chosen yet. */
  value: string | null;
  onChange: (environmentId: string) => void;
  disabled?: boolean;
}

export interface NewThreadWorktreeNameConfig {
  prefix: WorktreeBranchPrefix;
  slug: string;
  onPrefixChange: (prefix: WorktreeBranchPrefix) => void;
  onSlugChange: (slug: string) => void;
  hidden?: boolean;
  disabled?: boolean;
}

export interface NewThreadProjectConfig {
  projects: readonly ProjectSelectorOption[];
  /** Currently-selected project id, or null when the user has no project
   * scope. The picker handles the null case when `allowNoProject` is on. */
  value: string | null;
  onChange: (projectId: string | null) => void;
  /** When true, the picker exposes a "Don't work in a project" entry and
   * emits `null` from onChange. Off by default to match current production
   * (project is required). */
  allowNoProject?: boolean;
  createProject?: ProjectSelectorCreateProjectConfig;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export interface NewThreadModeConfig {
  environment: NewThreadEnvironmentConfig;
  branch: NewThreadBranchConfig;
  worktree: NewThreadWorktreeConfig;
  worktreeName?: NewThreadWorktreeNameConfig;
  permission: ExecutionPermissionConfig;
  githubWorkflow?: {
    label: string;
    onOpen: () => void;
    disabled?: boolean;
  };
  /** Slot rendered above the prompt box card, matching the follow-up banner stack. */
  banner?: ReactNode;
  /** Slot rendered inside the prompt box card, above the text area.
   * Used by RootComposeView to surface contextual creation state. */
  header?: ReactNode;
}

export interface NewThreadPromptBoxUIProps {
  /** id forwarded to the underlying PromptBoxInternal (used for autofocus targeting). */
  id?: string;

  // PromptBox passthrough
  value: string;
  mentionRanges: readonly PromptTextMention[];
  onChange: (value: string, mentionRanges: PromptTextMention[]) => void;
  onSubmit: () => void;
  promptBoxRef?: Ref<PromptBoxHandle>;
  isSubmitting: boolean;
  disabled: boolean;
  /** Active root-composer binding for plugin composer hooks and customizations. */
  pluginComposerHost?: PluginComposerHost | null;
  textEffects?: readonly ComposerTextEffectSource[];
  /** zenMode storage key used for the root-compose zen-mode atom. */
  zenModeStorageKey: string;
  /** Overrides the default new-thread placeholder copy. */
  placeholder?: string;
  /** Collapse to a one-line, thumb-zone composer until focused on mobile. */
  mobileQuickComposer?: boolean;

  history: HistoryConfig;
  typeahead: TypeaheadConfig;
  attachments: AttachmentsConfig;
  promptActions?: readonly PromptBoxAction[];

  /** Thread environment, branch/worktree, permission, and optional header config. */
  modeConfig: NewThreadModeConfig;

  project?: NewThreadProjectConfig;
  execution: ExecutionControlsProps;
}

interface GetBranchPickerMenuKindArgs {
  parsedEnvironment: ParsedEnvironmentValue;
}

function getBranchPickerMenuKind({
  parsedEnvironment,
}: GetBranchPickerMenuKindArgs): BranchPickerMenuKind | undefined {
  if (parsedEnvironment?.type !== "host") {
    return undefined;
  }

  return parsedEnvironment.mode === "worktree" ? "base" : "checkout";
}

function getNewThreadPromptPlaceholder(isProjectless: boolean): string {
  return isProjectless
    ? "Ask anything."
    : "Ask anything. @ to mention files, folders, or sections";
}

/**
 * Prop-only variant. Stories render this directly with mock host data; the
 * connected NewThreadPromptBox below wires up the real hooks.
 */
export const NewThreadPromptBoxUI = memo(function NewThreadPromptBoxUI({
  id,
  value,
  mentionRanges,
  onChange,
  onSubmit,
  promptBoxRef: externalPromptBoxRef,
  isSubmitting,
  disabled,
  pluginComposerHost,
  textEffects,
  zenModeStorageKey,
  placeholder: placeholderOverride,
  mobileQuickComposer = false,
  history,
  typeahead,
  attachments,
  promptActions,
  modeConfig,
  project,
  execution,
}: NewThreadPromptBoxUIProps) {
  const promptBoxRef = useRef<PromptBoxHandle>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const isCompactViewport = useIsCompactViewport();
  const [mobileComposerExpanded, setMobileComposerExpanded] = useState(false);
  const [mobileTaskContextOpen, setMobileTaskContextOpen] = useState(false);
  const isMobileQuickComposerCompact =
    mobileQuickComposer && isCompactViewport && !mobileComposerExpanded;
  const expandMobileComposer = useCallback(() => {
    if (!mobileQuickComposer || mobileComposerExpanded) return;
    promptBoxRef.current?.captureHeightForLayoutChange();
    setMobileComposerExpanded(true);
  }, [mobileComposerExpanded, mobileQuickComposer]);
  useEffect(() => {
    if (!mobileQuickComposer || !isCompactViewport || mobileTaskContextOpen)
      return;
    const handleDocumentInteraction = (event: Event) => {
      const shell = composerShellRef.current;
      const target = event.target;
      if (!shell || !(target instanceof Node) || shell.contains(target)) return;
      if (shell.querySelector(OPEN_COMPOSER_OVERLAY_TRIGGER_SELECTOR)) return;
      promptBoxRef.current?.captureHeightForLayoutChange();
      setMobileComposerExpanded(false);
    };
    document.addEventListener("pointerdown", handleDocumentInteraction, true);
    document.addEventListener("focusin", handleDocumentInteraction, true);
    return () => {
      document.removeEventListener(
        "pointerdown",
        handleDocumentInteraction,
        true,
      );
      document.removeEventListener("focusin", handleDocumentInteraction, true);
    };
  }, [isCompactViewport, mobileQuickComposer, mobileTaskContextOpen]);
  // Scope Cmd+Shift+C to the focused split pane (see FollowUpPromptBox). The
  // new-thread composer is always a pane's primary composer.
  const isFocusedPane = useOptionalPaneContext()?.isFocused ?? true;
  useAppCommandContext("promptAvailable", true);
  useAppCommandHandler("composer.focus", () => {
    if (!isFocusedPane) return false;
    promptBoxRef.current?.focusEnd();
    return promptBoxRef.current !== null;
  });
  useImperativeHandle(
    externalPromptBoxRef,
    () => ({
      captureHeightForLayoutChange: () => {
        promptBoxRef.current?.captureHeightForLayoutChange();
      },
      focusEnd: () => {
        promptBoxRef.current?.focusEnd();
      },
      insertTextAtCursor: (text) => {
        promptBoxRef.current?.insertTextAtCursor(text);
      },
      getTextBeforeCursor: () => promptBoxRef.current?.getTextBeforeCursor(),
    }),
    [],
  );
  const voice = usePromptVoice(promptBoxRef);
  const isProjectlessPrompt = project?.value === null;
  const placeholder =
    placeholderOverride ?? getNewThreadPromptPlaceholder(isProjectlessPrompt);
  const promptModeInput = useMemo(
    () => ({
      providerId: execution.provider.selectedId,
      value,
      mentionRanges,
    }),
    [execution.provider.selectedId, mentionRanges, value],
  );
  const permissionDisplayOverride = useMemo(
    () => permissionDisplayForPromptMode(promptModeInput),
    [promptModeInput],
  );
  const permissionPickerDisabledByPlanMode =
    shouldDisablePermissionPickerForPromptMode(promptModeInput);
  const selectedProject = project?.projects.find(
    (candidate) => candidate.id === project.value,
  );
  const mobileProjectLabel =
    selectedProject?.githubRepository?.nameWithOwner ??
    selectedProject?.name ??
    "No project";
  const mobileWorkspaceLabel =
    modeConfig.githubWorkflow?.label ??
    modeConfig.branch.triggerLabel ??
    modeConfig.branch.value ??
    modeConfig.branch.currentBranch ??
    "Choose workspace";
  const submitTitle = isSubmitting
    ? "Submitting..."
    : execution.model.isLoading
      ? "Loading models..."
      : "Submit (Enter)";
  const attachmentCount = attachments.items?.length ?? 0;
  const [composerLayout, setComposerLayout] =
    useState<ComposerView["layout"]>("expanded");
  const composerView = usePluginComposerViewModel({
    scope: pluginComposerHost?.scope ?? DEFAULT_NEW_THREAD_COMPOSER_SCOPE,
    layout: composerLayout,
    text: value,
    attachmentCount,
    isRunning: false,
    isSubmitting,
  });
  return (
    <div
      ref={composerShellRef}
      data-app-composer=""
      data-app-composer-role="primary"
      data-app-composer-scope={JSON.stringify(composerView.scope)}
      data-promptbox-shell=""
      data-mobile-quick-composer={mobileQuickComposer ? "" : undefined}
      className="w-full"
      onFocusCapture={expandMobileComposer}
      onPointerDownCapture={expandMobileComposer}
    >
      <PluginComposerViewProvider value={composerView}>
        <PluginComposerHostProvider value={pluginComposerHost ?? null}>
          {modeConfig.banner || pluginComposerHost ? (
            <div className="mb-2 space-y-2">
              {modeConfig.banner}
              {pluginComposerHost ? <PluginComposerBanners /> : null}
            </div>
          ) : null}
          <PromptBoxInternal
            id={id}
            promptBoxRef={promptBoxRef}
            value={value}
            mentionRanges={mentionRanges}
            onChange={onChange}
            onSubmit={onSubmit}
            textEffects={textEffects}
            onComposerLayoutChange={setComposerLayout}
            history={history}
            typeahead={typeahead}
            mentionMenuPlacement="bottom"
            attachments={attachments}
            promptActions={promptActions}
            voice={voice}
            submission={{
              isSubmitting,
              disabled,
              title: submitTitle,
            }}
            zenMode={{
              layout: "root-compose",
              storageKey: zenModeStorageKey,
            }}
            compact={
              mobileQuickComposer && isCompactViewport
                ? {
                    isCompact: isMobileQuickComposerCompact,
                    placeholder: "Ask anything…",
                  }
                : undefined
            }
            minHeight={NEW_THREAD_PROMPT_BOX_MIN_HEIGHT}
            placeholder={placeholder}
            header={modeConfig.header}
            footerStart={
              <>
                <ExecutionControls {...execution} />
                <PermissionModePicker
                  value={modeConfig.permission.value}
                  options={modeConfig.permission.options}
                  onChange={modeConfig.permission.onChange}
                  supported={modeConfig.permission.supported}
                  disabled={permissionPickerDisabledByPlanMode}
                  showChevronWhenDisabled={permissionPickerDisabledByPlanMode}
                  displayOverride={permissionDisplayOverride}
                />
              </>
            }
          />
        </PluginComposerHostProvider>
      </PluginComposerViewProvider>
      {mobileQuickComposer && isCompactViewport ? (
        <>
          <button
            type="button"
            className={cn(
              "mt-1 flex min-h-11 w-full items-center gap-2 rounded-lg px-3.5 text-left text-xs text-muted-foreground transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isMobileQuickComposerCompact && "hidden",
            )}
            aria-label={`Edit task context. ${mobileProjectLabel}, ${mobileWorkspaceLabel}`}
            onClick={() => setMobileTaskContextOpen(true)}
          >
            <Icon name="FolderGit" className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {mobileProjectLabel} · {mobileWorkspaceLabel}
            </span>
            <span className="shrink-0 text-foreground">Edit</span>
          </button>
          <Drawer
            open={mobileTaskContextOpen}
            onOpenChange={setMobileTaskContextOpen}
          >
            <DrawerContent className="max-h-[92dvh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="px-5 pb-4 pt-2">
                <DrawerTitle className="text-lg font-medium">
                  Task context
                </DrawerTitle>
                <DrawerDescription className="mt-1 text-sm leading-5">
                  Choose where this task runs and what it can change.
                </DrawerDescription>
              </div>
              <div className="grid gap-5 px-5">
                {project ? (
                  <section className="grid gap-2" aria-label="Repository">
                    <p className="text-xs font-medium text-muted-foreground">
                      Repository
                    </p>
                    <div className="flex min-h-11 items-center rounded-lg border border-border px-2">
                      <ProjectSelector
                        projects={project.projects}
                        value={project.value}
                        onChange={project.onChange}
                        allowNoProject={project.allowNoProject ?? false}
                        createProject={project.createProject}
                        disabled={project.disabled}
                        onOpenChange={project.onOpenChange}
                      />
                    </div>
                  </section>
                ) : null}
                <section className="grid gap-2" aria-label="Workspace">
                  <p className="text-xs font-medium text-muted-foreground">
                    Workspace and Git source
                  </p>
                  <div className="flex min-h-11 flex-wrap items-center gap-1 rounded-lg border border-border px-2 py-1.5">
                    {project?.value !== null ? (
                      <ThreadEnvSlot
                        environment={modeConfig.environment}
                        branch={modeConfig.branch}
                        worktree={modeConfig.worktree}
                        worktreeName={modeConfig.worktreeName}
                        githubWorkflow={modeConfig.githubWorkflow}
                        layout="mobile"
                      />
                    ) : (
                      <ProjectlessMachineSlot
                        environment={modeConfig.environment}
                      />
                    )}
                  </div>
                </section>
              </div>
            </DrawerContent>
          </Drawer>
        </>
      ) : (
        <div className="mt-1 flex items-start gap-x-2 gap-y-1 px-3.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {project ? (
              <ProjectSelector
                projects={project.projects}
                value={project.value}
                onChange={project.onChange}
                allowNoProject={project.allowNoProject ?? false}
                createProject={project.createProject}
                disabled={project.disabled}
                onOpenChange={project.onOpenChange}
                className="shrink-0"
              />
            ) : null}
            {project?.value !== null ? (
              <ThreadEnvSlot
                environment={modeConfig.environment}
                branch={modeConfig.branch}
                worktree={modeConfig.worktree}
                worktreeName={modeConfig.worktreeName}
                githubWorkflow={modeConfig.githubWorkflow}
              />
            ) : (
              <ProjectlessMachineSlot environment={modeConfig.environment} />
            )}
          </div>
        </div>
      )}
    </div>
  );
});

interface ThreadEnvSlotProps {
  environment: NewThreadEnvironmentConfig;
  branch: NewThreadBranchConfig;
  worktree: NewThreadWorktreeConfig;
  worktreeName?: NewThreadWorktreeNameConfig;
  githubWorkflow?: NewThreadModeConfig["githubWorkflow"];
  layout?: "desktop" | "mobile";
}

export function ThreadEnvSlot({
  environment,
  branch,
  worktree,
  worktreeName,
  githubWorkflow,
  layout = "desktop",
}: ThreadEnvSlotProps) {
  const parsedEnvironment = useMemo(
    () => parseEnvironmentValue(environment.value),
    [environment.value],
  );
  if (environment.hidden) return null;
  const branchMenuKind = getBranchPickerMenuKind({ parsedEnvironment });
  const showBranchPicker =
    parsedEnvironment?.type === "host" && branch.hidden !== true;
  const showWorktreePicker = parsedEnvironment?.type === "reuse";
  return (
    <>
      <EnvironmentPickerUI
        value={environment.value}
        onChange={environment.onChange}
        sources={environment.sources}
        host={environment.host}
        isLocal={environment.isLocal}
        machines={environment.machines}
        onRequestMachineSetup={environment.onRequestMachineSetup}
        reuseDisabled={environment.reuseDisabled}
        worktreeDisabledReason={environment.worktreeDisabledReason}
        disabled={environment.disabled}
        className="shrink-0"
        muted
      />
      {showBranchPicker ? (
        <BranchPicker
          variant="option"
          muted
          value={branch.value}
          currentBranch={branch.currentBranch}
          isCreatingNew={branch.isNew}
          options={branch.options}
          remoteOptions={branch.remoteOptions}
          priorityOptions={branch.priorityOptions}
          loading={branch.loading}
          placeholder={branch.placeholder}
          triggerLabel={branch.triggerLabel}
          triggerTitle={branch.triggerTitle}
          menuKind={branchMenuKind}
          currentOptionLabel={branch.currentOptionLabel}
          currentOptionTitle={branch.currentOptionTitle}
          optionDisabledReason={branch.optionDisabledReason}
          optionDisabledTitle={branch.optionDisabledTitle}
          createDisabledReason={branch.createDisabledReason}
          createDisabledTitle={branch.createDisabledTitle}
          disabled={branch.disabled}
          onChange={branch.onChange}
          onClear={branch.onClear}
          onOpenChange={branch.onOpenChange}
          onSearchQueryChange={branch.onSearchQueryChange}
          onCreateBaseChange={branch.onCreateBaseChange}
          onCreate={branch.onCreate}
        />
      ) : null}
      {parsedEnvironment?.type === "host" &&
      parsedEnvironment.mode === "worktree" &&
      worktreeName &&
      worktreeName.hidden !== true ? (
        <WorktreeBranchNameInput
          prefix={worktreeName.prefix}
          slug={worktreeName.slug}
          onPrefixChange={worktreeName.onPrefixChange}
          onSlugChange={worktreeName.onSlugChange}
          disabled={worktreeName.disabled}
          layout={layout}
        />
      ) : null}
      {showWorktreePicker ? (
        <WorktreePicker
          muted
          options={worktree.options}
          value={worktree.value}
          onChange={worktree.onChange}
          disabled={worktree.disabled}
        />
      ) : null}
      {githubWorkflow ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={githubWorkflow.disabled}
          onClick={githubWorkflow.onOpen}
          className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
        >
          <Icon name="FolderGit" className="size-3.5" aria-hidden />
          <span className="max-w-44 truncate">{githubWorkflow.label}</span>
        </Button>
      ) : null}
    </>
  );
}

interface ProjectlessMachineSlotProps {
  environment: NewThreadEnvironmentConfig;
}

/**
 * Environment-slot replacement for projectless composing (>1 host): a
 * machine chip that picks which machine's personal workspace the thread runs
 * in. With a single host the slot stays empty.
 */
export function ProjectlessMachineSlot({
  environment,
}: ProjectlessMachineSlotProps) {
  const machines = environment.machines ?? null;
  const parsedEnvironment = useMemo(
    () => parseEnvironmentValue(environment.value),
    [environment.value],
  );
  const handleChange = environment.onChange;
  const handleMachineChange = useCallback(
    (hostId: string) => {
      // Projectless threads always run in the machine's personal workspace,
      // so a machine pick encodes as that host's local mode.
      handleChange(encodeHostValue(hostId, "local"));
    },
    [handleChange],
  );
  if (!machines || machines.hosts.length <= 1) {
    return null;
  }
  return (
    <MachinePickerUI
      hosts={machines.hosts}
      localDaemonHostId={machines.localDaemonHostId}
      primaryHostId={machines.primaryHostId}
      selectedHostId={
        parsedEnvironment?.type === "host" ? parsedEnvironment.hostId : null
      }
      onChange={handleMachineChange}
      disabled={environment.disabled}
      className="shrink-0"
      muted
    />
  );
}

export interface NewThreadConnectedEnvironmentConfig {
  value: string;
  onChange: (value: string) => void;
  sources: readonly ProjectSource[];
  /** Opens the guided machine-setup flow for a machine without a project
   * source (multi-machine menu only). */
  onRequestMachineSetup?: (host: Host) => void;
  /** When true, the "Reuse existing worktree" entry in the env picker is
   * disabled — caller signals the project has no worktree envs available. */
  reuseDisabled?: boolean;
  worktreeDisabledReason?: string | null;
  /** Hides workspace controls when the caller has already fixed the target. */
  hidden?: boolean;
  disabled?: boolean;
}

export interface NewThreadConnectedBranchConfig {
  value: string | null;
  currentBranch?: string | null;
  isNew: boolean;
  hidden?: boolean;
  options: readonly string[];
  remoteOptions?: readonly string[];
  loading?: boolean;
  placeholder?: string;
  triggerLabel?: string;
  triggerTitle?: string;
  currentOptionLabel?: string | null;
  currentOptionTitle?: string;
  optionDisabledReason?: string | null;
  optionDisabledTitle?: string;
  createDisabledReason?: string | null;
  createDisabledTitle?: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  onOpenChange?: (open: boolean) => void;
  onSearchQueryChange?: (query: string) => void;
  onCreateBaseChange?: (value: string) => void;
  disabled?: boolean;
  onCreate: () => void;
}

export interface NewThreadConnectedModeConfig {
  environment: NewThreadConnectedEnvironmentConfig;
  branch: NewThreadConnectedBranchConfig;
  worktree: NewThreadWorktreeConfig;
  worktreeName?: NewThreadWorktreeNameConfig;
  permission: ExecutionPermissionConfig;
  githubWorkflow?: NewThreadModeConfig["githubWorkflow"];
  banner?: ReactNode;
  header?: ReactNode;
}

export interface NewThreadPromptBoxProps extends Omit<
  NewThreadPromptBoxUIProps,
  "modeConfig"
> {
  modeConfig: NewThreadConnectedModeConfig;
}

type ConnectedThreadModeConfig = NewThreadConnectedModeConfig;

type NewThreadPromptBoxRest = Omit<NewThreadPromptBoxProps, "modeConfig">;

/**
 * The composed prompt area for creating a new thread in a project — used by
 * RootComposeView. It wires host queries through `ConnectedThreadModeBranch`.
 */
export function NewThreadPromptBox({
  modeConfig,
  ...rest
}: NewThreadPromptBoxProps) {
  return <ConnectedThreadModeBranch {...rest} threadConfig={modeConfig} />;
}

interface ConnectedThreadModeBranchProps extends NewThreadPromptBoxRest {
  threadConfig: ConnectedThreadModeConfig;
}

function ConnectedThreadModeBranch({
  threadConfig,
  ...rest
}: ConnectedThreadModeBranchProps) {
  const { data: hosts } = useHosts();
  const systemConfigQuery = useSystemConfig();
  const primaryHostId = systemConfigQuery.data?.primaryHostId ?? null;
  const primaryHost = useMemo(
    () => selectPrimaryHost(hosts, primaryHostId),
    [hosts, primaryHostId],
  );
  const { isLocalDaemonHost, localDaemonHostId } = useHostDaemon();

  const parsedEnvironment = parseEnvironmentValue(
    threadConfig.environment.value,
  );
  const selectedHost =
    parsedEnvironment?.type === "host"
      ? (hosts?.find((host) => host.id === parsedEnvironment.hostId) ??
        primaryHost)
      : primaryHost;
  const isLocalHost = selectedHost ? isLocalDaemonHost(selectedHost.id) : false;
  const machines = useMemo<EnvironmentPickerMachines | null>(
    () => (hosts ? { hosts, localDaemonHostId, primaryHostId } : null),
    [hosts, localDaemonHostId, primaryHostId],
  );

  const isHostMode = parsedEnvironment?.type === "host";
  // Create-new-branch is only meaningful for host:local (work locally /
  // on host) — the server checks out a fresh branch in the primary checkout
  // before the thread starts. Worktree mode uses the picked branch as the
  // branch source instead, so we omit onCreate there.
  const allowCreate = isHostMode && parsedEnvironment.mode === "local";

  const uiEnvironment = useMemo(
    () => ({
      ...threadConfig.environment,
      host: selectedHost,
      isLocal: isLocalHost,
      machines,
    }),
    [threadConfig.environment, selectedHost, isLocalHost, machines],
  );
  const uiBranch = useMemo<NewThreadBranchConfig>(() => {
    const branch = threadConfig.branch;
    return {
      value: branch.value,
      currentBranch: branch.currentBranch,
      isNew: allowCreate && branch.isNew,
      hidden: branch.hidden,
      options: branch.options,
      remoteOptions: branch.remoteOptions,
      loading: branch.loading,
      placeholder: branch.placeholder,
      triggerLabel: branch.triggerLabel,
      triggerTitle: branch.triggerTitle,
      currentOptionLabel: branch.currentOptionLabel,
      currentOptionTitle: branch.currentOptionTitle,
      optionDisabledReason: branch.optionDisabledReason,
      optionDisabledTitle: branch.optionDisabledTitle,
      createDisabledReason: branch.createDisabledReason,
      createDisabledTitle: branch.createDisabledTitle,
      onChange: branch.onChange,
      onClear: branch.onClear,
      onOpenChange: branch.onOpenChange,
      onSearchQueryChange: branch.onSearchQueryChange,
      onCreateBaseChange: branch.onCreateBaseChange,
      disabled: branch.disabled,
      ...(allowCreate ? { onCreate: branch.onCreate } : {}),
    };
  }, [allowCreate, threadConfig.branch]);

  return (
    <NewThreadPromptBoxUI
      {...rest}
      modeConfig={{
        environment: uiEnvironment,
        branch: uiBranch,
        worktree: threadConfig.worktree,
        worktreeName: threadConfig.worktreeName,
        permission: threadConfig.permission,
        githubWorkflow: threadConfig.githubWorkflow,
        banner: threadConfig.banner,
        header: threadConfig.header,
      }}
    />
  );
}
