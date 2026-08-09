import { atomWithStorage } from "jotai/utils";
import { useAtom } from "jotai";
import type {
  ProviderUsage,
  ProviderUsageResponse,
  ProviderUsageWindow,
} from "@bb/host-daemon-contract";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@bb/shared-ui/collapsible";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";
import { selectPrimaryHost, useHosts } from "@/hooks/queries/host-queries";
import {
  useSystemConfig,
  useSystemUsageLimits,
} from "@/hooks/queries/system-queries";
import { formatProviderUsageReset } from "@/lib/provider-usage-format";

const SIDEBAR_USAGE_EXPANDED_STORAGE_KEY = "bb.sidebar.usageExpanded";

const sidebarUsageExpandedAtom = atomWithStorage<boolean>(
  SIDEBAR_USAGE_EXPANDED_STORAGE_KEY,
  false,
  createJsonLocalStorage<boolean>(),
  { getOnInit: true },
);

export interface CompactUsageMetric {
  label: "5hr" | "Weekly" | "Fable";
  usedPercent: number;
  resetsAt: string | null;
}

export interface CompactProviderUsage {
  name: "Claude" | "Codex";
  summaryMetrics: readonly CompactUsageMetric[];
  detailMetrics: readonly CompactUsageMetric[];
}

export interface CompactUsageLimitsModel {
  providers: readonly CompactProviderUsage[];
}

function normalizedWindowLabel(window: ProviderUsageWindow): string {
  return window.label.trim().toLocaleLowerCase();
}

function findWindow(
  usage: ProviderUsage,
  matches: (label: string) => boolean,
): ProviderUsageWindow | undefined {
  if (usage.status !== "ok") return undefined;
  return usage.windows.find((window) => matches(normalizedWindowLabel(window)));
}

function toMetric(
  label: CompactUsageMetric["label"],
  window: ProviderUsageWindow | undefined,
): CompactUsageMetric | null {
  if (window === undefined) return null;
  return {
    label,
    usedPercent: Math.round(window.usedPercent),
    resetsAt: window.resetsAt,
  };
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function currentSessionWindow(
  usage: ProviderUsage,
): ProviderUsageWindow | undefined {
  return findWindow(
    usage,
    (label) =>
      label.includes("current session") ||
      label.includes("5 hour") ||
      label.includes("5hr") ||
      label === "session",
  );
}

function weeklyWindow(usage: ProviderUsage): ProviderUsageWindow | undefined {
  return findWindow(
    usage,
    (label) =>
      label.includes("weekly") ||
      label.includes("seven day") ||
      label.includes("7 day"),
  );
}

function fableWindow(usage: ProviderUsage): ProviderUsageWindow | undefined {
  return findWindow(usage, (label) => label.includes("fable"));
}

export function buildCompactUsageLimitsModel(
  usage: Pick<ProviderUsageResponse, "claudeCode" | "codex"> | null | undefined,
): CompactUsageLimitsModel | null {
  if (usage == null) return null;

  const claudeSession = toMetric("5hr", currentSessionWindow(usage.claudeCode));
  const claudeWeekly = toMetric("Weekly", weeklyWindow(usage.claudeCode));
  const claudeFable = toMetric("Fable", fableWindow(usage.claudeCode));
  const codexSession = toMetric("5hr", currentSessionWindow(usage.codex));
  const codexWeekly = toMetric("Weekly", weeklyWindow(usage.codex));

  const providerCandidates: CompactProviderUsage[] = [
    {
      name: "Claude",
      summaryMetrics: [claudeSession, claudeFable].filter(isPresent),
      detailMetrics: [claudeSession, claudeWeekly, claudeFable].filter(
        isPresent,
      ),
    },
    {
      name: "Codex",
      summaryMetrics: [codexSession].filter(isPresent),
      detailMetrics: [codexSession, codexWeekly].filter(isPresent),
    },
  ];
  const providers = providerCandidates.filter(
    (provider) => provider.summaryMetrics.length > 0,
  );

  return providers.length > 0 ? { providers } : null;
}

function usageValueToneClass(usedPercent: number): string {
  if (usedPercent >= 95) return "text-destructive";
  if (usedPercent >= 80) return "text-warning-text";
  return "text-foreground";
}

function usageBarToneClass(usedPercent: number): string {
  if (usedPercent >= 95) return "bg-destructive";
  if (usedPercent >= 80) return "bg-warning";
  return "bg-primary";
}

function compactUsageAriaLabel(model: CompactUsageLimitsModel): string {
  const providers = model.providers.map((provider) => {
    const metrics = provider.summaryMetrics
      .map((metric) => `${metric.label}, ${metric.usedPercent} percent used`)
      .join(", ");
    return `${provider.name}: ${metrics}`;
  });
  return `Provider usage. ${providers.join(". ")}.`;
}

export function CompactUsageSummary({
  model,
  className,
}: {
  model: CompactUsageLimitsModel;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-baseline gap-1.5 overflow-hidden whitespace-nowrap text-2xs leading-4",
        className,
      )}
      aria-label={compactUsageAriaLabel(model)}
    >
      {model.providers.map((provider, providerIndex) => (
        <span key={provider.name} className="flex min-w-0 items-baseline gap-1">
          {providerIndex > 0 ? (
            <span aria-hidden className="text-border">
              |
            </span>
          ) : null}
          <strong className="font-semibold text-foreground">
            {provider.name}
          </strong>
          {provider.summaryMetrics.map((metric) => (
            <span key={metric.label} className="flex items-baseline gap-1">
              <span className="text-muted-foreground">{metric.label}</span>
              <span
                className={cn(
                  "tabular-nums",
                  usageValueToneClass(metric.usedPercent),
                )}
              >
                {metric.usedPercent}%
              </span>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

function UsageMetricRow({ metric }: { metric: CompactUsageMetric }) {
  const reset = formatProviderUsageReset(metric.resetsAt);
  return (
    <div
      className="grid grid-cols-[3rem_1fr_auto] items-center gap-2 text-xs"
      aria-label={`${metric.label}, ${metric.usedPercent} percent used${
        reset ? `, ${reset}` : ""
      }`}
    >
      <span className="text-muted-foreground">{metric.label}</span>
      <span className="h-1 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full",
            usageBarToneClass(metric.usedPercent),
          )}
          style={{ width: `${Math.max(metric.usedPercent, 2)}%` }}
        />
      </span>
      <span
        className={cn(
          "w-8 text-right tabular-nums",
          usageValueToneClass(metric.usedPercent),
        )}
      >
        {metric.usedPercent}%
      </span>
      {reset ? (
        <span className="col-span-2 col-start-2 text-2xs text-muted-foreground">
          {reset}
        </span>
      ) : null}
    </div>
  );
}

export function SidebarUsageLimitsContent({
  model,
  open,
  onOpenChange,
}: {
  model: CompactUsageLimitsModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div
      data-testid="sidebar-usage-limits"
      className="shrink-0 px-1 max-md:hidden pointer-coarse:hidden group-data-[collapsible=icon]:hidden"
    >
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger
          className="group flex h-8 w-full min-w-0 items-center gap-0.5 rounded-md px-1 text-left hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          aria-label={`${compactUsageAriaLabel(model)} ${
            open ? "Collapse" : "Expand"
          } details.`}
        >
          <CompactUsageSummary model={model} className="flex-1" />
          <Icon
            name="ChevronDown"
            className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 border-t border-sidebar-border px-1.5 pb-2 pt-2.5">
            {model.providers.map((provider) => (
              <section
                key={provider.name}
                aria-label={`${provider.name} usage`}
              >
                <h3 className="mb-1.5 text-xs font-semibold text-sidebar-foreground">
                  {provider.name}
                </h3>
                <div className="space-y-1.5">
                  {provider.detailMetrics.map((metric) => (
                    <UsageMetricRow key={metric.label} metric={metric} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function usePrimaryUsageLimitsModel(): CompactUsageLimitsModel | null {
  const systemConfigQuery = useSystemConfig();
  const hostsQuery = useHosts();
  const hosts = hostsQuery.data ?? [];
  const primaryHost = selectPrimaryHost(
    hosts,
    systemConfigQuery.data?.primaryHostId ?? null,
  );
  const usageHostId =
    primaryHost?.id ?? systemConfigQuery.data?.primaryHostId ?? undefined;
  const usageQuery = useSystemUsageLimits({
    hostId: usageHostId,
    enabled: systemConfigQuery.data !== undefined,
  });

  return buildCompactUsageLimitsModel(usageQuery.data);
}

export function SidebarUsageLimits() {
  const model = usePrimaryUsageLimitsModel();
  const [open, setOpen] = useAtom(sidebarUsageExpandedAtom);

  if (model === null) return null;

  return (
    <SidebarUsageLimitsContent
      model={model}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

export function CommandCenterUsageRailContent({
  model,
}: {
  model: CompactUsageLimitsModel;
}) {
  return (
    <div
      data-testid="command-center-usage-rail"
      className="mb-3 hidden h-4 shrink-0 items-center overflow-hidden px-1 max-md:flex pointer-coarse:flex"
    >
      <CompactUsageSummary model={model} className="w-full" />
    </div>
  );
}

export function CommandCenterUsageRail() {
  const model = usePrimaryUsageLimitsModel();
  if (model === null) return null;

  return <CommandCenterUsageRailContent model={model} />;
}
