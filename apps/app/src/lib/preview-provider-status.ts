import type { EnvironmentPreviewProvider } from "@bb/server-contract";
import { formatRelativeTime } from "./relative-time";
import type { StatusTier } from "./status-tier";

export interface PreviewProviderStatus {
  label: string;
  tier: StatusTier;
}

interface ResolvePreviewProviderStatusArgs {
  /** Reference "now" in epoch milliseconds. Passed in for testability. */
  now: number;
  provider: EnvironmentPreviewProvider;
}

function previewPort(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  try {
    const port = new URL(url).port;
    return port === "" ? null : port;
  } catch {
    return null;
  }
}

function previewAge(updatedAt: string | null, now: number): string | null {
  if (updatedAt === null) {
    return null;
  }
  const timestamp = Date.parse(updatedAt);
  return Number.isNaN(timestamp)
    ? null
    : formatRelativeTime({ timestamp, now });
}

/**
 * A ready preview says where it is: a local server by port, a deployment by
 * how old the build is. Both answers are omitted rather than guessed when the
 * provider did not supply them.
 */
export function resolvePreviewProviderStatus({
  now,
  provider,
}: ResolvePreviewProviderStatusArgs): PreviewProviderStatus {
  switch (provider.state) {
    case "failed":
      return { label: "Failed", tier: "destructive" };
    case "building":
      return { label: "Building", tier: "warning" };
    case "unknown":
      return { label: "Unknown", tier: "muted" };
    case "ready": {
      if (provider.url === null) {
        return {
          label: provider.kind === "local" ? "Not shared" : "No URL",
          tier: "muted",
        };
      }
      const detail =
        provider.kind === "local"
          ? previewPort(provider.url)
          : previewAge(provider.updatedAt, now);
      if (detail === null) {
        return { label: "Ready", tier: "success" };
      }
      return {
        label:
          provider.kind === "local" ? `Ready :${detail}` : `Ready ${detail}`,
        tier: "success",
      };
    }
  }
}

/**
 * Whether the preview can be shown inline. A blocked provider is the only
 * definite "no" — `unknown` means nobody has told us otherwise, and refusing
 * to try would hide every preview whose headers we cannot read in advance.
 */
export function canFramePreviewProvider(
  provider: EnvironmentPreviewProvider,
): boolean {
  return (
    provider.state === "ready" &&
    provider.url !== null &&
    provider.framePolicy !== "blocked"
  );
}

export interface PreviewSummary {
  label: string;
  tier: StatusTier;
}

interface SummarizePreviewProvidersArgs {
  isLoading: boolean;
  providers: readonly EnvironmentPreviewProvider[];
}

function countState(
  providers: readonly EnvironmentPreviewProvider[],
  state: EnvironmentPreviewProvider["state"],
): number {
  return providers.filter((provider) => provider.state === state).length;
}

/** The header mirrors the worst row, and only that. */
export function summarizePreviewProviders({
  isLoading,
  providers,
}: SummarizePreviewProvidersArgs): PreviewSummary {
  if (isLoading) {
    return { label: "Loading", tier: "muted" };
  }
  const failedCount = countState(providers, "failed");
  if (failedCount > 0) {
    return { label: `${failedCount} failed`, tier: "destructive" };
  }
  const buildingCount = countState(providers, "building");
  if (buildingCount > 0) {
    return { label: `${buildingCount} building`, tier: "warning" };
  }
  const readyCount = countState(providers, "ready");
  if (readyCount > 0) {
    return { label: `${readyCount} ready`, tier: "muted" };
  }
  return { label: "None", tier: "muted" };
}
