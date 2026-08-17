import {
  threadTimelineResponseSchema,
  type ThreadTimelineResponse,
} from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import { mergePluginBackgroundActivity } from "../../src/services/threads/timeline.js";
import { readJson } from "../helpers/json.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("plugin background activity in the public thread timeline", () => {
  it("orders plugin and native activity together without replacing native rows", () => {
    const nativeRow: ThreadTimelineResponse["activeBackgroundCommands"][number] =
      {
        id: "native-agent",
        threadId: "thread-1",
        turnId: "turn-1",
        sourceSeqStart: 1,
        sourceSeqEnd: 1,
        startedAt: 15,
        createdAt: 15,
        kind: "work",
        workKind: "workflow",
        status: "pending",
        itemId: "native-agent",
        taskType: "local_subagent",
        workflowName: null,
        description: "Native worker",
        taskStatus: "running",
        workflow: null,
        usage: null,
        summary: null,
        error: null,
        completedAt: null,
      };
    const response: ThreadTimelineResponse = {
      rows: [],
      activePromptMode: null,
      activeThinking: null,
      activeWorkflows: [],
      activeBackgroundCommands: [nativeRow],
      pendingTodos: null,
      goal: null,
      modelFallback: null,
      maxSeq: 1,
      timelinePage: {
        kind: "latest",
        segmentLimit: 20,
        returnedSegmentCount: 0,
        hasOlderRows: false,
        olderCursor: null,
      },
    };

    const merged = mergePluginBackgroundActivity(response, {
      threadId: "thread-1",
      contributions: [
        {
          pluginId: "model-relay",
          id: "worker",
          kind: "agent",
          title: "Relay worker",
          detail: null,
          startedAtMs: 20,
        },
      ],
    });

    expect(merged.activeBackgroundCommands.map((row) => row.id)).toEqual([
      "plugin-background:plugin:model-relay:worker",
      "native-agent",
    ]);
    expect(merged.activeBackgroundCommands[1]).toBe(nativeRow);
  });

  it("merges live plugin work outside the event-backed timeline cache", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const listBackgroundActivity = vi
        .spyOn(harness.pluginService, "listBackgroundActivity")
        .mockReturnValue([
          {
            pluginId: "model-relay",
            id: "agent-1",
            kind: "agent",
            title: "Fable",
            detail: "Reviewing changes",
            startedAtMs: 20,
          },
          {
            pluginId: "model-relay",
            id: "preview-1",
            kind: "command",
            title: "Local preview",
            detail: null,
            startedAtMs: 10,
          },
          // A malformed provider can repeat its supposedly unique id. The
          // timeline keeps the first item deterministically.
          {
            pluginId: "model-relay",
            id: "agent-1",
            kind: "agent",
            title: "Duplicate",
            detail: null,
            startedAtMs: 5,
          },
        ]);

      const firstResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
      );
      expect(firstResponse.status).toBe(200);
      const first = threadTimelineResponseSchema.parse(
        await readJson(firstResponse),
      );
      expect(first.activeBackgroundCommands).toMatchObject([
        {
          id: "plugin-background:plugin:model-relay:agent-1",
          itemId: "plugin:model-relay:agent-1",
          taskType: "plugin_agent",
          description: "Fable",
          summary: "Reviewing changes",
          status: "pending",
          taskStatus: "running",
        },
        {
          id: "plugin-background:plugin:model-relay:preview-1",
          itemId: "plugin:model-relay:preview-1",
          taskType: "plugin_command",
          description: "Local preview",
          summary: null,
          status: "pending",
          taskStatus: "running",
        },
      ]);

      // No event was appended, so the native timeline response comes from the
      // same maxSeq cache entry. Plugin work must still be read and replaced.
      listBackgroundActivity.mockReturnValue([
        {
          pluginId: "model-relay",
          id: "agent-2",
          kind: "agent",
          title: "Terra",
          detail: "Checking tests",
          startedAtMs: 30,
        },
      ]);
      const secondResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
      );
      const second = threadTimelineResponseSchema.parse(
        await readJson(secondResponse),
      );
      expect(second.activeBackgroundCommands).toMatchObject([
        {
          itemId: "plugin:model-relay:agent-2",
          taskType: "plugin_agent",
          description: "Terra",
          summary: "Checking tests",
        },
      ]);
      expect(listBackgroundActivity).toHaveBeenCalledTimes(2);
      expect(listBackgroundActivity).toHaveBeenCalledWith(thread.id);
    });
  });
});
