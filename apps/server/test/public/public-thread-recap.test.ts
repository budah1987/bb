import { getThreadNotes, setThreadRecap } from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import { threadNotesResponseSchema } from "@bb/server-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const piAiMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  getModel: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    complete: piAiMocks.complete,
    getModel: piAiMocks.getModel,
  }),
}));

function mockRecapCompletion(recap: string) {
  return {
    content: [
      {
        arguments: { recap },
        id: "tool_result",
        name: "result",
        type: "toolCall",
      },
    ],
  };
}

/**
 * The environment is deliberately non-git so recap generation skips its
 * best-effort workspace/pull-request host lookups: these tests are about the
 * inference boundary and the stored recap, not about daemon plumbing.
 */
function seedRecapThread(harness: TestAppHarness) {
  const fixture = seedThreadFixture(harness, {
    environment: { workspaceProvisionType: "personal" },
  });
  seedEvent(harness.deps, {
    threadId: fixture.thread.id,
    environmentId: fixture.environment.id,
    sequence: 1,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: encodeClientTurnRequestIdNumber({ value: 101 }),
      input: [{ type: "text", text: "Fix the usage provider" }],
      target: { kind: "new-turn" },
      execution: {
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
        source: "client/turn/requested",
      },
      initiator: "user",
      senderThreadId: null,
      request: { method: "turn/start", params: {} },
      source: "tell",
    },
  });
  seedEvent(harness.deps, {
    threadId: fixture.thread.id,
    environmentId: fixture.environment.id,
    providerThreadId: "provider-thread-1",
    scope: turnScope("turn-1"),
    sequence: 2,
    type: "turn/started",
    data: {},
  });
  seedEvent(harness.deps, {
    threadId: fixture.thread.id,
    environmentId: fixture.environment.id,
    providerThreadId: "provider-thread-1",
    scope: turnScope("turn-1"),
    sequence: 3,
    type: "item/completed",
    data: {
      item: {
        type: "agentMessage",
        id: "turn-1-assistant",
        text: "Fixed and verified.",
      },
    },
  });
  seedEvent(harness.deps, {
    threadId: fixture.thread.id,
    environmentId: fixture.environment.id,
    providerThreadId: "provider-thread-1",
    scope: turnScope("turn-1"),
    sequence: 4,
    type: "turn/completed",
    data: { status: "completed" },
  });
  return { ...fixture, maxSeq: 4 };
}

async function postRecap(
  harness: TestAppHarness,
  threadId: string,
  body: { force?: boolean } = {},
): Promise<Response> {
  return harness.app.request(`/api/v1/threads/${threadId}/notes/recap`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("public thread recap generation", () => {
  beforeEach(() => {
    piAiMocks.complete.mockReset();
    piAiMocks.getModel.mockReset();
    piAiMocks.getModel.mockReturnValue({ id: "mock-model" });
  });

  it("generates and stores a recap tagged with the thread's sequence", async () => {
    await withTestHarness(async (harness) => {
      const { maxSeq, thread } = seedRecapThread(harness);
      piAiMocks.complete.mockResolvedValue(
        mockRecapCompletion(
          "Usage provider fix is verified.\n\n- Next: open a pull request.",
        ),
      );

      const response = await postRecap(harness, thread.id);
      expect(response.status).toBe(200);
      const notes = threadNotesResponseSchema.parse(await readJson(response));
      // Prose is collapsed to a single line so the stored recap is one
      // paragraph regardless of how the model formatted its answer.
      expect(notes.recapBody).toBe(
        "Usage provider fix is verified. - Next: open a pull request.",
      );
      expect(notes.recapSourceSeq).toBe(maxSeq);
      expect(notes.recapGeneratedAt).not.toBeNull();
    });
  });

  it("returns an already-current recap without paying for inference", async () => {
    await withTestHarness(async (harness) => {
      const { maxSeq, thread } = seedRecapThread(harness);
      setThreadRecap(harness.deps.db, {
        recapBody: "Already current.",
        recapSourceSeq: maxSeq,
        threadId: thread.id,
      });

      const response = await postRecap(harness, thread.id);
      expect(response.status).toBe(200);
      expect(
        threadNotesResponseSchema.parse(await readJson(response)).recapBody,
      ).toBe("Already current.");
      expect(piAiMocks.complete).not.toHaveBeenCalled();
    });
  });

  it("regenerates an already-current recap when forced", async () => {
    await withTestHarness(async (harness) => {
      const { maxSeq, thread } = seedRecapThread(harness);
      setThreadRecap(harness.deps.db, {
        recapBody: "Already current.",
        recapSourceSeq: maxSeq,
        threadId: thread.id,
      });
      piAiMocks.complete.mockResolvedValue(
        mockRecapCompletion("Regenerated. Next: open a pull request."),
      );

      const response = await postRecap(harness, thread.id, { force: true });
      expect(response.status).toBe(200);
      expect(
        threadNotesResponseSchema.parse(await readJson(response)).recapBody,
      ).toBe("Regenerated. Next: open a pull request.");
      expect(piAiMocks.complete).toHaveBeenCalledTimes(1);
    });
  });

  it("leaves an existing recap intact when generation fails", async () => {
    await withTestHarness(async (harness) => {
      const { maxSeq, thread } = seedRecapThread(harness);
      const before = setThreadRecap(harness.deps.db, {
        recapBody: "Previous recap.",
        recapSourceSeq: maxSeq,
        threadId: thread.id,
      });
      piAiMocks.complete.mockRejectedValue(new Error("inference exploded"));

      const response = await postRecap(harness, thread.id, { force: true });
      expect(response.status).toBe(503);

      const after = getThreadNotes(harness.deps.db, thread.id);
      expect(after.recapBody).toBe("Previous recap.");
      expect(after.recapSourceSeq).toBe(before.recapSourceSeq);
      expect(after.recapGeneratedAt).toBe(before.recapGeneratedAt);
    });
  });

  it("leaves an existing recap intact when the model returns nothing usable", async () => {
    await withTestHarness(async (harness) => {
      const { maxSeq, thread } = seedRecapThread(harness);
      setThreadRecap(harness.deps.db, {
        recapBody: "Previous recap.",
        recapSourceSeq: maxSeq,
        threadId: thread.id,
      });
      piAiMocks.complete.mockResolvedValue(mockRecapCompletion("   "));

      const response = await postRecap(harness, thread.id, { force: true });
      expect(response.status).toBe(503);
      expect(getThreadNotes(harness.deps.db, thread.id).recapBody).toBe(
        "Previous recap.",
      );
    });
  });

  it("refuses to recap a thread with no conversation yet", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        environment: { workspaceProvisionType: "personal" },
      });

      const response = await postRecap(harness, thread.id);
      expect(response.status).toBe(409);
      expect(piAiMocks.complete).not.toHaveBeenCalled();
    });
  });

  it("404s for an unknown thread", async () => {
    await withTestHarness(async (harness) => {
      expect((await postRecap(harness, "thr_missing")).status).toBe(404);
    });
  });
});
