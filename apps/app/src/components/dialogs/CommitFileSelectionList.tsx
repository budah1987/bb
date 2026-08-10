import { useEffect, useRef } from "react";
import type { WorkspaceFileStatus, WorkspaceFileStatusKind } from "@bb/domain";
import { DiffStatsTally } from "@/components/ui/diff-stats-tally.js";
import { FilePathLink } from "@/components/ui/file-path-link.js";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  formatWorkspaceChangedFilesLabel,
  formatWorkspaceFileStatus,
} from "@/components/workspace/workspace-change-summary";

/**
 * Native `input[type=checkbox]` rather than the Radix `Checkbox`: a `<label>`
 * only forwards clicks to a real form control, and the full row — not the
 * 16px box — is the touch target on compact layouts.
 */
const CHECKBOX_CLASS =
  "size-4 shrink-0 cursor-pointer accent-foreground disabled:cursor-not-allowed";
const ROW_CLASS =
  "grid min-h-11 cursor-pointer grid-cols-[1rem_1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded px-1 transition-colors hover:bg-state-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring md:min-h-8";

export interface CommitFileSelectionListProps {
  files: readonly WorkspaceFileStatus[];
  /** Paths the user turned off. Everything else in `files` is selected. */
  deselectedPaths: ReadonlySet<string>;
  disabled: boolean;
  onToggleFile: (path: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  className?: string;
}

/** Spoken status word for a checkbox name, e.g. "Modified, src/foo.ts". */
function describeFileStatus(status: WorkspaceFileStatusKind): string {
  switch (status) {
    case "M":
      return "Modified";
    case "A":
      return "Added";
    case "D":
      return "Deleted";
    case "R":
      return "Renamed";
    case "C":
      return "Copied";
    case "U":
      return "Unmerged";
    case "??":
      return "Untracked";
    case "?":
      return "Changed";
  }
}

export function CommitFileSelectionList({
  files,
  deselectedPaths,
  disabled,
  onToggleFile,
  onToggleAll,
  className,
}: CommitFileSelectionListProps) {
  const masterRef = useRef<HTMLInputElement>(null);
  const selectedCount = files.filter(
    (file) => !deselectedPaths.has(file.path),
  ).length;
  const allSelected = selectedCount === files.length;
  const noneSelected = selectedCount === 0;

  useEffect(() => {
    if (masterRef.current) {
      masterRef.current.indeterminate = !allSelected && !noneSelected;
    }
  }, [allSelected, noneSelected]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border pb-1">
        <label className={cn(ROW_CLASS, "grid-cols-[1rem_minmax(0,1fr)]")}>
          <input
            ref={masterRef}
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={allSelected}
            disabled={disabled}
            aria-label="Select all files"
            onChange={(event) => onToggleAll(event.target.checked)}
          />
          <span className="truncate text-xs leading-5">All files</span>
        </label>
        <p
          className="m-0 shrink-0 text-xs leading-5 text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {selectedCount} of {formatWorkspaceChangedFilesLabel(files.length)}{" "}
          selected
        </p>
      </div>
      <ul className="mt-1 min-h-0 space-y-0.5 overflow-auto">
        {files.map((file) => (
          <li key={file.path}>
            <label className={ROW_CLASS}>
              <input
                type="checkbox"
                className={CHECKBOX_CLASS}
                checked={!deselectedPaths.has(file.path)}
                disabled={disabled}
                aria-label={`${describeFileStatus(file.status)}, ${file.path}`}
                onChange={(event) =>
                  onToggleFile(file.path, event.target.checked)
                }
              />
              <span className="text-xs leading-5 text-muted-foreground opacity-70">
                {formatWorkspaceFileStatus(file.status)}
              </span>
              <FilePathLink path={file.path} className="opacity-70" />
              {file.insertions !== null && file.deletions !== null ? (
                <DiffStatsTally
                  insertions={file.insertions}
                  deletions={file.deletions}
                  hideZero
                  className="text-xs leading-5"
                />
              ) : null}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
