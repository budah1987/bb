import { useMemo } from "react";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { usePluginSlots } from "@/lib/plugin-slots";
import type { PaneNode } from "@/lib/split-layout";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { paneRowLabel, selectWorkspaceRows } from "./compactWorkspaceLabels";
import { describeWorkspacePosition } from "./workspaceSwipeGesture";

/**
 * How many open panes the list offers before the composer. The Command Center
 * is a composer surface first: a full eight-row list would push the prompt off
 * a phone screen, and the swipe still reaches every pane.
 */
const WORKSPACE_ROW_LIMIT = 4;

const WORKSPACE_ROW_CLASS =
  // 44px minimum touch target; only transform/background/colour animate, and
  // the press scale belongs to this real button.
  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left transition-[transform,background-color,color] duration-150 hover:bg-state-hover active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

interface CompactCommandCenterIntroProps {
  /** Open panes in workspace reading order. */
  panes: readonly PaneNode[];
  /** The pane the gesture came from; it owns the position readout. */
  activePaneId: string;
  onFocusPane: (paneId: string) => void;
}

/**
 * The quiet identity strip above the Command Center composer: what this surface
 * is, where the workspace was left, and a way back into any open pane.
 *
 * Thread names come from the same cached sidebar navigation the root compose
 * page already reads for its Recent list, so the rows add a subscriber to a
 * query the shell keeps warm — no new endpoint, and no per-row thread runtime.
 */
export function CompactCommandCenterIntro({
  panes,
  activePaneId,
  onFocusPane,
}: CompactCommandCenterIntroProps) {
  const { navPanels } = usePluginSlots();
  const sidebarNavigationQuery = useSidebarNavigation();
  const threadTitleById = useMemo(() => {
    const titles = new Map<string, string>();
    const navigation = sidebarNavigationQuery.data;
    if (navigation === undefined) {
      return titles;
    }
    // Same listing the root compose page flattens for its Recent rows: the
    // personal project's threads plus every project's.
    for (const project of [
      navigation.personalProject,
      ...navigation.projects,
    ]) {
      for (const thread of project.threads) {
        titles.set(thread.id, getThreadDisplayTitle(thread));
      }
    }
    return titles;
  }, [sidebarNavigationQuery.data]);
  const position = describeWorkspacePosition(panes, activePaneId);
  const rows = selectWorkspaceRows(panes, activePaneId, WORKSPACE_ROW_LIMIT);

  return (
    <div
      data-testid="compact-command-center-intro"
      tabIndex={-1}
      className="flex shrink-0 flex-col gap-2 pb-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-sm font-medium">Command Center</p>
        {position === null ? null : (
          <p className="shrink-0 text-xs text-muted-foreground">{position}</p>
        )}
      </div>
      {panes.length > 1 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground/75">
            Continue workspace
          </p>
          <ul className="flex flex-col">
            {rows.map((pane) => (
              <li key={pane.paneId}>
                <button
                  type="button"
                  className={WORKSPACE_ROW_CLASS}
                  aria-current={
                    pane.paneId === activePaneId ? "true" : undefined
                  }
                  onClick={() => onFocusPane(pane.paneId)}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {paneRowLabel(pane.content, navPanels, threadTitleById)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {panes.indexOf(pane) + 1}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
