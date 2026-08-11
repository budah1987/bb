import { useMemo, useState } from "react";
import type { SpaceResponse } from "@bb/server-contract";
import {
  spaceColorValues,
  spaceIconValues,
  type SpaceColor,
  type SpaceIcon,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useCreateSpace,
  useDeleteSpace,
  useUpdateSpace,
} from "@/hooks/mutations/space-mutations";
import { SPACE_COLOR_CSS, SpaceIconGlyph } from "./SpaceSidebar";

export type SpaceEditorState =
  | { kind: "create" }
  | { kind: "edit"; space: SpaceResponse }
  | null;

export default function SpaceEditor({
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
              <SpaceIconGlyph icon={value} />
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
