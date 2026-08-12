import type { ThreadRuntimeDisplayStatus } from "@bb/domain";
import type {
  TimelineRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";

interface ResolveThreadProgressLabelArgs {
  activeThinking: boolean;
  displayStatus: ThreadRuntimeDisplayStatus;
  isTurnSubmitting: boolean;
  rows: readonly TimelineRow[];
}

function collectTimelineProgress(rows: readonly TimelineRow[]): {
  latestRequest: TimelineUserConversationRow | null;
  pendingWork: boolean;
} {
  let latestRequest: TimelineUserConversationRow | null = null;
  let pendingWork = false;
  const visit = (row: TimelineRow): void => {
    if (
      row.kind === "conversation" &&
      row.role === "user" &&
      (latestRequest === null || row.sourceSeqEnd > latestRequest.sourceSeqEnd)
    ) {
      latestRequest = row;
    }
    if (row.kind === "work" && row.status === "pending") pendingWork = true;
    if (row.kind === "turn" && row.children) {
      for (const child of row.children) visit(child);
    }
  };
  for (const row of rows) visit(row);
  return { latestRequest, pendingWork };
}

export function resolveThreadProgressLabel({
  activeThinking,
  displayStatus,
  isTurnSubmitting,
  rows,
}: ResolveThreadProgressLabelArgs): string | undefined {
  if (isTurnSubmitting) return "Waiting in BB...";
  if (displayStatus === "provisioning" || displayStatus === "starting") {
    return "Starting provider...";
  }
  const progress = collectTimelineProgress(rows);
  if (progress.latestRequest?.turnRequest.status === "pending") {
    return "Waiting for provider...";
  }
  if (progress.pendingWork) return "Using tool...";
  if (activeThinking) return undefined;
  if (
    displayStatus === "active" &&
    progress.latestRequest?.turnRequest.status === "accepted"
  ) {
    return "Reasoning...";
  }
  return undefined;
}
