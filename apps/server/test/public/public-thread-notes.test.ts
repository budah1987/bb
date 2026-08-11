import {
  THREAD_SCRATCHPAD_MAX_LENGTH,
  threadNotesResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function getNotes(
  harness: TestAppHarness,
  threadId: string,
): Promise<Response> {
  return harness.app.request(`/api/v1/threads/${threadId}/notes`);
}

async function putScratchpad(
  harness: TestAppHarness,
  threadId: string,
  scratchpad: string,
): Promise<Response> {
  return harness.app.request(`/api/v1/threads/${threadId}/notes/scratchpad`, {
    body: JSON.stringify({ scratchpad }),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

describe("public thread notes", () => {
  it("reads an untouched thread as an empty scratchpad with no recap", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);

      const response = await getNotes(harness, thread.id);
      expect(response.status).toBe(200);
      expect(threadNotesResponseSchema.parse(await readJson(response))).toEqual(
        {
          recapBody: null,
          recapEnabled: false,
          recapGeneratedAt: null,
          recapSourceSeq: null,
          scratchpad: "",
        },
      );
    });
  });

  it("round-trips a scratchpad and allows clearing it", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);

      const written = await putScratchpad(
        harness,
        thread.id,
        "check token scope",
      );
      expect(written.status).toBe(200);
      expect(
        threadNotesResponseSchema.parse(await readJson(written)).scratchpad,
      ).toBe("check token scope");

      const cleared = await putScratchpad(harness, thread.id, "");
      expect(
        threadNotesResponseSchema.parse(await readJson(cleared)).scratchpad,
      ).toBe("");
    });
  });

  it("enforces the length cap at the boundary, not just in the UI", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);

      const atLimit = await putScratchpad(
        harness,
        thread.id,
        "a".repeat(THREAD_SCRATCHPAD_MAX_LENGTH),
      );
      expect(atLimit.status).toBe(200);

      const overLimit = await putScratchpad(
        harness,
        thread.id,
        "a".repeat(THREAD_SCRATCHPAD_MAX_LENGTH + 1),
      );
      expect(overLimit.status).toBe(400);

      // The rejected write must not have partially applied.
      const after = await getNotes(harness, thread.id);
      expect(
        threadNotesResponseSchema.parse(await readJson(after)).scratchpad,
      ).toBe("a".repeat(THREAD_SCRATCHPAD_MAX_LENGTH));
    });
  });

  it("404s for an unknown thread instead of creating notes for it", async () => {
    await withTestHarness(async (harness) => {
      expect((await getNotes(harness, "thr_missing")).status).toBe(404);
      expect((await putScratchpad(harness, "thr_missing", "x")).status).toBe(
        404,
      );
    });
  });
});
