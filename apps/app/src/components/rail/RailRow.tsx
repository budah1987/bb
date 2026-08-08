import type { ReactNode } from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  RAIL_BODY_TEXT_CLASS,
  RAIL_INTERACTIVE_CLASS,
} from "./railStyleTokens";

export interface RailRowProps {
  /** The row's one line of text. Truncates; never wraps. */
  label: string;
  /** Leading glyph, at the same weight as the label. */
  icon?: IconName;
  /**
   * Trailing state: a count or a short plain string. Never a badge — a rail row
   * that has something to report either says it here or gets a row of its own.
   */
  trailing?: ReactNode;
  /** Makes the row a button. Without it the row is inert presentation. */
  onSelect?: () => void;
  disabled?: boolean;
  /** Trailing chevron, for a row that opens something. */
  showsChevron?: boolean;
}

/**
 * The rail's list grammar: one line, leading icon, trailing state, optional
 * chevron. Shares {@link RAIL_INTERACTIVE_CLASS} with the section header, so a
 * row and the header above it are the same shape at different emphases.
 *
 * Selectable rows use {@link LIST_HOVER_TRANSITION}: the highlight must track
 * the pointer exactly down a dense list, with no fade trailing behind it.
 */
export function RailRow({
  disabled = false,
  icon,
  label,
  onSelect,
  showsChevron = false,
  trailing,
}: RailRowProps) {
  const content = (
    <>
      {icon ? (
        <Icon name={icon} aria-hidden className="size-4 shrink-0" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
      {showsChevron ? (
        <Icon
          name="ChevronRight"
          aria-hidden
          className="size-3 shrink-0 opacity-60"
        />
      ) : null}
    </>
  );

  const className = cn(
    RAIL_INTERACTIVE_CLASS,
    RAIL_BODY_TEXT_CLASS,
    "text-muted-foreground",
  );

  if (!onSelect) {
    // No handler means nothing to press: rendering a disabled button would put
    // a dead control in the tab order for what is really just a line of text.
    return (
      <div className={cn(className, "hover:bg-transparent")}>{content}</div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        className,
        LIST_HOVER_TRANSITION,
        "cursor-pointer disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {content}
    </button>
  );
}
