import { useId, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { CONTROL_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { PANEL_COLLAPSE_TRANSITION_CLASS } from "@/components/secondary-panel/panelTransitionTokens";
import {
  RAIL_DIVIDER_CLASS,
  RAIL_INTERACTIVE_CLASS,
  RAIL_LABEL_CLASS,
  RAIL_SECTION_BODY_CLASS,
} from "./railStyleTokens";

export interface RailSectionProps {
  children: ReactNode;
  isExpanded: boolean;
  label: string;
  onToggle: () => void;
  /**
   * Trailing state for the header row (e.g. the recap's out-of-date label).
   * Plain text or a count — the rail has no badges.
   */
  trailing?: ReactNode;
}

/**
 * One disclosure section of the rail card. The header is a quiet chrome label,
 * not a content heading — sections are furniture around the things that matter,
 * so nothing here competes with the content they hold.
 *
 * The section renders its own *leading* divider rather than the panel placing
 * rules between siblings; {@link RAIL_SECTION_STACK_CLASS} hides the first one.
 * Optional sections can then come and go without leaving a doubled or dangling
 * rule behind them.
 *
 * The header's trailing state sits inside the button, so it is announced with
 * the label ("Recap, Out of date") rather than stranded beside the control that
 * reveals what it refers to.
 */
export function RailSection({
  children,
  isExpanded,
  label,
  onToggle,
  trailing,
}: RailSectionProps) {
  const contentId = useId();

  return (
    <section className="flex min-w-0 flex-col">
      <div className={RAIL_DIVIDER_CLASS} data-rail-divider aria-hidden />
      <button
        type="button"
        aria-controls={contentId}
        aria-expanded={isExpanded}
        onClick={onToggle}
        className={cn(RAIL_INTERACTIVE_CLASS, CONTROL_HOVER_TRANSITION)}
      >
        <span className={cn(RAIL_LABEL_CLASS, "min-w-0 flex-1 truncate")}>
          {label}
        </span>
        {trailing}
        <Icon
          name="ChevronRight"
          aria-hidden
          className={cn(
            "size-3 shrink-0 opacity-60 transition-transform motion-reduce:transition-none",
            PANEL_COLLAPSE_TRANSITION_CLASS,
            isExpanded && "rotate-90",
          )}
        />
      </button>
      <div
        id={contentId}
        aria-hidden={!isExpanded}
        inert={!isExpanded}
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows] ease-[var(--resize-ease)] motion-reduce:transition-none",
          isExpanded
            ? "grid-rows-[1fr] duration-[var(--resize-dur)]"
            : "pointer-events-none grid-rows-[0fr] duration-150",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              RAIL_SECTION_BODY_CLASS,
              "transition-[transform,opacity] duration-150 ease-[var(--resize-ease)] motion-reduce:transition-none",
              isExpanded
                ? "translate-y-0 opacity-100 delay-[40ms]"
                : "-translate-y-1 opacity-0 delay-0",
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
