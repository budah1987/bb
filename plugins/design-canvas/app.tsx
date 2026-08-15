import { useEffect, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginMessageDirectiveProps,
} from "@get-bb/plugin-sdk/app";
import type { PreviewMetadata, rpcContract } from "./server";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";

const previewIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function previewUrl(id: string, download = false): string {
  const query = new URLSearchParams({ id });
  if (download) query.set("download", "1");
  return `/api/v1/plugins/design-canvas/http/preview?${query.toString()}`;
}

function currentReturnPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function viewerUrl(id: string): string {
  const query = new URLSearchParams({ id, returnTo: currentReturnPath() });
  return `/api/v1/plugins/design-canvas/http/viewer?${query.toString()}`;
}

function providerLabel(provider: PreviewMetadata["provider"]): string {
  return provider === "paper" ? "Paper" : "MagicPath";
}

function isProviderDesignUrl(value: string): boolean {
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "app.paper.design") {
      return url.pathname.startsWith("/file/");
    }
    return hostname === "magicpath.ai" || hostname.endsWith(".magicpath.ai");
  } catch {
    return false;
  }
}

function installDesignLinkRouting(signal: AbortSignal): () => void {
  const rewrite = (anchor: HTMLAnchorElement) => {
    if (
      anchor.dataset.designCanvasBypass === "true" ||
      anchor.dataset.designCanvasOriginalHref
    ) {
      return;
    }

    const originalHref = anchor.href;
    if (!isProviderDesignUrl(originalHref)) return;
    anchor.dataset.designCanvasOriginalHref = originalHref;
    const query = new URLSearchParams({
      url: originalHref,
      returnTo: currentReturnPath(),
    });
    anchor.href = `/api/v1/plugins/design-canvas/http/open?${query.toString()}`;
  };

  const scan = (root: ParentNode) => {
    if (root instanceof HTMLAnchorElement) rewrite(root);
    root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach(rewrite);
  };

  scan(document);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) scan(node);
      });
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  const cleanup = () => {
    observer.disconnect();
    document
      .querySelectorAll<HTMLAnchorElement>(
        "a[data-design-canvas-original-href]",
      )
      .forEach((anchor) => {
        const originalHref = anchor.dataset.designCanvasOriginalHref;
        if (originalHref) anchor.href = originalHref;
        delete anchor.dataset.designCanvasOriginalHref;
      });
  };
  signal.addEventListener("abort", cleanup, { once: true });
  return cleanup;
}

function PreviewCard({ preview }: { preview: PreviewMetadata }) {
  const [imageFailed, setImageFailed] = useState(false);
  const source = previewUrl(preview.id);

  return (
    <figure className="my-3 min-w-0 overflow-hidden rounded-xl border border-border bg-card text-foreground">
      {imageFailed ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 bg-muted/30 px-5 py-8 text-center">
          <p className="text-sm font-medium">Preview unavailable</p>
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            The original design is still available, but this saved image could
            not be loaded.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11"
            onClick={() => setImageFailed(false)}
          >
            Try again
          </Button>
        </div>
      ) : (
        <a
          href={viewerUrl(preview.id)}
          target="_blank"
          rel="noreferrer"
          className="block min-h-24 bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          aria-label={`View ${preview.title} at full size`}
        >
          <img
            src={source}
            alt={preview.title}
            loading="lazy"
            className="max-h-[70dvh] w-full object-contain"
            onError={() => setImageFailed(true)}
          />
        </a>
      )}

      <figcaption className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{preview.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {providerLabel(preview.provider)} preview · saved in bb
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <Button
            asChild
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 px-3"
          >
            <a href={previewUrl(preview.id, true)} download>
              <Icon name="Download" aria-hidden="true" />
              Download
            </a>
          </Button>
          <Button
            asChild
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 px-3"
          >
            <a
              href={preview.originalUrl}
              target="_blank"
              rel="noreferrer"
              data-design-canvas-bypass="true"
            >
              <Icon name="ExternalLink" aria-hidden="true" />
              Original
            </a>
          </Button>
        </div>
      </figcaption>
    </figure>
  );
}

function DesignPreviewDirective({ attributes }: PluginMessageDirectiveProps) {
  const rpc = useRpc<typeof rpcContract>();
  const id = attributes.id?.trim() ?? "";
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<PreviewMetadata | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">(
    "loading",
  );

  useEffect(() => {
    if (!previewIdPattern.test(id)) {
      setStatus("missing");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    void rpc
      .call("getPreview", { id })
      .then(({ preview: result }) => {
        if (cancelled) return;
        setPreview(result);
        setStatus(result ? "ready" : "missing");
      })
      .catch(() => {
        if (!cancelled) setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, id, rpc]);

  if (status === "loading") {
    return (
      <div className="my-3 flex min-h-24 items-center justify-center rounded-xl border border-border bg-muted/20 px-4 text-sm text-muted-foreground">
        Loading design preview…
      </div>
    );
  }

  if (status === "missing" || !preview) {
    return (
      <div className="my-3 flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            Preview unavailable
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            bb could not find the saved mobile preview for this design.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 self-start"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Try again
        </Button>
      </div>
    );
  }

  return <PreviewCard preview={preview} />;
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "route-design-links",
    mount({ signal }) {
      return installDesignLinkRouting(signal);
    },
  });

  app.slots.messageDirective({
    id: "design-preview",
    component: DesignPreviewDirective,
  });
});
