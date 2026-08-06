import { getRootComposeRoutePath, getThreadRoutePath } from "@/lib/route-paths";

interface ThreadRouteIdentity {
  id: string;
  projectId: string;
}

export interface ThreadDeleteNavigationTarget {
  path: string;
  replace: boolean;
}

export function resolveThreadDeleteNavigationTarget({
  viewedThreadId,
  deletedThread,
  fallbackThread,
}: {
  viewedThreadId: string | null;
  deletedThread: ThreadRouteIdentity;
  fallbackThread?: ThreadRouteIdentity;
}): ThreadDeleteNavigationTarget | null {
  if (viewedThreadId !== deletedThread.id) return null;
  if (fallbackThread) {
    return {
      path: getThreadRoutePath({
        projectId: fallbackThread.projectId,
        threadId: fallbackThread.id,
      }),
      replace: true,
    };
  }
  return { path: getRootComposeRoutePath(), replace: false };
}
