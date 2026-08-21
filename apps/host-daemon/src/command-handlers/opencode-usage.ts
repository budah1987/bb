import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  HostDaemonOnlineRpcResult,
  OpenCodeUsageRecord,
} from "@bb/host-daemon-contract";
import { z } from "zod";
import { CommandDispatchError } from "../command-dispatch-support.js";
import type { CommandOf } from "../command-dispatch-support.js";
import { isFsErrorWithCode } from "../fs-errors.js";

const OPEN_CODE_USAGE_RESULT_LIMIT = 5_000;

const OPEN_CODE_USAGE_QUERY = `
SELECT
  date(time_created / 1000, 'unixepoch') AS day,
  COALESCE(json_extract(data, '$.providerID'), 'unknown') AS modelProviderId,
  COALESCE(json_extract(data, '$.modelID'), 'unknown') AS model,
  ROUND(SUM(COALESCE(json_extract(data, '$.cost'), 0)), 9) AS loggedCostUsd,
  CAST(SUM(COALESCE(json_extract(data, '$.tokens.input'), 0)) AS INTEGER) AS inputTokens,
  CAST(SUM(COALESCE(json_extract(data, '$.tokens.cache.read'), 0)) AS INTEGER) AS cachedInputTokens,
  CAST(SUM(COALESCE(json_extract(data, '$.tokens.cache.write'), 0)) AS INTEGER) AS cacheWriteTokens,
  CAST(SUM(COALESCE(json_extract(data, '$.tokens.output'), 0)) AS INTEGER) AS outputTokens,
  CAST(SUM(COALESCE(json_extract(data, '$.tokens.reasoning'), 0)) AS INTEGER) AS reasoningTokens
FROM message
WHERE json_extract(data, '$.role') = 'assistant'
  AND time_created >= ?
GROUP BY day, modelProviderId, model
ORDER BY day, modelProviderId, model
LIMIT ?`;

const openCodeUsageQueryRowSchema = z.object({
  day: z.string(),
  modelProviderId: z.string(),
  model: z.string(),
  loggedCostUsd: z.number(),
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  cacheWriteTokens: z.number(),
  outputTokens: z.number(),
  reasoningTokens: z.number(),
});
type OpenCodeUsageQueryRow = z.infer<typeof openCodeUsageQueryRowSchema>;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_024) || "OpenCode usage could not be read.";
}

function nonnegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function nonnegativeNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeRecord(row: OpenCodeUsageQueryRow): OpenCodeUsageRecord {
  return {
    day: row.day,
    modelProviderId: row.modelProviderId || "unknown",
    model: row.model || "unknown",
    loggedCostUsd: nonnegativeNumber(row.loggedCostUsd),
    inputTokens: nonnegativeInteger(row.inputTokens),
    cachedInputTokens: nonnegativeInteger(row.cachedInputTokens),
    cacheWriteTokens: nonnegativeInteger(row.cacheWriteTokens),
    outputTokens: nonnegativeInteger(row.outputTokens),
    reasoningTokens: nonnegativeInteger(row.reasoningTokens),
  };
}

/**
 * Read OpenCode's local database without ever starting a shell or terminal.
 * The query is fixed here, both to preserve the daemon's host-local boundary
 * and to keep a plugin from treating BB's terminal API as a process runner.
 */
export async function readOpenCodeUsage(
  command: CommandOf<"usage.opencode.read">,
): Promise<HostDaemonOnlineRpcResult<"usage.opencode.read">> {
  if (!path.isAbsolute(command.databasePath)) {
    throw new CommandDispatchError(
      "invalid_path",
      "OpenCode database path must be absolute",
    );
  }

  try {
    const stat = await fs.stat(command.databasePath);
    if (!stat.isFile()) {
      return {
        status: "unavailable",
        message: "OpenCode database path is not a file.",
      };
    }
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return { status: "missing" };
    }
    return { status: "unavailable", message: errorMessage(error) };
  }

  let database: Database.Database | null = null;
  try {
    database = new Database(command.databasePath, {
      readonly: true,
      fileMustExist: true,
      timeout: 1_000,
    });
    const rows = z.array(openCodeUsageQueryRowSchema).parse(
      database.prepare(OPEN_CODE_USAGE_QUERY).all(
        command.sinceUnixMilliseconds,
        OPEN_CODE_USAGE_RESULT_LIMIT + 1,
      ),
    );
    const truncated = rows.length > OPEN_CODE_USAGE_RESULT_LIMIT;
    return {
      status: "ready",
      records: rows.slice(0, OPEN_CODE_USAGE_RESULT_LIMIT).map(normalizeRecord),
      truncated,
    };
  } catch (error) {
    return { status: "unavailable", message: errorMessage(error) };
  } finally {
    database?.close();
  }
}
