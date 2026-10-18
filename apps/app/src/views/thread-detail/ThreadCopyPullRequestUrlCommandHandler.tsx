import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { usePaneContext } from "./PaneContext";

export function ThreadCopyPullRequestUrlCommandHandler({
  url,
}: {
  url: string | null;
}) {
  const { isFocused } = usePaneContext();

  useAppCommandHandler("thread.copyPullRequestUrl", () => {
    if (!isFocused || !url) return false;
    void copyToClipboardWithToast(url, {
      successMessage: "Pull request URL copied",
      errorMessage: "Failed to copy pull request URL",
    });
    return true;
  });

  return null;
}
