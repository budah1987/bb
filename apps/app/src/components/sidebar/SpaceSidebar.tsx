import { useMemo, useState, type CSSProperties } from "react";
import type { SpaceResponse } from "@bb/server-contract";
import {
  spaceColorValues,
  spaceIconValues,
  type SpaceColor,
  type SpaceIcon,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useCreateSpace,
  useDeleteSpace,
  useUpdateSpace,
} from "@/hooks/mutations/space-mutations";

export type SpaceEditorState =
  | { kind: "create" }
  | { kind: "edit"; space: SpaceResponse }
  | null;

const SPACE_ICON_NAMES: Record<SpaceIcon, IconName> = {
  layers: "Layers",
  grid: "GridView",
  star: "Star",
  circle: "Circle",
  zap: "Zap",
  target: "Target",
  folder: "FolderGit",
  workflow: "Workflow",
};

export const SPACE_COLOR_CSS: Record<SpaceColor, string> = {
  sage: "var(--success)",
  amber: "var(--warning)",
  mulberry: "var(--pr-merged)",
  blue: "var(--primary)",
  coral: "var(--destructive)",
  teal: "var(--diff-added)",
  neutral: "var(--ink)",
};

export function getSpaceIconName(icon: SpaceIcon): IconName {
  return SPACE_ICON_NAMES[icon];
}

export function SpaceIconGlyph({ icon }: { icon: SpaceIcon }) {
  return <Icon name={getSpaceIconName(icon)} />;
}

export function getSpaceSidebarStyle(color: SpaceColor): CSSProperties {
  return {
    "--space-accent": `color-mix(in oklch, ${SPACE_COLOR_CSS[color]} 15%, var(--canvas))`,
    "--space-border": `color-mix(in oklch, ${SPACE_COLOR_CSS[color]} 22%, var(--canvas))`,
  } as CSSProperties;
}

export function SpaceDock({
  activeSpaceId,
  onEdit,
  onNew,
  onSelect,
  spaces,
}: {
  activeSpaceId: string;
  onEdit: (space: SpaceResponse) => void;
  onNew: () => void;
  onSelect: (spaceId: string) => void;
  spaces: readonly SpaceResponse[];
}) {
  const activeSpace = spaces.find((space) => space.id === activeSpaceId);

  return (
    <div
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-sidebar-border/70 bg-sidebar-accent/15 px-2 py-1.5 group-data-[collapsible=icon]:hidden"
      aria-label="Spaces"
    >
      {spaces.map((space, index) => (
        <ContextMenu key={space.id}>
          <ContextMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                "h-8 shrink-0 items-center rounded-md text-muted-foreground transition-[background-color,color,box-shadow]",
                space.id === activeSpaceId &&
                  "w-auto max-w-40 justify-start gap-2 bg-[var(--space-accent)] px-2 text-sidebar-foreground shadow-[inset_0_0_0_1px_var(--space-border),0_1px_1px_color-mix(in_oklch,var(--ink)_6%,transparent)]",
                space.id !== activeSpaceId && "size-8 justify-center px-0",
              )}
              aria-label={`${space.name}, Space ${index + 1}`}
              aria-pressed={space.id === activeSpaceId}
              onClick={() => onSelect(space.id)}
            >
              <span className="grid size-4 shrink-0 place-items-center [&>svg]:size-4">
                <Icon name={getSpaceIconName(space.icon)} />
              </span>
              {space.id === activeSpaceId ? (
                <span className="min-w-0 truncate text-xs font-medium">
                  {space.name}
                </span>
              ) : null}
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent aria-label={`${space.name} actions`}>
            <ContextMenuItem onSelect={() => onEdit(space)}>
              <Icon name="Edit" />
              Edit Space
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              disabled={spaces.length === 1}
              onSelect={() => onEdit(space)}
            >
              <Icon name="Trash2" />
              Delete Space
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={cn(
          "h-8 shrink-0 items-center rounded-md text-muted-foreground",
          activeSpace
            ? "size-8 justify-center px-0"
            : "w-full justify-start gap-2 px-2",
        )}
        aria-label="Create Space"
        onClick={onNew}
      >
        <span className="grid size-4 shrink-0 place-items-center [&>svg]:size-4">
          <Icon name="Plus" />
        </span>
        {activeSpace ? null : <span className="text-xs">Create Space</span>}
      </Button>
    </div>
  );
}

export function SpaceEditor({
  editor,
  onCancel,
  onSaved,
  spaces,
}: {
  editor: Exclude<SpaceEditorState, null>;
  onCancel: () => void;
  onSaved: (spaceId: string) => void;
  spaces: readonly SpaceResponse[];
}) {
  const initial = editor.kind === "edit" ? editor.space : null;
  const initialDestinationSpaceId =
    spaces.find((space) => space.id !== initial?.id)?.id ?? "";
  const [name, setName] = useState(initial?.name ?? "");
  const [icon, setIcon] = useState<SpaceIcon>(initial?.icon ?? "layers");
  const [color, setColor] = useState<SpaceColor>(initial?.color ?? "sage");
  const [destinationSpaceId, setDestinationSpaceId] = useState(
    initialDestinationSpaceId,
  );
  const createMutation = useCreateSpace();
  const updateMutation = useUpdateSpace();
  const deleteMutation = useDeleteSpace();
  const otherSpaces = useMemo(
    () => spaces.filter((space) => space.id !== initial?.id),
    [initial?.id, spaces],
  );
  const isPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  const save = () => {
    const request = { name: name.trim(), icon, color };
    if (!request.name) return;
    if (editor.kind === "create") {
      createMutation.mutate(request, {
        onSuccess: (space) => onSaved(space.id),
      });
      return;
    }
    updateMutation.mutate(
      { spaceId: editor.space.id, ...request },
      { onSuccess: (space) => onSaved(space.id) },
    );
  };

  const remove = () => {
    if (editor.kind !== "edit") return;
    const containsProjects = editor.space.projectIds.length > 0;
    deleteMutation.mutate(
      {
        spaceId: editor.space.id,
        destinationSpaceId: containsProjects ? destinationSpaceId : null,
      },
      {
        onSuccess: () =>
          onSaved(destinationSpaceId || otherSpaces[0]?.id || ""),
      },
    );
  };

  return (
    <div className="space-y-5 px-3 py-2 group-data-[collapsible=icon]:hidden">
      <div>
        <h2 className="text-sm font-medium">
          {editor.kind === "create" ? "Create Space" : "Edit Space"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose a name, icon, and sidebar color.
        </p>
      </div>
      <Input
        value={name}
        maxLength={40}
        autoFocus
        aria-label="Space name"
        placeholder="Space name"
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <fieldset>
        <legend className="mb-2 text-xs text-muted-foreground">Icon</legend>
        <div className="grid grid-cols-4 gap-2">
          {spaceIconValues.map((value) => (
            <Button
              key={value}
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                "w-full",
                icon === value &&
                  "bg-sidebar-accent ring-1 ring-sidebar-border",
              )}
              aria-label={value}
              aria-pressed={icon === value}
              onClick={() => setIcon(value)}
            >
              <Icon name={getSpaceIconName(value)} />
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-xs text-muted-foreground">Color</legend>
        <div className="grid grid-cols-7 gap-2">
          {spaceColorValues.map((value) => (
            <button
              key={value}
              type="button"
              className={cn(
                "size-7 rounded-full ring-offset-2 ring-offset-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                color === value && "ring-2 ring-sidebar-foreground",
              )}
              style={{ background: SPACE_COLOR_CSS[value] }}
              aria-label={value}
              aria-pressed={color === value}
              onClick={() => setColor(value)}
            />
          ))}
        </div>
      </fieldset>
      {editor.kind === "edit" && editor.space.projectIds.length > 0 ? (
        <label className="block text-xs text-muted-foreground">
          Move projects before deletion
          <select
            className="mt-2 h-9 w-full rounded-md border border-sidebar-border bg-sidebar px-2 text-sm text-sidebar-foreground"
            value={destinationSpaceId}
            onChange={(event) =>
              setDestinationSpaceId(event.currentTarget.value)
            }
          >
            {otherSpaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={!name.trim() || isPending}
        >
          {editor.kind === "create" ? "Create" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
      {editor.kind === "edit" && spaces.length > 1 ? (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={remove}
          disabled={
            isPending ||
            (editor.space.projectIds.length > 0 && !destinationSpaceId)
          }
        >
          Delete Space
        </Button>
      ) : null}
    </div>
  );
}
