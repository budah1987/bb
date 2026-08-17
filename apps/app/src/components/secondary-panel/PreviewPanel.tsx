import { useCallback, useState } from "react";
import type { EnvironmentPreviewProvider } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { cn } from "@bb/shared-ui/lib/utils";
import { useEnvironmentPreviews } from "@/hooks/queries/environment-queries";
import {
  canFramePreviewProvider,
  resolvePreviewProviderStatus,
} from "@/lib/preview-provider-status";
import { statusTierClassName } from "@/lib/status-tier";
import {
  useBypassEnvironmentPreviewProtection,
  useShareEnvironmentPreviewPort,
  useUnshareEnvironmentPreviewPort,
} from "@/hooks/mutations/environment-mutations";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { appToast } from "@/components/ui/app-toast";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

/**
 * Everything a preview needs to be useful, minus the one capability that would
 * let a remote page take the tab: `allow-top-navigation` is deliberately not
 * granted. Deployment previews are arbitrary remote origins.
 */
const PREVIEW_IFRAME_SANDBOX =
  "allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts";

function PreviewMessage({
  actionHref,
  children,
  isDestructive = false,
  onRetry,
}: {
  actionHref?: string | null;
  children: string;
  isDestructive?: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role={isDestructive ? "alert" : undefined}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center"
    >
      <p
        className={cn(
          "text-sm",
          isDestructive ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {children}
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
        {actionHref ? (
          <Button size="sm" variant="outline" asChild>
            <a href={actionHref} target="_blank" rel="noreferrer noopener">
              Open logs
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PreviewToolbar({
  now,
  onBypass,
  onCopy,
  onReload,
  onShare,
  onUnshare,
  provider,
}: {
  /** When the provider list was fetched; a build's age is measured from there. */
  now: number;
  onBypass: () => void;
  onCopy: () => void;
  onReload: () => void;
  onShare: () => void;
  onUnshare: () => void;
  provider: EnvironmentPreviewProvider;
}) {
  const status = resolvePreviewProviderStatus({ now, provider });
  const deploymentUrl = provider.deploymentUrl;
  return (
    <div className="border-b border-border-hairline">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Reload preview"
          onClick={onReload}
        >
          <Icon name="ArrowReloadHorizontal" aria-hidden className="size-4" />
        </Button>
        {/*
          The address is shown, not offered: a preview points at a URL the
          environment chose, so editing it here would just be a browser bar
          without a browser behind it.
        */}
        <Input
          readOnly
          aria-label="Preview address"
          value={provider.url ?? ""}
          placeholder="No preview address yet"
          className="h-7 min-w-0 flex-1 text-xs"
        />
        <span
          className={cn("shrink-0 text-xs", statusTierClassName(status.tier))}
        >
          {status.label}
        </span>
        {provider.url === null ? null : (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Copy preview address"
              onClick={onCopy}
            >
              <Icon name="Copy" aria-hidden className="size-4" />
            </Button>
            <a
              href={provider.url}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Open in browser"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Icon name="ExternalLink" aria-hidden className="size-4" />
            </a>
          </>
        )}
        {provider.kind === "local" && provider.port !== null ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs active:scale-[0.96]"
            onClick={provider.shared ? onUnshare : onShare}
          >
            {provider.shared ? "Unshare" : "Share"}
          </Button>
        ) : null}
        {provider.source === "github" &&
        provider.url?.includes(".vercel.app") ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs active:scale-[0.96]"
            onClick={onBypass}
          >
            Bypass
          </Button>
        ) : null}
      </div>
      {provider.branchUrl !== null &&
      deploymentUrl !== null &&
      provider.branchUrl !== deploymentUrl ? (
        <div className="flex min-w-0 items-center gap-2 border-t border-border-hairline px-3 py-1.5">
          <span className="shrink-0 text-xs text-muted-foreground">
            Current deployment
          </span>
          <Input
            readOnly
            aria-label="Current deployment address"
            value={deploymentUrl}
            className="h-7 min-w-0 flex-1 text-xs"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Copy current deployment address"
            onClick={() =>
              void copyToClipboardWithToast(deploymentUrl, {
                successMessage: "Current deployment URL copied",
              })
            }
          >
            <Icon name="Copy" aria-hidden className="size-4" />
          </Button>
          <a
            href={deploymentUrl}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open current deployment in browser"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon name="ExternalLink" aria-hidden className="size-4" />
          </a>
        </div>
      ) : null}
    </div>
  );
}

export interface PreviewPanelProps {
  environmentId: string | null;
  /** The provider's name when the tab was opened; used until the query answers. */
  label: string;
  providerId: string;
}

/**
 * One preview provider, framed. The frame appears only once the provider says
 * it is ready and does not say framing is blocked — a blank iframe over a
 * still-building deployment reads as a broken app, so the panel says what is
 * happening instead.
 */
export function PreviewPanel({
  environmentId,
  label,
  providerId,
}: PreviewPanelProps) {
  const previewsQuery = useEnvironmentPreviews(environmentId);
  // Bumping the key remounts the frame, which reloads cross-origin content the
  // panel is not allowed to reach into and call `location.reload()` on.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [isBypassDialogOpen, setIsBypassDialogOpen] = useState(false);
  const [bypassSecret, setBypassSecret] = useState("");
  const sharePort = useShareEnvironmentPreviewPort();
  const unsharePort = useUnshareEnvironmentPreviewPort();
  const bypassProtection = useBypassEnvironmentPreviewProtection();
  const reload = useCallback(() => {
    setReloadNonce((current) => current + 1);
  }, []);
  const retry = useCallback(() => {
    void previewsQuery.refetch();
    reload();
  }, [previewsQuery, reload]);

  if (previewsQuery.isLoading) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">
        Loading {label}…
      </div>
    );
  }

  if (previewsQuery.isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PreviewMessage isDestructive onRetry={retry}>
          Could not load previews.
        </PreviewMessage>
      </div>
    );
  }

  const provider = previewsQuery.data?.providers.find(
    (candidate) => candidate.id === providerId,
  );
  if (provider === undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PreviewMessage onRetry={retry}>
          {`${label} is no longer available.`}
        </PreviewMessage>
      </div>
    );
  }

  const share = async () => {
    if (environmentId === null || provider.port === null) return;
    try {
      const result = await sharePort.mutateAsync({
        environmentId,
        port: provider.port,
      });
      await copyToClipboardWithToast(result.url, {
        successMessage: "Shared URL copied",
      });
    } catch (error) {
      appToast.error("Could not share this preview", {
        description: getMutationErrorMessage({
          error,
          fallbackMessage: "Try again.",
        }),
      });
    }
  };
  const unshare = async () => {
    if (environmentId === null || provider.port === null) return;
    try {
      await unsharePort.mutateAsync({
        environmentId,
        port: provider.port,
      });
      appToast.success("Preview sharing stopped");
    } catch (error) {
      appToast.error("Could not stop sharing", {
        description: getMutationErrorMessage({
          error,
          fallbackMessage: "Try again.",
        }),
      });
    }
  };
  const openBypassedPreview = async () => {
    if (environmentId === null || !bypassSecret.trim()) return;
    try {
      const result = await bypassProtection.mutateAsync({
        environmentId,
        providerId: provider.id,
        secret: bypassSecret.trim(),
      });
      setBypassSecret("");
      setIsBypassDialogOpen(false);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      appToast.error("Could not open the protected preview", {
        description: getMutationErrorMessage({
          error,
          fallbackMessage: "Check the bypass secret.",
        }),
      });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PreviewToolbar
        now={previewsQuery.dataUpdatedAt}
        onBypass={() => setIsBypassDialogOpen(true)}
        onCopy={() => {
          if (provider.url !== null) {
            void copyToClipboardWithToast(provider.url, {
              successMessage: "Preview URL copied",
            });
          }
        }}
        onReload={reload}
        onShare={() => void share()}
        onUnshare={() => void unshare()}
        provider={provider}
      />
      {canFramePreviewProvider(provider) && provider.url !== null ? (
        <iframe
          key={reloadNonce}
          title={provider.label}
          src={provider.url}
          sandbox={PREVIEW_IFRAME_SANDBOX}
          className="min-h-0 w-full flex-1 border-0 bg-canvas"
        />
      ) : (
        <PreviewMessage
          actionHref={provider.state === "failed" ? provider.logUrl : null}
          isDestructive={provider.state === "failed"}
          onRetry={retry}
        >
          {resolveUnframedMessage(provider)}
        </PreviewMessage>
      )}
      <Dialog open={isBypassDialogOpen} onOpenChange={setIsBypassDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open protected Vercel preview</DialogTitle>
            <DialogDescription>
              BB uses this secret once. The secret is not saved.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoComplete="off"
            aria-label="Vercel protection bypass secret"
            value={bypassSecret}
            onChange={(event) => setBypassSecret(event.target.value)}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsBypassDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!bypassSecret.trim() || bypassProtection.isPending}
              onClick={() => void openBypassedPreview()}
            >
              {bypassProtection.isPending ? "Opening…" : "Open preview"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function resolveUnframedMessage(provider: EnvironmentPreviewProvider): string {
  if (provider.state === "building") {
    return "This preview is still building.";
  }
  if (provider.state === "failed") {
    return "This preview failed to build.";
  }
  if (provider.url === null) {
    return provider.frameReason ?? "This preview has no address yet.";
  }
  if (provider.framePolicy === "blocked") {
    return (
      provider.frameReason ??
      "This preview refuses to be shown inside another page. Open it in a browser."
    );
  }
  return "This preview is not ready yet.";
}
