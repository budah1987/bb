import { describe, expect, it } from "vitest";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import {
  backgroundCommandRow,
  delegationRow,
  turnRow,
  workflowRow,
} from "@/test/fixtures/thread-timeline-rows";
import { selectAgentActivityItems } from "./AgentActivitySection";

function timeline(
  rows: ThreadTimelineResponse["rows"],
  activeBackgroundCommands: ThreadTimelineResponse["activeBackgroundCommands"] = [],
): ThreadTimelineResponse {
  return {
    rows,
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands,
    pendingTodos: null,
    goal: null,
    modelFallback: null,
    timelinePage: {
      kind: "latest",
      segmentLimit: 100,
      returnedSegmentCount: rows.length,
      hasOlderRows: false,
      olderCursor: null,
    },
    maxSeq: 1,
  };
}

describe("selectAgentActivityItems", () => {
  it("keeps the latest relay turn and merges live background agents", () => {
    const oldTurn = turnRow({
      id: "old-turn",
      children: [delegationRow({ callId: "old", description: "Old review" })],
    });
    const latestTurn = turnRow({
      id: "latest-turn",
      children: [
        delegationRow({
          callId: "running",
          description: "Reviewing UI",
          durationMs: null,
          output: "",
          status: "pending",
          subagentType: "Fable",
        }),
        delegationRow({
          callId: "done",
          description: "Checked contract",
          output: "No blockers",
          subagentType: "Terra",
        }),
      ],
    });
    const liveAgent = workflowRow({
      id: "plugin-agent",
      itemId: "plugin-agent",
      taskType: "plugin_agent",
      taskStatus: "running",
      status: "pending",
      description: "Opus",
      summary: "Building the interface",
      durationMs: null,
      startedAt: 10,
    });

    expect(
      selectAgentActivityItems(
        timeline(
          [oldTurn, latestTurn],
          [backgroundCommandRow({ id: "shell" }), liveAgent],
        ),
      ).map(({ title, detail, state }) => ({ title, detail, state })),
    ).toEqual([
      { title: "Opus", detail: "Building the interface", state: "running" },
      { title: "Fable", detail: "Reviewing UI", state: "running" },
      { title: "Terra", detail: "No blockers", state: "complete" },
    ]);
  });

  it("turns failures into a destructive activity state", () => {
    const failed = delegationRow({
      callId: "failed",
      description: "Visual review",
      output: "Spacing regression",
      status: "error",
      subagentType: "Reviewer",
    });

    expect(
      selectAgentActivityItems(timeline([turnRow({ children: [failed] })])),
    ).toMatchObject([
      {
        title: "Reviewer",
        detail: "Spacing regression",
        state: "failed",
      },
    ]);
  });

  it("bounds completed output used as secondary rail text", () => {
    const completed = delegationRow({
      callId: "verbose",
      output: "result ".repeat(100),
      subagentType: "Reviewer",
    });

    const [item] = selectAgentActivityItems(
      timeline([turnRow({ children: [completed] })]),
    );

    expect(item?.detail.length).toBeLessThanOrEqual(160);
    expect(item?.detail.endsWith("…")).toBe(true);
  });

  it("does not keep an old agent turn in the rail forever", () => {
    const oldAgentTurn = turnRow({
      id: "agent-turn",
      children: [delegationRow({ callId: "old", subagentType: "Reviewer" })],
    });
    const latestPlainTurn = turnRow({ id: "plain-turn", children: [] });

    expect(
      selectAgentActivityItems(timeline([oldAgentTurn, latestPlainTurn])),
    ).toEqual([]);
  });
});
