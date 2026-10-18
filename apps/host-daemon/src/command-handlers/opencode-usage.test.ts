import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { readOpenCodeUsage } from "./opencode-usage.js";

const temporaryDirectories: string[] = [];

async function createDatabase(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bb-opencode-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "opencode.db");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("readOpenCodeUsage", () => {
  it("reads bounded aggregates with a fixed non-PTY SQLite query", async () => {
    const databasePath = await createDatabase();
    const database = new Database(databasePath);
    database.exec("CREATE TABLE message (time_created INTEGER, data TEXT)");
    database
      .prepare("INSERT INTO message (time_created, data) VALUES (?, ?)")
      .run(
        Date.UTC(2026, 7, 20),
        JSON.stringify({
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-sonnet-5",
          cost: 0.0125,
          tokens: {
            input: 100,
            cache: { read: 60, write: 5 },
            output: 15,
            reasoning: 5,
          },
        }),
      );
    database.close();

    await expect(
      readOpenCodeUsage({
        type: "usage.opencode.read",
        databasePath,
        sinceUnixMilliseconds: Date.UTC(2026, 7, 1),
      }),
    ).resolves.toEqual({
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
    });
  });

  it("reports an absent database without treating it as a daemon failure", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bb-opencode-"));
    temporaryDirectories.push(directory);

    await expect(
      readOpenCodeUsage({
        type: "usage.opencode.read",
        databasePath: path.join(directory, "missing.db"),
        sinceUnixMilliseconds: 0,
      }),
    ).resolves.toEqual({ status: "missing" });
  });
});
