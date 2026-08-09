import { useCallback, useEffect, useRef, useState } from "react";
import {
  useThreadConversationOutline,
  useThreadNotes,
} from "@/hooks/queries/thread-queries";
import { useGenerateThreadRecap } from "@/hooks/mutations/thread-notes-mutations";
import { RailPanelTitle } from "@/components/rail/RailPanelTitle";
import { RAIL_SECTION_STACK_CLASS } from "@/components/rail/railStyleTokens";
import { RecapSection } from "./RecapSection";
import { ScratchpadSection } from "./ScratchpadSection";

export interface NotesPanelProps {
  threadId: string;
}

/**
 * The Notes tab: a generated Recap over the thread's own scratchpad.
 *
 * Both sections start expanded. Recap in particular must: its out-of-date state
 * is rendered inside the section, so a collapsed Recap can present a stale
 * summary as current simply by hiding the fact. Opening the tab at all is the
 * deliberate act — nothing further should be required to see the truth.
 */
export function NotesPanel({ threadId }: NotesPanelProps) {
  const [isRecapExpanded, setIsRecapExpanded] = useState(true);
  const [isScratchpadExpanded, setIsScratchpadExpanded] = useState(true);
  const notesQuery = useThreadNotes(threadId);
  // Only the recap needs the thread's current sequence, and only to judge
  // staleness — so the outline (a whole-thread payload) is fetched only while
  // the recap is open. React Query dedupes it against the timeline minimap's
  // own fetch when that is already mounted.
  const outlineQuery = useThreadConversationOutline(threadId, {
    enabled: isRecapExpanded,
  });
  const toggleRecap = useCallback(
    () => setIsRecapExpanded((current) => !current),
    [],
  );
  const toggleScratchpad = useCallback(
    () => setIsScratchpadExpanded((current) => !current),
    [],
  );

  const notes = notesQuery.data;

  // Opening the recap requests one. The server returns an already-current recap
  // untouched, so the common case costs two reads — but the request is also
  // what marks this thread's recap as worth maintaining, which is the gate
  // automatic regeneration is keyed on.
  //
  // Once per mounted thread: the effect must not re-fire when the notes row
  // changes, or a thread whose recap genuinely cannot be generated would retry
  // on every cache update.
  const generateRecap = useGenerateThreadRecap();
  const requestRecapRef = useRef(generateRecap.mutate);
  requestRecapRef.current = generateRecap.mutate;
  const hasRequestedRecapRef = useRef(false);
  useEffect(() => {
    hasRequestedRecapRef.current = false;
  }, [threadId]);
  useEffect(() => {
    if (!isRecapExpanded || hasRequestedRecapRef.current) return;
    // Wait for the first read: without it we cannot tell an already-current
    // recap from a missing one, and would post before knowing anything.
    if (notesQuery.isLoading) return;
    hasRequestedRecapRef.current = true;
    requestRecapRef.current({ threadId });
  }, [isRecapExpanded, notesQuery.isLoading, threadId]);

  return (
    <div className="flex min-w-0 flex-col px-1.5">
      <RailPanelTitle>Notes</RailPanelTitle>
      {/*
        Sections carry their own leading dividers and the stack hides the first,
        so any of them can become conditional without leaving a dangling rule.
      */}
      <div className={RAIL_SECTION_STACK_CLASS}>
        <RecapSection
          currentSeq={outlineQuery.data?.maxSeq ?? null}
          isExpanded={isRecapExpanded}
          isLoading={notesQuery.isLoading}
          onToggle={toggleRecap}
          recapBody={notes?.recapBody ?? null}
          recapSourceSeq={notes?.recapSourceSeq ?? null}
        />
        {/*
          Keyed by thread so a thread switch remounts the editor: the autosave's
          unmount flush then fires against the thread the text was typed into,
          and the next thread starts from its own persisted value.
        */}
        <ScratchpadSection
          key={threadId}
          isExpanded={isScratchpadExpanded}
          onToggle={toggleScratchpad}
          scratchpad={notes?.scratchpad ?? ""}
          threadId={threadId}
        />
      </div>
    </div>
  );
}
