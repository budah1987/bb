import { PERSONAL_PROJECT_ID } from "@bb/domain";

export function filterSidebarThreadsForSpace<
  Thread extends { id: string; projectId: string },
>(
  threads: readonly Thread[],
  activeSpaceProjectIds: ReadonlySet<string> | undefined,
  globalPinnedThreadIds: ReadonlySet<string>,
): Thread[] {
  return threads.filter(
    (thread) =>
      thread.projectId === PERSONAL_PROJECT_ID ||
      activeSpaceProjectIds === undefined ||
      activeSpaceProjectIds.has(thread.projectId) ||
      globalPinnedThreadIds.has(thread.id),
  );
}
