import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { GitParity } from "./contract.js";

/**
 * This is the deliberate boundary for the future host-backed Vault publisher.
 * The plugin owns when publication is allowed. The server and host daemon own
 * Git operations, worktree locks, push, and live-checkout fast-forwarding.
 */
export async function publishMain(
  bb: BbPluginApi,
  request: { environmentId: string; preserveLocalChanges: boolean },
): Promise<GitParity> {
  const result = await bb.sdk.environments.publishToMain({
    environmentId: request.environmentId,
    preserveTargetChanges: request.preserveLocalChanges,
  });
  return {
    state: "published",
    localHead: result.localTargetAfterSha,
    remoteHead: result.remoteTargetAfterSha,
    publishedCommit: result.remoteTargetAfterSha,
    message: "Local Vault and GitHub main match",
  };
}
