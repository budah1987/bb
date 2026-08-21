import { describe, expect, it } from "vitest";
import { parseCodex, parseOpenCode } from "./collectors.js";
import { parseUsageSummaryArguments } from "./server.js";

const context = { machineId: "host-1", machineName: "MacBook" };

describe("usage collectors", () => {
  it("extracts Codex token counts without retaining conversation text", () => {
    const records = parseCodex(`${JSON.stringify({
      type: "session_meta",
      timestamp: "2026-08-20T12:00:00.000Z",
      payload: { id: "session-1" },
    })}\n${JSON.stringify({
      type: "turn_context",
      timestamp: "2026-08-20T12:01:00.000Z",
      payload: { model: "gpt-5" },
    })}\n${JSON.stringify({
      type: "event_msg",
      timestamp: "2026-08-20T12:02:00.000Z",
      payload: {
        type: "token_count",
        message: "private conversation content",
        info: { last_token_usage: {
          input_tokens: 100, cached_input_tokens: 40,
          cache_write_input_tokens: 10, output_tokens: 20,
        } },
      },
    })}\n`, context);

    expect(records).toEqual([expect.objectContaining({
      agentId: "codex",
      model: "gpt-5",
      uncachedInputTokens: 60,
      cachedInputTokens: 40,
      cacheWriteTokens: 10,
      outputTokens: 20,
      processedTokens: 130,
    })]);
    expect(JSON.stringify(records)).not.toContain("private conversation content");
  });

  it("maps the read-only OpenCode aggregate to a single daily record", () => {
    const records = parseOpenCode([{
      day: "2026-08-20",
      modelProviderId: "openai",
      model: "gpt-5",
      loggedCostUsd: 1.25,
      inputTokens: 100,
      cachedInputTokens: 25,
      cacheWriteTokens: 10,
      outputTokens: 20,
      reasoningTokens: 30,
    }], context);

    expect(records).toEqual([expect.objectContaining({
      agentId: "opencode",
      day: "2026-08-20",
      uncachedInputTokens: 75,
      cachedInputTokens: 25,
      outputTokens: 50,
      processedTokens: 160,
    })]);
  });

  it("parses the agent-facing usage summary filters", () => {
    expect(parseUsageSummaryArguments([
      "summary", "--days", "90", "--machine", "host-1", "--json",
    ])).toEqual({ days: 90, machineId: "host-1", json: true });
    expect(() => parseUsageSummaryArguments(["summary", "--days", "0"])).toThrow(
      "--days must be a whole number from 1 through 365.",
    );
  });
});
