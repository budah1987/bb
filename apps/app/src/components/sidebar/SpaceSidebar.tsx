import { lazy, Suspense, type CSSProperties } from "react";
import type { SpaceResponse } from "@bb/server-contract";
import type { SpaceColor, SpaceIcon } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { cn } from "@bb/shared-ui/lib/utils";

const BASE_SPACE_ICON_NAMES: Partial<Record<SpaceIcon, IconName>> = {
  layers: "Layers",
  grid: "GridView",
  star: "Star",
  circle: "Circle",
  zap: "Zap",
  target: "Target",
  folder: "FolderGit",
  workflow: "Workflow",
};

const ExtendedSpaceIcon = lazy(() => import("./ExtendedSpaceIcon"));

export const SPACE_COLOR_CSS: Record<SpaceColor, string> = {
  sage: "var(--success)",
  amber: "var(--warning)",
  mulberry: "var(--pr-merged)",
  blue: "var(--primary)",
  coral: "var(--destructive)",
  teal: "var(--diff-added)",
  neutral: "var(--ink)",
};

export function SpaceIconGlyph({ icon }: { icon: SpaceIcon }) {
  const baseIconName = BASE_SPACE_ICON_NAMES[icon];
  if (baseIconName) return <Icon name={baseIconName} />;

  return (
    <Suspense fallback={<span aria-hidden="true" className="size-4" />}>
      <ExtendedSpaceIcon icon={icon} />
    </Suspense>
  );
}

export function getSpaceSidebarStyle(color: SpaceColor): CSSProperties {
  return {
    "--sidebar": `color-mix(in oklch, ${SPACE_COLOR_CSS[color]} 9%, var(--canvas))`,
    "--sidebar-accent": `color-mix(in oklch, ${SPACE_COLOR_CSS[color]} 15%, var(--canvas))`,
    "--sidebar-border": `color-mix(in oklch, ${SPACE_COLOR_CSS[color]} 22%, var(--canvas))`,
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
  return (
    <div
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-sidebar-border px-2 py-2 group-data-[collapsible=icon]:hidden"
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
                "size-8 shrink-0 rounded-lg text-muted-foreground",
                space.id === activeSpaceId &&
                  "bg-sidebar-accent text-sidebar-foreground ring-1 ring-sidebar-border",
              )}
              aria-label={`${space.name}, Space ${index + 1}`}
              aria-pressed={space.id === activeSpaceId}
              onClick={() => onSelect(space.id)}
            >
              <SpaceIconGlyph icon={space.icon} />
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
        className="size-8 shrink-0 rounded-lg text-muted-foreground"
        aria-label="Create Space"
        onClick={onNew}
      >
        <Icon name="Plus" />
      </Button>
    </div>
  );
}
