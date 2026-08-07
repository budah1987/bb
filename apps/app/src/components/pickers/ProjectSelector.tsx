import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "./OptionPicker";

export interface ProjectSelectorOption {
  id: string;
  name: string;
  githubRepository?: {
    nameWithOwner: string;
    accessibleBy: readonly string[];
    activeAccount: string | null;
  };
}

export interface ProjectSelectorCreateProjectConfig {
  onCreate: () => void;
  disabled?: boolean;
  isCreating?: boolean;
}

export interface ProjectSelectorProps {
  projects: readonly ProjectSelectorOption[];
  /**
   * Selected project id, or `null` for the no-project case. Only emit/accept
   * `null` when `allowNoProject` is true — callers in required mode can wrap
   * their handler with a null guard (the picker won't emit `null` then).
   */
  value: string | null;
  onChange: (projectId: string | null) => void;
  /**
   * When true, adds a "Don't work in a project" item and lets the trigger
   * render the "Work in a project" empty state when `value === null`. Default
   * false: the no-project item is hidden and `value` is assumed to be a valid
   * project id (the trigger has no empty state).
   */
  allowNoProject?: boolean;
  /** When provided, adds a "New project" action. */
  createProject?: ProjectSelectorCreateProjectConfig;
  /** Render as a non-interactive label while preserving the selected project. */
  disabled?: boolean;
  className?: string;
  /** Render with the menu open on mount. Story-only escape hatch. */
  defaultOpen?: boolean;
  /** Whether the menu blocks page interaction. Defaults to Radix's true. */
  modal?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ProjectSelector({
  projects,
  value,
  onChange,
  allowNoProject = false,
  createProject,
  disabled = false,
  className,
  defaultOpen,
  modal,
  onOpenChange,
}: ProjectSelectorProps) {
  const selected = value !== null ? projects.find((p) => p.id === value) : null;
  // When allowNoProject is false and the caller's value doesn't match any
  // project (shouldn't happen in normal use), the trigger falls back to the
  // first project so it's never blank.
  const fallback = !allowNoProject && !selected ? projects[0] : null;
  const selectedOption = selected ?? fallback;
  const triggerLabel =
    selectedOption?.githubRepository?.nameWithOwner ??
    selectedOption?.name ??
    "Work in a project";
  const compactTriggerLabel = selected?.name ?? fallback?.name ?? "No project";
  const triggerIcon = selected || fallback ? "Folder" : "FolderPlus";
  const createProjectAction = createProject;
  const createProjectLabel = createProjectAction?.isCreating
    ? "Creating..."
    : "New project";
  const showActionSeparator =
    projects.length > 0 && (Boolean(createProjectAction) || allowNoProject);

  return (
    <DropdownMenu
      defaultOpen={defaultOpen}
      modal={modal}
      onOpenChange={onOpenChange}
    >
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Project"
          disabled={disabled}
          data-promptbox-project-control=""
          className={cn(
            OPTION_BASE_CLASS_NAME,
            !disabled && OPTION_INTERACTIVE_CLASS_NAME,
            disabled && "cursor-default disabled:opacity-100",
            OPTION_MUTED_CLASS_NAME,
            className,
          )}
        >
          <span className={OPTION_TRIGGER_CONTENT_CLASS_NAME}>
            <Icon
              name={triggerIcon}
              className="size-3.5 shrink-0"
              aria-hidden
            />
            <span className="min-w-0 truncate" data-promptbox-full-label="">
              {triggerLabel}
            </span>
            <span className="min-w-0 truncate" data-promptbox-compact-label="">
              {compactTriggerLabel}
            </span>
          </span>
          {disabled ? null : (
            <Icon
              name="ChevronDown"
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="w-72">
        <DropdownMenuLabel>Repository</DropdownMenuLabel>
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onSelect={() => onChange(project.id)}
            className="items-start py-2"
          >
            <Icon
              name="Folder"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                <bdi>
                  {project.githubRepository?.nameWithOwner ?? project.name}
                </bdi>
              </span>
              {project.githubRepository &&
              project.githubRepository.accessibleBy.length > 0 ? (
                <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <span>Access</span>
                  {project.githubRepository.accessibleBy.map((login) => (
                    <span
                      key={login}
                      className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 leading-none"
                    >
                      <bdi className="truncate">@{login}</bdi>
                      {login === project.githubRepository?.activeAccount ? (
                        <span className="text-foreground">active</span>
                      ) : null}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
            <Icon
              name="Check"
              className={cn(
                "ml-auto mt-0.5 size-4 shrink-0",
                project.id === value ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
          </DropdownMenuItem>
        ))}
        {showActionSeparator ? <DropdownMenuSeparator /> : null}
        {createProjectAction ? (
          <DropdownMenuItem
            disabled={createProjectAction.disabled}
            onSelect={() => createProjectAction.onCreate()}
          >
            <Icon
              name="FolderPlus"
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            {createProjectLabel}
          </DropdownMenuItem>
        ) : null}
        {allowNoProject ? (
          <DropdownMenuItem onSelect={() => onChange(null)}>
            <Icon
              name="FolderMinus"
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            Don&apos;t work in a project
            <Icon
              name="Check"
              className={cn(
                "ml-auto size-4",
                value === null ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
