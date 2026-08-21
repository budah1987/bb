import { useEffect, useMemo, useState } from "react";
import type { GitHostPullRequestCheck, ThreadPullRequest } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { appToast } from "@/components/ui/app-toast";
import { useRequestEnvironmentAction } from "@/hooks/mutations/environment-mutations";
import { useSendThreadMessage } from "@/hooks/mutations/thread-runtime-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { RailSection } from "./RailSection";

const CHECK_REFRESH_INTERVAL_MS = 3_000;
const CHECK_REFRESH_TIMEOUT_MS = 60_000;

export function isFailedPullRequestCheck(
  check: GitHostPullRequestCheck,
): boolean {
  return (
    check.status === "completed" &&
    check.conclusion !== null &&
    [
      "failure",
      "cancelled",
      "timed_out",
      "action_required",
      "startup_failure",
      "stale",
    ].includes(check.conclusion)
  );
}

export function isRerunnablePullRequestCheck(
  check: GitHostPullRequestCheck,
): boolean {
  if (!isFailedPullRequestCheck(check) || check.url === null) return false;
  try {
    return /\/actions\/runs\/\d+(?:\/|$)/u.test(new URL(check.url).pathname);
  } catch {
    return false;
  }
}

function checkDisplay(
  check: GitHostPullRequestCheck,
  isRerunning: boolean,
): { icon: IconName; label: string; className: string } {
  if (isRerunning) {
    return {
      icon: "Spinner",
      label: "Re-running",
      className: "animate-spin text-warning-text",
    };
  }
  if (check.status === "queued" || check.status === "in_progress") {
    return {
      icon: "Spinner",
      label: check.status === "queued" ? "Queued" : "Running",
      className: "animate-spin text-warning-text",
    };
  }
  if (
    check.conclusion === "success" ||
    check.conclusion === "neutral" ||
    check.conclusion === "skipped"
  ) {
    return {
      icon: "CircleCheck",
      label: check.conclusion === "success" ? "Passed" : "Complete",
      className: "text-success",
    };
  }
  if (isFailedPullRequestCheck(check)) {
    return { icon: "CircleX", label: "Failed", className: "text-destructive" };
  }
  return {
    icon: "AlertTriangle",
    label: "Unknown",
    className: "text-warning-text",
  };
}

export function PullRequestChecksRail({
  environmentId,
  onRefresh,
  pullRequest,
  threadId,
}: {
  environmentId: string;
  onRefresh: () => Promise<unknown>;
  pullRequest: ThreadPullRequest;
  threadId: string;
}) {
  const requestAction = useRequestEnvironmentAction();
  const sendMessage = useSendThreadMessage();
  const [isExpanded, setIsExpanded] = useState(true);
  const [rerunningNames, setRerunningNames] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const failedChecks = useMemo(
    () => pullRequest.checks.items.filter(isFailedPullRequestCheck),
    [pullRequest.checks.items],
  );
  const rerunnableFailedChecks = useMemo(
    () => failedChecks.filter(isRerunnablePullRequestCheck),
    [failedChecks],
  );
  const completedCount =
    pullRequest.checks.passedCount + pullRequest.checks.failedCount;
  const progress =
    pullRequest.checks.totalCount === 0
      ? 0
      : completedCount / pullRequest.checks.totalCount;

  useEffect(() => {
    if (rerunningNames.size === 0) return;
    const interval = window.setInterval(
      () => void onRefresh(),
      CHECK_REFRESH_INTERVAL_MS,
    );
    const timeout = window.setTimeout(
      () => setRerunningNames(new Set()),
      CHECK_REFRESH_TIMEOUT_MS,
    );
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [onRefresh, rerunningNames.size]);

  useEffect(() => {
    setRerunningNames((current) => {
      const next = new Set(
        [...current].filter((name) => {
          const check = pullRequest.checks.items.find(
            (item) => item.name === name,
          );
          return check ? isFailedPullRequestCheck(check) : false;
        }),
      );
      return next.size === current.size ? current : next;
    });
  }, [pullRequest.checks.items]);

  const rerun = async (
    target: { scope: "failed" } | { scope: "check"; checkName: string },
  ) => {
    if (requestAction.isPending) return;
    const names =
      target.scope === "failed"
        ? rerunnableFailedChecks.map((check) => check.name)
        : [target.checkName];
    setRerunningNames((current) => new Set([...current, ...names]));
    const toastId = appToast.loading(
      target.scope === "failed"
        ? "Re-running failed checks"
        : `Re-running ${target.checkName}`,
    );
    try {
      const result = await requestAction.mutateAsync({
        id: environmentId,
        action: "pull_request_checks_rerun",
        options: target,
      });
      if (result.action !== "pull_request_checks_rerun") {
        throw new Error("Expected a pull request check retry response.");
      }
      appToast.success(result.message, { id: toastId });
      await onRefresh();
    } catch (error) {
      setRerunningNames((current) => {
        const next = new Set(current);
        names.forEach((name) => next.delete(name));
        return next;
      });
      appToast.error("Checks were not re-run", {
        id: toastId,
        description: getMutationErrorMessage({
          error,
          fallbackMessage: "Try again from the pull request.",
        }),
      });
    }
  };

  const triage = async (check: GitHostPullRequestCheck) => {
    if (sendMessage.isPending) return;
    const toastId = appToast.loading(`Sending ${check.name} to the agent`);
    try {
      await sendMessage.mutateAsync({
        id: threadId,
        mode: "queue-if-active",
        input: [
          {
            type: "text",
            mentions: [],
            text: [
              `Investigate and fix the failing CI check "${check.name}" for pull request #${pullRequest.number}.`,
              check.url ? `Check details: ${check.url}` : null,
              "Use the GitHub CLI to inspect the failing run and logs.",
              "Make the smallest safe fix, run the relevant local checks, and report what changed.",
            ]
              .filter((line): line is string => line !== null)
              .join("\n"),
          },
        ],
      });
      appToast.success(`${check.name} sent to the agent`, { id: toastId });
    } catch (error) {
      appToast.error("Check was not sent to the agent", {
        id: toastId,
        description: getMutationErrorMessage({
          error,
          fallbackMessage: "Try again.",
        }),
      });
    }
  };

  if (pullRequest.checks.items.length === 0) {
    return (
      <RailSection
        isExpanded={isExpanded}
        label="Checks"
        onToggle={() => setIsExpanded((current) => !current)}
        trailing={
          <span className="text-xs tabular-nums text-muted-foreground">
            0 of 0 complete
          </span>
        }
      >
        <p className="px-2 py-1 text-xs text-muted-foreground">
          No checks configured.
        </p>
      </RailSection>
    );
  }

  return (
    <RailSection
      isExpanded={isExpanded}
      label="Checks"
      onToggle={() => setIsExpanded((current) => !current)}
      trailing={
        <span className="text-xs tabular-nums text-muted-foreground">
          {completedCount} of {pullRequest.checks.totalCount} complete
        </span>
      }
    >
      <div className="flex min-w-0 flex-col gap-1 py-1">
        <div
          role="progressbar"
          aria-label="Pull request checks"
          aria-valuemin={0}
          aria-valuemax={pullRequest.checks.totalCount}
          aria-valuenow={completedCount}
          className="mx-2 h-1 overflow-hidden rounded-full bg-border-hairline"
        >
          <div
            className="h-full origin-left rounded-full bg-foreground/55 transition-transform duration-300 ease-[var(--resize-ease)] motion-reduce:transition-none"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
        {rerunnableFailedChecks.length > 1 ? (
          <div className="flex justify-end px-1 py-0.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-9 px-2 text-xs"
              disabled={requestAction.isPending}
              onClick={() => void rerun({ scope: "failed" })}
            >
              Re-run all failed
            </Button>
          </div>
        ) : null}
        <ul
          className="flex min-w-0 flex-col"
          aria-label="Pull request check results"
        >
          {pullRequest.checks.items.map((check, index) => {
            const display = checkDisplay(check, rerunningNames.has(check.name));
            const failed = isFailedPullRequestCheck(check);
            return (
              <li
                key={`${check.name}:${index}`}
                className="flex min-w-0 flex-col gap-1.5 rounded-md px-2 py-1.5 hover:bg-state-hover"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Icon
                    name={display.icon}
                    className={cn("size-3.5", display.className)}
                    aria-hidden
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-xs text-foreground"
                    title={check.name}
                  >
                    {check.name}
                  </span>
                  <span
                    className={cn(
                      "text-xs",
                      display.className.replace("animate-spin ", ""),
                    )}
                  >
                    {display.label}
                  </span>
                </div>
                {failed ? (
                  <div className="flex justify-end gap-1 pl-5">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-9 px-2 text-xs"
                      disabled={sendMessage.isPending}
                      onClick={() => void triage(check)}
                    >
                      Triage
                    </Button>
                    {isRerunnablePullRequestCheck(check) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="min-h-9 px-2 text-xs"
                        disabled={
                          requestAction.isPending ||
                          rerunningNames.has(check.name)
                        }
                        onClick={() =>
                          void rerun({ scope: "check", checkName: check.name })
                        }
                      >
                        Re-run
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </RailSection>
  );
}
