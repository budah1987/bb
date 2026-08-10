import { PERSONAL_PROJECT_ID } from "@bb/domain";

export function filterSidebarThreadsForSpace<
  Thread extends { projectId: string },
>(
  threads: readonly Thread[],
  activeSpaceProjectIds: ReadonlySet<string> | undefined,
): Thread[] {
  if (activeSpaceProjectIds === undefined) return [...threads];
  return threads.filter(
    (thread) =>
      thread.projectId === PERSONAL_PROJECT_ID ||
      activeSpaceProjectIds.has(thread.projectId),
  );
}
