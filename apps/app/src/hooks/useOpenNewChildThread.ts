import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { Thread } from "@bb/domain";
import { buildChildThreadComposeState } from "@/lib/child-thread-compose";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";

/** Open the new-thread composer with `thread` preselected as the parent. */
export function useOpenNewChildThread(): (thread: Thread) => void {
  const navigate = useNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  return useCallback(
    (thread: Thread) => {
      // The server requires a child to live in its parent's project.
      setRootComposeProjectId(thread.projectId);
      navigate(getRootComposeRoutePath(), {
        state: buildChildThreadComposeState(thread),
      });
    },
    [navigate, setRootComposeProjectId],
  );
}
