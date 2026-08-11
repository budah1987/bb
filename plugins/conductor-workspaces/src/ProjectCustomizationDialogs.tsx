import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import type { ProjectIconValue } from "./project-customizations";
import {
  ProjectGlyphIcon,
  filterProjectEmoji,
  filterProjectGlyphs,
} from "./project-icons";

export interface ProjectRenameTarget {
  projectId: string;
  defaultName: string;
  currentName: string;
  hasOverride: boolean;
}

export function RenameProjectDialog({
  target,
  onClose,
  onRename,
}: {
  target: ProjectRenameTarget | null;
  onClose: () => void;
  onRename: (projectId: string, name: string | undefined) => void;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    setName(target?.currentName ?? "");
  }, [target]);

  if (!target) return null;
  const currentTarget = target;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    onRename(
      currentTarget.projectId,
      nextName === currentTarget.defaultName ? undefined : nextName,
    );
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rename repository</DialogTitle>
            <DialogDescription>
              Changes only the name shown in this sidebar. The repository itself
              stays unchanged.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5 text-xs font-medium text-foreground">
            <span>Sidebar name</span>
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <DialogFooter>
            {currentTarget.hasOverride ? (
              <Button
                type="button"
                variant="outline"
                className="mr-auto"
                onClick={() => {
                  onRename(currentTarget.projectId, undefined);
                  onClose();
                }}
              >
                Use default
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={name.trim().length === 0}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface ProjectIconTarget {
  projectId: string;
  projectLabel: string;
  currentIcon: ProjectIconValue | null;
}

type IconTab = "icons" | "emoji";

export function ProjectIconDialog({
  target,
  onClose,
  onSelect,
}: {
  target: ProjectIconTarget | null;
  onClose: () => void;
  onSelect: (projectId: string, icon: ProjectIconValue | undefined) => void;
}) {
  const [tab, setTab] = useState<IconTab>("icons");
  const [query, setQuery] = useState("");

  useEffect(() => {
    setTab(target?.currentIcon?.kind === "emoji" ? "emoji" : "icons");
    setQuery("");
  }, [target]);

  if (!target) return null;
  const currentTarget = target;

  function pick(icon: ProjectIconValue | undefined) {
    onSelect(currentTarget.projectId, icon);
    onClose();
  }

  const glyphs = tab === "icons" ? filterProjectGlyphs(query) : [];
  const emoji = tab === "emoji" ? filterProjectEmoji(query) : [];
  const isEmpty = tab === "icons" ? glyphs.length === 0 : emoji.length === 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="conductor-icon-dialog">
        <DialogHeader>
          <DialogTitle>
            Change icon for {currentTarget.projectLabel}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Pick an icon or emoji shown next to this repository in the sidebar.
          </DialogDescription>
        </DialogHeader>
        <div
          className="conductor-icon-tabs"
          role="tablist"
          aria-label="Icon type"
        >
          {(
            [
              ["icons", "Icons"],
              ["emoji", "Emoji"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className="conductor-icon-tab"
              data-active={tab === value || undefined}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Icon
            name="Search"
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            autoFocus
            value={query}
            placeholder={tab === "icons" ? "Search icons" : "Search emoji"}
            aria-label={tab === "icons" ? "Search icons" : "Search emoji"}
            className="pl-8"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div
          className="conductor-icon-grid-scroll"
          role="listbox"
          aria-label="Icons"
        >
          {isEmpty ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              No matches.
            </p>
          ) : (
            <div className="conductor-icon-grid">
              {tab === "icons"
                ? glyphs.map((glyph) => {
                    const selected =
                      currentTarget.currentIcon?.kind === "glyph" &&
                      currentTarget.currentIcon.name === glyph.name;
                    return (
                      <button
                        key={glyph.name}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className="conductor-icon-cell"
                        data-selected={selected || undefined}
                        title={glyph.name}
                        onClick={() =>
                          pick({ kind: "glyph", name: glyph.name })
                        }
                      >
                        <ProjectGlyphIcon
                          name={glyph.name}
                          className="size-4.5"
                          aria-label={glyph.name}
                        />
                      </button>
                    );
                  })
                : emoji.map((entry) => {
                    const selected =
                      currentTarget.currentIcon?.kind === "emoji" &&
                      currentTarget.currentIcon.value === entry.value;
                    return (
                      <button
                        key={entry.value}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className="conductor-icon-cell conductor-icon-cell--emoji"
                        data-selected={selected || undefined}
                        title={entry.keywords[0]}
                        onClick={() =>
                          pick({ kind: "emoji", value: entry.value })
                        }
                      >
                        <span aria-label={entry.keywords[0]}>
                          {entry.value}
                        </span>
                      </button>
                    );
                  })}
            </div>
          )}
        </div>
        <DialogFooter>
          {currentTarget.currentIcon ? (
            <Button
              type="button"
              variant="outline"
              className="mr-auto"
              onClick={() => pick(undefined)}
            >
              Remove icon
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
