import type { OpenCodeUsageReadResult } from "@bb/host-daemon-contract";
import type { SystemExperimentalOpenCodeUsageHistoryQuery } from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { AppDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { assertUsableHostId } from "../hosts/primary-host.js";

const USAGE_HISTORY_RETENTION_DAYS = 365;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

/**
 * Product policy for OpenCode history lives here: retain the last year of
 * aggregate usage. The daemon only reads the local SQLite database with its
 * fixed query and returns raw aggregates; it never creates a shell or PTY.
 */
export async function getExperimentalOpenCodeUsageHistory(
  deps: AppDeps,
  query: SystemExperimentalOpenCodeUsageHistoryQuery,
): Promise<OpenCodeUsageReadResult> {
  assertUsableHostId(deps, { hostId: query.hostId });
  return callHostRetryableOnlineRpc(deps, {
    hostId: query.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "usage.opencode.read",
      databasePath: query.databasePath,
      sinceUnixMilliseconds:
        Date.now() - USAGE_HISTORY_RETENTION_DAYS * MILLISECONDS_PER_DAY,
    },
  });
}
