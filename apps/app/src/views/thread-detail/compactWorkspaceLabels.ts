import type { PaneContent, PaneNode } from "@/lib/split-layout";

/** The registered nav panels, narrowed to what a label needs. */
export type LabelledNavPanels = readonly {
  pluginId: string;
  path: string;
  title: string;
}[];

/**
 * A pane's name from metadata alone — the registered panel title where one
 * exists, otherwise the surface kind. Used by the travelling preview shell and
 * the Command Center workspace list, neither of which may load a thread,
 * subscribe, or mount a plugin to find out what it is looking at.
 */
export function describePaneContent(
  content: PaneContent,
  navPanels: LabelledNavPanels,
): string {
  if (content.kind === "thread") {
    return "Thread";
  }
  if (content.kind === "new-thread") {
    return "New thread";
  }
  return (
    navPanels.find(
      (panel) =>
        panel.pluginId === content.pluginId && panel.path === content.panelPath,
    )?.title ?? "Panel"
  );
}

/**
 * A pane's name for a settled list, where a thread's real title is already in
 * the app's cached navigation. Falls back to the generic kind while the title is
 * still loading or the thread is no longer listed. The travelling preview shell
 * deliberately does not use this: mid-gesture it stays generic and inert.
 */
export function paneRowLabel(
  content: PaneContent,
  navPanels: LabelledNavPanels,
  threadTitleById: ReadonlyMap<string, string>,
): string {
  if (content.kind === "thread") {
    return threadTitleById.get(content.threadId) ?? "Thread";
  }
  return describePaneContent(content, navPanels);
}

/**
 * The window of panes a capped list shows: always the active pane, plus its
 * nearest neighbours in reading order, never reordered. Centring on the active
 * pane and clamping to the ends keeps the choice deterministic — the same
 * workspace always produces the same rows.
 */
export function selectWorkspaceRows(
  panes: readonly PaneNode[],
  activePaneId: string,
  limit: number,
): readonly PaneNode[] {
  if (panes.length <= limit) {
    return panes;
  }
  const activeIndex = panes.findIndex((pane) => pane.paneId === activePaneId);
  const centred = Math.max(
    0,
    (activeIndex === -1 ? 0 : activeIndex) - Math.floor((limit - 1) / 2),
  );
  const start = Math.min(centred, panes.length - limit);
  return panes.slice(start, start + limit);
}
