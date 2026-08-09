import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { Textarea } from "@bb/shared-ui/textarea";
import { cn } from "@bb/shared-ui/lib/utils";
import { TruncateStart } from "@/components/ui/truncate-start.js";

interface TextFileEditorProps {
  path: string;
  initialContents: string;
  isSaving: boolean;
  errorMessage: string | null;
  isConflict: boolean;
  onCancel: () => void;
  onReload: () => void;
  onSave: (contents: string) => void;
}

const EDITOR_LINE_HEIGHT_CLASS = "leading-5";

export function TextFileEditor({
  path,
  initialContents,
  isSaving,
  errorMessage,
  isConflict,
  onCancel,
  onReload,
  onSave,
}: TextFileEditorProps) {
  const [contents, setContents] = useState(initialContents);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const isDirty = contents !== initialContents;
  const lineCount = useMemo(() => contents.split("\n").length, [contents]);

  useEffect(() => {
    setContents(initialContents);
  }, [initialContents, path]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [path]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="sticky top-0 z-10 shrink-0 bg-sidebar">
        <div className="flex min-h-9 items-center gap-2 bg-surface-raised px-4 py-1.5">
          <Icon
            name="FileText"
            className="size-3.5 shrink-0 text-file-accent"
          />
          <TruncateStart
            className={cn(
              "min-w-0 flex-1 font-sans font-medium leading-5 text-file-accent",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
          >
            {path}
          </TruncateStart>
          {isDirty ? (
            <span
              className={cn(
                "shrink-0 text-muted-foreground",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
            >
              Unsaved
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={COARSE_POINTER_TEXT_SM_CLASS}
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className={COARSE_POINTER_TEXT_SM_CLASS}
            onClick={() => onSave(contents)}
            disabled={!isDirty || isSaving}
          >
            <Icon
              name={isSaving ? "Spinner" : "Check"}
              className={cn(isSaving && "animate-spin")}
            />
            {isSaving ? "Saving" : "Save"}
          </Button>
        </div>
        {errorMessage ? (
          <div
            role="alert"
            className="flex items-center gap-2 border-t border-surface-destructive-border bg-surface-destructive px-4 py-2 text-xs text-destructive"
          >
            <Icon name="AlertTriangle" className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{errorMessage}</span>
            {isConflict ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 border-surface-destructive-border text-xs text-destructive hover:bg-surface-destructive"
                onClick={onReload}
              >
                Reload latest
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        <div
          ref={lineNumbersRef}
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-12 select-none overflow-hidden border-r border-border bg-surface-recessed px-3 pt-3 text-right font-mono text-xs text-muted-foreground/65",
            EDITOR_LINE_HEIGHT_CLASS,
          )}
        >
          {Array.from({ length: lineCount }, (_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
        <Textarea
          ref={textareaRef}
          aria-label={`Edit ${path}`}
          className={cn(
            "h-full resize-none rounded-none border-0 bg-transparent py-3 pl-16 pr-4 font-mono text-sm leading-5 text-foreground shadow-none focus-visible:ring-0 max-md:pointer-coarse:text-base",
            EDITOR_LINE_HEIGHT_CLASS,
          )}
          spellCheck={false}
          value={contents}
          onChange={(event) => setContents(event.target.value)}
          onScroll={(event) => {
            if (lineNumbersRef.current) {
              lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
            }
          }}
        />
      </div>
    </div>
  );
}
