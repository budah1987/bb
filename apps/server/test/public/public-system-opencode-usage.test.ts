import type { OpenCodeUsageReadResult } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const USAGE_RESPONSE: OpenCodeUsageReadResult = {
  status: "ready",
  truncated: false,
  records: [
    {
      day: "2026-08-20",
      modelProviderId: "anthropic",
      model: "claude-sonnet-5",
      loggedCostUsd: 0.0125,
      inputTokens: 100,
      cachedInputTokens: 60,
      cacheWriteTokens: 5,
      outputTokens: 15,
      reasoningTokens: 5,
    },
  ],
};

describe("GET /api/v1/system/experimental-opencode-usage-history", () => {
  it("routes the fixed history read to the selected host daemon", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHostSession(harness.deps, { id: "host-remote" });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.host.id,
        sessionId: host.session.id,
        handle: (request) => {
          if (request.command.type !== "usage.opencode.read") {
            throw new Error(`Unexpected command ${request.command.type}`);
          }
          expect(request.command.databasePath).toBe(
            "/Users/amir/.local/share/opencode/opencode.db",
          );
          expect(request.command.sinceUnixMilliseconds).toBeTypeOf("number");
          return { ok: true, result: USAGE_RESPONSE };
        },
      });

      const response = await harness.app.request(
        "/api/v1/system/experimental-opencode-usage-history?hostId=host-remote&databasePath=%2FUsers%2Famir%2F.local%2Fshare%2Fopencode%2Fopencode.db",
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual(USAGE_RESPONSE);
      expect(responder.requests).toHaveLength(1);
    });
  });
});
