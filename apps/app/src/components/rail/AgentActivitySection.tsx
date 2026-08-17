import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  backgroundTaskItemStatus,
  isBackgroundAgentTaskType,
  type WorkflowAgentState,
} from "@bb/domain";
import type {
  ThreadTimelineResponse,
  TimelineDelegationWorkRow,
  TimelineRow,
  TimelineRowStatus,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useThreadTimeline } from "@/hooks/queries/thread-queries";
import { RailSection } from "./RailSection";
import { RAIL_BODY_TEXT_CLASS, RAIL_PROSE_CLASS } from "./railStyleTokens";

export type AgentActivityState = "running" | "failed" | "complete";

export interface AgentActivityItem {
  detail: string;
  id: string;
  state: AgentActivityState;
  title: string;
  updatedAt: number;
}

export interface AgentActivityData {
  activeBackgroundCommands: ThreadTimelineResponse["activeBackgroundCommands"];
  isError: boolean;
  isLoading: boolean;
  rows: ThreadTimelineResponse["rows"];
}

const AGENT_DETAIL_MAX_LENGTH = 160;

function boundedAgentDetail(value: string): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length <= AGENT_DETAIL_MAX_LENGTH
    ? compact
    : `${compact.slice(0, AGENT_DETAIL_MAX_LENGTH - 1).trimEnd()}…`;
}

function timelineStatus(state: TimelineRowStatus): AgentActivityState {
  if (state === "pending") return "running";
  if (state === "error") return "failed";
  return "complete";
}

function workflowAgentStatus(state: WorkflowAgentState): AgentActivityState {
  if (state === "queued" || state === "running") return "running";
  if (state === "failed") return "failed";
  return "complete";
}

function delegationItem(row: TimelineDelegationWorkRow): AgentActivityItem {
  const state = timelineStatus(row.status);
  return {
    detail: boundedAgentDetail(
      state === "running"
        ? (row.description ?? "Working")
        : state === "failed"
          ? row.output || "Failed"
          : row.output || row.description || "Completed",
    ),
    id: `delegation:${row.callId}`,
    state,
    title: row.subagentType ?? row.description ?? "Sub-agent",
    updatedAt: row.completedAt ?? row.startedAt,
  };
}

function workflowItems(row: TimelineWorkflowWorkRow): AgentActivityItem[] {
  if (row.workflow?.agents.length) {
    return row.workflow.agents.map((agent) => {
      const state = workflowAgentStatus(agent.state);
      return {
        detail: boundedAgentDetail(
          state === "running"
            ? (agent.lastToolSummary ?? agent.promptPreview ?? agent.model)
            : state === "failed"
              ? (agent.error ?? "Failed")
              : (agent.resultPreview ?? "Completed"),
        ),
        id: `${row.itemId}:agent:${agent.index}`,
        state,
        title: agent.label || agent.agentType || `Agent ${agent.index}`,
        updatedAt: agent.lastProgressAt,
      };
    });
  }

  if (!isBackgroundAgentTaskType(row.taskType)) return [];
  const itemStatus = backgroundTaskItemStatus(row.taskStatus);
  const state =
    itemStatus === "pending"
      ? "running"
      : itemStatus === "failed"
        ? "failed"
        : "complete";
  return [
    {
      detail: boundedAgentDetail(
        state === "running"
          ? (row.summary ?? "Working")
          : state === "failed"
            ? (row.error ?? "Failed")
            : (row.summary ?? "Completed"),
      ),
      id: `background:${row.itemId}`,
      state,
      title: row.description || "Sub-agent",
      updatedAt: row.completedAt ?? row.startedAt,
    },
  ];
}

function collectAgentItems(rows: readonly TimelineRow[]): AgentActivityItem[] {
  const items: AgentActivityItem[] = [];
  for (const row of rows) {
    if (row.kind === "turn") {
      if (row.children) items.push(...collectAgentItems(row.children));
      continue;
    }
    if (row.kind !== "work") continue;
    if (row.workKind === "delegation") {
      items.push(delegationItem(row));
      items.push(...collectAgentItems(row.childRows));
      continue;
    }
    if (row.workKind === "workflow") {
      items.push(...workflowItems(row));
    }
  }
  return items;
}

export function selectAgentActivityItems(
  timeline:
    | Pick<ThreadTimelineResponse, "activeBackgroundCommands" | "rows">
    | undefined,
): AgentActivityItem[] {
  if (!timeline) return [];

  const latestTurn = [...timeline.rows]
    .reverse()
    .find((row) => row.kind === "turn");
  const latestAgentTurnItems =
    latestTurn?.kind === "turn" && latestTurn.children
      ? collectAgentItems(latestTurn.children)
      : [];
  const liveItems = timeline.activeBackgroundCommands.flatMap(workflowItems);
  const byId = new Map<string, AgentActivityItem>();
  for (const item of [...latestAgentTurnItems, ...liveItems]) {
    const existing = byId.get(item.id);
    if (
      existing === undefined ||
      item.state === "running" ||
      item.updatedAt >= existing.updatedAt
    ) {
      byId.set(item.id, item);
    }
  }

  return Array.from(byId.values()).sort(
    (left, right) =>
      (left.state === "running" ? 0 : left.state === "failed" ? 1 : 2) -
        (right.state === "running" ? 0 : right.state === "failed" ? 1 : 2) ||
      right.updatedAt - left.updatedAt,
  );
}

function ActivityNode({ state }: { state: AgentActivityState }) {
  if (state === "failed") {
    return (
      <span className="relative z-10 grid size-4 shrink-0 place-items-center bg-popover text-destructive">
        <Icon name="CircleX" className="size-3.5" aria-hidden />
      </span>
    );
  }

  return (
    <span className="relative z-10 grid size-4 shrink-0 place-items-center bg-popover">
      {state === "running" ? (
        <span className="absolute size-2.5 animate-ping rounded-full bg-accent-foreground/20 motion-reduce:animate-none" />
      ) : null}
      <span
        className={cn(
          "relative size-2 rounded-full border-2 border-popover",
          state === "running"
            ? "bg-accent-foreground"
            : "bg-muted-foreground/55",
        )}
      />
    </span>
  );
}

export function AgentActivitySection({
  data,
  enabled = true,
  threadId,
}: {
  data?: AgentActivityData;
  enabled?: boolean;
  threadId: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const timelineQuery = useThreadTimeline(threadId, {
    enabled: enabled && data === undefined,
  });
  const timeline = data ?? timelineQuery.data;
  const isLoading = data?.isLoading ?? timelineQuery.isLoading;
  const isError = data?.isError ?? timelineQuery.isError;
  const items = useMemo(() => selectAgentActivityItems(timeline), [timeline]);
  const runningCount = items.filter((item) => item.state === "running").length;
  const failedCount = items.filter((item) => item.state === "failed").length;

  const updateScrollFades = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
    setCanScrollUp(viewport.scrollTop > 2);
    setCanScrollDown(viewport.scrollTop < maxScrollTop - 2);
  }, []);

  useLayoutEffect(() => {
    updateScrollFades();
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateScrollFades);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [items, isExpanded, updateScrollFades]);

  if (!enabled || (!isLoading && !isError && items.length === 0)) {
    return null;
  }

  const summary = failedCount
    ? `${failedCount} failed${runningCount ? ` · ${runningCount} active` : ""}`
    : runningCount
      ? `${runningCount} active`
      : `${items.length} complete`;

  return (
    <RailSection
      isExpanded={isExpanded}
      label="Sub-agents"
      onToggle={() => setIsExpanded((current) => !current)}
      trailing={
        items.length ? (
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums",
              failedCount ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {summary}
          </span>
        ) : null
      }
    >
      {isError ? (
        <p
          role="alert"
          className={cn(RAIL_PROSE_CLASS, "py-1 text-destructive")}
        >
          Could not load sub-agents.
        </p>
      ) : isLoading ? (
        <p role="status" className={cn(RAIL_PROSE_CLASS, "py-1")}>
          Loading sub-agents…
        </p>
      ) : (
        <div className="relative">
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 z-20 h-5 bg-gradient-to-b from-popover to-transparent transition-opacity duration-150 motion-reduce:transition-none",
              canScrollUp ? "opacity-100" : "opacity-0",
            )}
          />
          <div
            ref={viewportRef}
            onScroll={updateScrollFades}
            role="region"
            aria-label="Sub-agent activity timeline"
            tabIndex={0}
            className="no-scrollbar max-h-52 overflow-y-auto overscroll-contain rounded-md py-1 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <div className="relative flex min-w-0 flex-col before:absolute before:bottom-4 before:left-2 before:top-4 before:w-px before:bg-border-hairline">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex min-h-12 min-w-0 items-start gap-2 py-1.5 pr-2"
                >
                  <ActivityNode state={item.state} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        RAIL_BODY_TEXT_CLASS,
                        "block truncate",
                        item.state === "failed"
                          ? "text-destructive"
                          : item.state === "running"
                            ? "text-foreground"
                            : "text-muted-foreground",
                      )}
                    >
                      {item.title}
                    </span>
                    <span className="block truncate text-xs leading-4 text-subtle-foreground/75">
                      {item.detail}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 z-20 h-5 bg-gradient-to-t from-popover to-transparent transition-opacity duration-150 motion-reduce:transition-none",
              canScrollDown ? "opacity-100" : "opacity-0",
            )}
          />
        </div>
      )}
    </RailSection>
  );
}
