import { useCallback } from "react";
import { THREAD_SCRATCHPAD_MAX_LENGTH } from "@bb/server-contract";
import { Textarea } from "@bb/shared-ui/textarea";
import { cn } from "@bb/shared-ui/lib/utils";
import { useSetThreadScratchpad } from "@/hooks/mutations/thread-notes-mutations";
import { RailSection } from "@/components/rail/RailSection";
import {
  RAIL_BODY_TEXT_CLASS,
  RAIL_LABEL_CLASS,
  RAIL_PLACEHOLDER_CLASS,
} from "@/components/rail/railStyleTokens";
import { useScratchpadAutosave } from "./useScratchpadAutosave";

/**
 * The counter is noise until the cap is actually in reach, so it stays hidden
 * for the length a passing thought normally occupies.
 */
const SCRATCHPAD_COUNTER_VISIBLE_FROM = 300;

/**
 * A filled input reads as noise in a card this quiet, and a focus ring reads as
 * a second card edge inside the first. The field is a hairline outline over the
 * card surface that warms on focus — enough to say "you are typing here", and
 * nothing more.
 */
const SCRATCHPAD_FIELD_CLASS =
  "min-h-24 resize-none rounded-lg border-border-hairline bg-transparent px-3 py-2 focus-visible:border-border focus-visible:ring-0";

export interface ScratchpadSectionProps {
  isExpanded: boolean;
  onToggle: () => void;
  scratchpad: string;
  threadId: string;
}

/** One plain textarea, autosaved. Not a note list — a scratchpad. */
export function ScratchpadSection({
  isExpanded,
  onToggle,
  scratchpad,
  threadId,
}: ScratchpadSectionProps) {
  const setScratchpad = useSetThreadScratchpad();
  const save = setScratchpad.mutate;
  const { draft, setDraft } = useScratchpadAutosave({
    onSave: save,
    persistedValue: scratchpad,
    threadId,
  });
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setDraft(event.target.value);
    },
    [setDraft],
  );

  const showsCounter = draft.length >= SCRATCHPAD_COUNTER_VISIBLE_FROM;
  const status = setScratchpad.isError
    ? "Not saved"
    : setScratchpad.isPending
      ? "Saving"
      : setScratchpad.isSuccess
        ? "Saved"
        : null;

  return (
    <RailSection isExpanded={isExpanded} label="Scratchpad" onToggle={onToggle}>
      <Textarea
        aria-label="Thread scratchpad"
        className={cn(
          SCRATCHPAD_FIELD_CLASS,
          RAIL_BODY_TEXT_CLASS,
          RAIL_PLACEHOLDER_CLASS,
        )}
        maxLength={THREAD_SCRATCHPAD_MAX_LENGTH}
        onChange={handleChange}
        placeholder="Type here"
        spellCheck
        value={draft}
      />
      <div className="mt-1 flex min-h-4 items-center justify-between gap-2">
        <span
          aria-live="polite"
          className={cn(
            RAIL_LABEL_CLASS,
            setScratchpad.isError && "text-destructive",
          )}
        >
          {status}
        </span>
        {showsCounter ? (
          <span
            className={cn(
              RAIL_LABEL_CLASS,
              "shrink-0 tabular-nums",
              draft.length >= THREAD_SCRATCHPAD_MAX_LENGTH &&
                "text-warning-text",
            )}
          >
            {draft.length}/{THREAD_SCRATCHPAD_MAX_LENGTH}
          </span>
        ) : null}
      </div>
    </RailSection>
  );
}
