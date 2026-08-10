import { cn } from "@bb/shared-ui/lib/utils";
import { RAIL_LABEL_CLASS } from "./railStyleTokens";

export interface RailPanelTitleProps {
  children: string;
}

/**
 * The rail card's title row. Deliberately the same quiet tier as a section
 * label: the card names itself once, then gets out of the way.
 */
export function RailPanelTitle({ children }: RailPanelTitleProps) {
  return (
    <h2 className={cn(RAIL_LABEL_CLASS, "min-w-0 truncate px-2 py-1")}>
      {children}
    </h2>
  );
}
