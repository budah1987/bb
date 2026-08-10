import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appToast } from "@/components/ui/app-toast";
import { useArchiveEnvironmentThreads } from "@/hooks/mutations/environment-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { getProjectComposeRoutePath } from "@/lib/route-paths";

interface UsePullRequestArchiveActionArgs {
  environmentId: string | null | undefined;
  projectId: string;
}

export function usePullRequestArchiveAction({
  environmentId,
  projectId,
}: UsePullRequestArchiveActionArgs) {
  const navigate = useNavigate();
  const archiveEnvironmentThreads = useArchiveEnvironmentThreads();
  const [error, setError] = useState<{
    environmentId: string;
    message: string;
  } | null>(null);

  const archive = useCallback(async () => {
    if (!environmentId || archiveEnvironmentThreads.isPending) return;

    setError(null);
    const toastId = appToast.loading("Archiving workspace");
    try {
      const response = await archiveEnvironmentThreads.mutateAsync({
        id: environmentId,
      });
      appToast.success(
        `Archived ${response.archivedThreadIds.length} thread${response.archivedThreadIds.length === 1 ? "" : "s"}`,
        { id: toastId },
      );
      navigate(getProjectComposeRoutePath(projectId));
    } catch (error) {
      const message = getMutationErrorMessage({
        error,
        fallbackMessage: "The workspace was not archived. Try again.",
      });
      setError({ environmentId, message });
      appToast.error("Failed to archive workspace", {
        id: toastId,
        description: message,
      });
    }
  }, [archiveEnvironmentThreads, environmentId, navigate, projectId]);

  return {
    archive,
    errorMessage:
      error !== null && error.environmentId === environmentId
        ? error.message
        : null,
    isPending: archiveEnvironmentThreads.isPending,
  };
}
