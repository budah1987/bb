import type { ThreadListEntry } from "@bb/domain";
import {
  resolveThreadListIndicator,
  threadListIndicatorStateForThread,
  type ThreadListIndicatorKind,
} from "@bb/client-core";

const RUNNING_INDICATORS: ReadonlySet<ThreadListIndicatorKind> = new Set([
  "waiting-for-input",
  "working-draft",
  "plan-mode",
  "goal",
  "runtime",
  "workflow",
  "background-agent",
  "background-command",
  "queued-waiting",
]);

export interface ThreadDetailsLineageChild {
  thread: ThreadListEntry;
  indicator: ThreadListIndicatorKind;
}

export interface ThreadDetailsLineage {
  running: ThreadDetailsLineageChild[];
  previous: ThreadDetailsLineageChild[];
  previousFailedCount: number;
}

export function partitionThreadDetailsLineage(
  children: readonly ThreadListEntry[],
): ThreadDetailsLineage {
  const running: ThreadDetailsLineageChild[] = [];
  const previous: ThreadDetailsLineageChild[] = [];
  let previousFailedCount = 0;
  const ordered = [...children].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const thread of ordered) {
    const indicator = resolveThreadListIndicator(
      threadListIndicatorStateForThread(thread, false),
    );
    if (RUNNING_INDICATORS.has(indicator)) {
      running.push({ thread, indicator });
      continue;
    }
    previous.push({ thread, indicator });
    if (thread.status === "error" || indicator === "queued-failed") {
      previousFailedCount += 1;
    }
  }
  return { running, previous, previousFailedCount };
}
