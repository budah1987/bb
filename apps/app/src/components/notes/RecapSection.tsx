import { cn } from "@bb/shared-ui/lib/utils";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { RailSection } from "@/components/rail/RailSection";
import {
  RAIL_LABEL_CLASS,
  RAIL_PROSE_CLASS,
  RAIL_PROSE_DIM_CLASS,
} from "@/components/rail/railStyleTokens";
import { resolveRecapStaleness } from "./recap-staleness";

export interface RecapSectionProps {
  /** The thread's current high-water event sequence, or null when unknown. */
  currentSeq: number | null;
  isExpanded: boolean;
  isLoading: boolean;
  onToggle: () => void;
  recapBody: string | null;
  recapSourceSeq: number | null;
}

/**
 * The thread's generated recap. Generation is requested by {@link NotesPanel}
 * when this section is opened rather than by a control here — there is nothing
 * for the user to decide, and a button implies a cost they should not have to
 * think about.
 *
 * When the thread has moved past the sequence the recap was generated from, the
 * prose dims to the label tier and carries a plain out-of-date label. A stale
 * recap is never presented as current.
 */
export function RecapSection({
  currentSeq,
  isExpanded,
  isLoading,
  onToggle,
  recapBody,
  recapSourceSeq,
}: RecapSectionProps) {
  const staleness = resolveRecapStaleness({ currentSeq, recapSourceSeq });
  const isStale = recapBody !== null && staleness.kind === "stale";

  return (
    <RailSection
      isExpanded={isExpanded}
      label="Recap"
      onToggle={onToggle}
      trailing={
        isStale ? (
          <span className={cn(RAIL_LABEL_CLASS, "shrink-0")}>Out of date</span>
        ) : null
      }
    >
      {isLoading ? (
        <RecapSkeleton />
      ) : recapBody === null ? (
        <p className={RAIL_PROSE_DIM_CLASS}>No recap yet.</p>
      ) : (
        <p
          className={cn(
            "whitespace-pre-wrap",
            isStale ? RAIL_PROSE_DIM_CLASS : RAIL_PROSE_CLASS,
          )}
        >
          {recapBody}
        </p>
      )}
    </RailSection>
  );
}

/**
 * Two settling bars rather than a spinner: a recap arrives as a short paragraph,
 * so the placeholder should read as one too. A spinner here would imply the rail
 * is blocked on something, which it never is.
 */
function RecapSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 py-1" aria-hidden>
      <Skeleton className="h-2.5 w-full rounded motion-reduce:animate-none" />
      <Skeleton className="h-2.5 w-4/5 rounded opacity-75 motion-reduce:animate-none" />
    </div>
  );
}
