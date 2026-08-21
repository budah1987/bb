import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { NotesPanel } from "@/components/notes/NotesPanel";
import { PluginThreadRailSections } from "@/components/plugin/PluginThreadRailSections";
import { PANEL_COLLAPSE_TRANSITION_CLASS } from "@/components/secondary-panel/panelTransitionTokens";
import { useStandaloneCompactPwa } from "@/hooks/useStandaloneCompactPwa";
import { useIsRailVisible } from "@/lib/rail-visibility";
import type { ThreadWorkflowAction } from "@/lib/thread-workflow-action";
import { AgentActivitySection } from "./AgentActivitySection";
import type { AgentActivityData } from "./AgentActivitySection";
import { EnvironmentSection } from "./EnvironmentSection";
import { FeedbackReviewSection } from "./FeedbackReviewSection";
import { RepositoryHealthSection } from "./RepositoryHealthSection";
import { RailPanelTitle } from "./RailPanelTitle";
import { RAIL_SECTION_STACK_CLASS } from "./railStyleTokens";

/**
 * Fixed, not resizable. The rail is a reading column of short rows, so it has
 * one right width; the secondary panel beside it is the surface that holds
 * variable-width content and already owns a drag handle.
 */
export const THREAD_RAIL_WIDTH_PX = 288;

/** Clearance between the card and every edge of the conversation column. */
export const THREAD_RAIL_GUTTER_PX = 12;

/**
 * Horizontal space the conversation reserves so its content clears the card.
 * Derived, never restated: the card plus a gutter on each side.
 */
export const THREAD_RAIL_CONTENT_INSET_PX =
  THREAD_RAIL_WIDTH_PX + THREAD_RAIL_GUTTER_PX * 2;

/**
 * `docked` reserves {@link THREAD_RAIL_CONTENT_INSET_PX} beside the transcript;
 * `floating` lets the card overlay it. A column that is already narrow — the
 * secondary panel is open, or this is a bounded split pane — cannot spare 312px
 * without squeezing the transcript below a readable measure, so it takes the
 * overlay instead.
 */
export type ThreadRailVariant = "docked" | "floating";

/**
 * Padding the conversation column should carry for the rail, or 0 when the rail
 * is not on screen. Shares the visibility gates with {@link ThreadRail} rather
 * than threading them through props, so the two can never disagree.
 */
export function useThreadRailContentInsetPx(
  threadId: string,
  variant: ThreadRailVariant,
): number {
  const isRailVisible = useIsRailVisible(threadId);
  const isCompactViewport = useIsCompactViewport();
  const isStandaloneCompactPwa = useStandaloneCompactPwa();

  if (
    variant === "floating" ||
    !isRailVisible ||
    isCompactViewport ||
    isStandaloneCompactPwa
  ) {
    return 0;
  }
  return THREAD_RAIL_CONTENT_INSET_PX;
}

export interface ThreadRailProps {
  agentActivityData?: AgentActivityData;
  onReviewChanges?: () => void;
  threadId: string;
  workflowActions?: readonly ThreadWorkflowAction[];
}

/**
 * The right rail: a card floating inside the conversation column, clear of
 * every edge by {@link THREAD_RAIL_GUTTER_PX}, not a column beside it. The
 * wrapper is absolutely positioned and takes no layout space, so showing and
 * hiding the rail never reflows the timeline/panel split — only the
 * conversation's reserved padding changes, and that animates.
 *
 * `flex flex-col` on the wrapper plus `max-h-full` on the card is what makes it
 * hug its content and stop at the available height instead of stretching to a
 * full-height slab.
 *
 * The body is a plain vertical stack, which is the whole extension point:
 * grouped sections (Environment / Repository / Pull request) land here as
 * siblings of Notes, in order, with no layout change.
 *
 * Hidden is a state, not an unmount: the card stays mounted and slides out, so
 * the toggle animates in both directions. It is `inert` while closed, so the
 * off-screen content is out of the tab order and the a11y tree.
 *
 * Renders nothing at all on compact surfaces. A 288px card over a conversation
 * is a wide-viewport affordance, and in the standalone PWA it would be most of
 * the screen.
 */
export function ThreadRail({
  agentActivityData,
  onReviewChanges,
  threadId,
  workflowActions = [],
}: ThreadRailProps) {
  const isRailVisible = useIsRailVisible(threadId);
  const isCompactViewport = useIsCompactViewport();
  const isStandaloneCompactPwa = useStandaloneCompactPwa();

  if (isCompactViewport || isStandaloneCompactPwa) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 z-20 flex flex-col"
      style={{
        padding: THREAD_RAIL_GUTTER_PX,
        width: THREAD_RAIL_CONTENT_INSET_PX,
      }}
    >
      <aside
        aria-label="Rail"
        aria-hidden={!isRailVisible}
        inert={!isRailVisible}
        data-thread-rail=""
        data-state={isRailVisible ? "open" : "closed"}
        className={cn(
          "relative flex max-h-full w-full min-h-0 flex-col overflow-hidden",
          // The border carries the separation. Keep the shadow quiet so the
          // rail reads as product chrome instead of a glowing overlay.
          "rounded-[14px] border border-border bg-popover text-popover-foreground shadow-sm",
          "transition-[transform,opacity] motion-reduce:transition-none",
          PANEL_COLLAPSE_TRANSITION_CLASS,
          isRailVisible
            ? "pointer-events-auto translate-x-0 opacity-100"
            : "pointer-events-none translate-x-full opacity-0",
        )}
      >
        <RailContents
          agentActivityData={agentActivityData}
          onReviewChanges={onReviewChanges}
          threadId={threadId}
          enabled={isRailVisible}
          workflowActions={workflowActions}
        />
      </aside>
    </div>
  );
}

function RailContents({
  agentActivityData,
  onReviewChanges,
  threadId,
  enabled,
  workflowActions,
}: {
  agentActivityData?: AgentActivityData;
  onReviewChanges?: () => void;
  threadId: string;
  enabled: boolean;
  workflowActions: readonly ThreadWorkflowAction[];
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1">
      <div className="flex min-w-0 flex-col px-1.5">
        <RailPanelTitle>Environment</RailPanelTitle>
        <div className={RAIL_SECTION_STACK_CLASS}>
          <EnvironmentSection threadId={threadId} enabled={enabled} />
          <AgentActivitySection
            data={agentActivityData}
            threadId={threadId}
            enabled={enabled}
          />
          <RepositoryHealthSection
            threadId={threadId}
            enabled={enabled}
            onReviewChanges={onReviewChanges}
            workflowActions={workflowActions}
          />
          <FeedbackReviewSection threadId={threadId} enabled={enabled} />
          <PluginThreadRailSections threadId={threadId} enabled={enabled} />
        </div>
      </div>
      <div className="mt-1 border-t border-border-hairline pt-1">
        <NotesPanel threadId={threadId} enabled={enabled} />
      </div>
    </div>
  );
}
