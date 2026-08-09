import { useCallback, useMemo, useState } from "react";
import type { EnvironmentPreviewProvider } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import { useEnvironmentPreviews } from "@/hooks/queries/environment-queries";
import { useThread } from "@/hooks/queries/thread-queries";
import { useOpenFixedPreviewPanel } from "@/lib/fixed-panel-tabs";
import {
  resolvePreviewProviderStatus,
  summarizePreviewProviders,
} from "@/lib/preview-provider-status";
import { statusTierClassName } from "@/lib/status-tier";
import { RailRow } from "./RailRow";
import { RailSection } from "./RailSection";
import { RAIL_BODY_TEXT_CLASS, RAIL_PROSE_CLASS } from "./railStyleTokens";

function PreviewRow({
  now,
  onOpen,
  provider,
}: {
  now: number;
  onOpen: (provider: EnvironmentPreviewProvider) => void;
  provider: EnvironmentPreviewProvider;
}) {
  const status = resolvePreviewProviderStatus({ now, provider });
  const handleOpen = useCallback(() => onOpen(provider), [onOpen, provider]);

  return (
    <div className="min-w-0">
      <RailRow
        icon={provider.kind === "local" ? "Browser" : "Globe"}
        label={provider.label}
        onSelect={handleOpen}
        showsChevron
        trailing={
          <span
            className={cn("shrink-0 text-xs", statusTierClassName(status.tier))}
          >
            {status.label}
          </span>
        }
      />
      {provider.state === "failed" && provider.logUrl !== null ? (
        <div className="flex min-w-0 items-center gap-2 px-2 pb-1 pl-8 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">Build failed</span>
          <a
            href={provider.logUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 text-destructive underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            Open logs
          </a>
        </div>
      ) : null}
    </div>
  );
}

export interface PreviewSectionProps {
  threadId: string;
}

/**
 * Every way to look at what this environment is building — the local server and
 * any deployments — in one list. A local provider without a shared address
 * remains visible because that missing address is useful state.
 */
export function PreviewSection({ threadId }: PreviewSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const threadQuery = useThread(threadId);
  const environmentId = threadQuery.data?.environmentId;
  const previewsQuery = useEnvironmentPreviews(environmentId);
  const openPreviewPanel = useOpenFixedPreviewPanel(threadId, threadId);

  const providers = useMemo(
    () => previewsQuery.data?.providers ?? [],
    [previewsQuery.data?.providers],
  );
  // A build's age is measured from the moment we heard about it, not from
  // whenever React last re-rendered. That keeps the label honest and the
  // component pure.
  const now = previewsQuery.dataUpdatedAt;

  const isLoading = threadQuery.isLoading || previewsQuery.isLoading;
  const summary = summarizePreviewProviders({ isLoading, providers });

  const openProvider = useCallback(
    (provider: EnvironmentPreviewProvider) => {
      openPreviewPanel({
        environmentId: environmentId ?? null,
        label: provider.label,
        providerId: provider.id,
      });
    },
    [environmentId, openPreviewPanel],
  );
  const retry = useCallback(() => {
    void previewsQuery.refetch();
  }, [previewsQuery]);

  return (
    <RailSection
      isExpanded={isExpanded}
      label="Preview"
      onToggle={() => setIsExpanded((current) => !current)}
      trailing={
        <span
          className={cn("shrink-0 text-xs", statusTierClassName(summary.tier))}
        >
          {summary.label}
        </span>
      }
    >
      {previewsQuery.isError ? (
        <div
          role="alert"
          className={cn(
            RAIL_BODY_TEXT_CLASS,
            "flex items-center gap-2 py-1 text-destructive",
          )}
        >
          <span className="min-w-0 flex-1">Could not load previews.</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-xs"
            onClick={retry}
          >
            Retry
          </Button>
        </div>
      ) : isLoading ? (
        <p className={cn(RAIL_PROSE_CLASS, "py-1")}>Loading previews…</p>
      ) : (
        <div className="flex min-w-0 flex-col">
          {providers.map((provider) => (
            <PreviewRow
              key={provider.id}
              now={now}
              onOpen={openProvider}
              provider={provider}
            />
          ))}
          {providers.length === 0 ? (
            <p className={cn(RAIL_PROSE_CLASS, "py-1")}>No previews.</p>
          ) : null}
          {(previewsQuery.data?.issues ?? []).map((issue) => (
            <div
              key={`${issue.source}:${issue.message}`}
              role="alert"
              className="flex items-center gap-2 py-1 text-xs text-destructive"
            >
              <span className="min-w-0 flex-1 truncate" title={issue.message}>
                {issue.message}
              </span>
              <button
                type="button"
                className="shrink-0 underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={retry}
              >
                Retry
              </button>
            </div>
          ))}
        </div>
      )}
    </RailSection>
  );
}
