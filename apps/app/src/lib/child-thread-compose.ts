import type { Thread } from "@bb/domain";
import { getThreadDisplayTitle } from "@/lib/thread-title";

export const CHILD_THREAD_PARENT_LOCATION_STATE_KEY = "childThreadParent";

/** The thread a new-thread draft will be created under. */
export interface ChildThreadParent {
  parentThreadId: string;
  parentThreadTitle: string;
  projectId: string;
}

type ChildThreadParentSource = Pick<
  Thread,
  "archivedAt" | "id" | "projectId" | "title" | "titleFallback"
>;

/** Archived parents are rejected by the server, so do not offer them. */
export function canStartChildThread(thread: ChildThreadParentSource): boolean {
  return thread.archivedAt === null;
}

export function buildChildThreadComposeState(
  thread: ChildThreadParentSource,
): Record<string, unknown> {
  const parent: ChildThreadParent = {
    parentThreadId: thread.id,
    parentThreadTitle: getThreadDisplayTitle(thread),
    projectId: thread.projectId,
  };
  return {
    focusPrompt: true,
    [CHILD_THREAD_PARENT_LOCATION_STATE_KEY]: parent,
  };
}

// react-router's location.state is freeform unknown — narrow it here at the
// system boundary before reading.
export function readChildThreadParentFromLocationState(
  state: unknown,
): ChildThreadParent | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as Record<string, unknown>)[
    CHILD_THREAD_PARENT_LOCATION_STATE_KEY
  ];
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Record<string, unknown>;
  if (
    typeof value.parentThreadId !== "string" ||
    value.parentThreadId.length === 0 ||
    typeof value.parentThreadTitle !== "string" ||
    typeof value.projectId !== "string" ||
    value.projectId.length === 0
  ) {
    return null;
  }
  return {
    parentThreadId: value.parentThreadId,
    parentThreadTitle: value.parentThreadTitle,
    projectId: value.projectId,
  };
}
