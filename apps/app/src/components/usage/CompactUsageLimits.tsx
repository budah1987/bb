import {
  useCallback,
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { atomWithStorage } from "jotai/utils";
import { useAtom } from "jotai";
import type {
  ProviderUsage,
  ProviderUsageResponse,
  ProviderUsageWindow,
} from "@bb/host-daemon-contract";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import { createJsonLocalStorage } from "@/lib/browser-storage";
import { selectPrimaryHost, useHosts } from "@/hooks/queries/host-queries";
import {
  useSystemConfig,
  useSystemUsageLimits,
} from "@/hooks/queries/system-queries";
import { formatProviderUsageReset } from "@/lib/provider-usage-format";
import "./CompactUsageLimits.css";

const SIDEBAR_USAGE_EXPANDED_STORAGE_KEY = "bb.sidebar.usageExpanded";
const DESKTOP_COLLAPSED_HEIGHT_PX = 56;
const MOBILE_COLLAPSED_HEIGHT_PX = 44;

const sidebarUsageExpandedAtom = atomWithStorage<boolean>(
  SIDEBAR_USAGE_EXPANDED_STORAGE_KEY,
  false,
  createJsonLocalStorage<boolean>(),
  { getOnInit: true },
);

export interface CompactUsageMetric {
  label: "5hr" | "Weekly" | "Fable";
  usedPercent: number | null;
  resetsAt: string | null;
}

export interface CompactProviderUsage {
  name: "Claude" | "Codex";
  summaryMetric: CompactUsageMetric;
  detailMetrics: readonly CompactUsageMetric[];
}

export interface CompactUsageLimitsModel {
  providers: readonly CompactProviderUsage[];
}

type UsageDockStyle = CSSProperties & {
  "--usage-collapsed-height": string;
  "--usage-expanded-height": string;
};

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

function unavailableMetric(
  label: CompactUsageMetric["label"],
): CompactUsageMetric {
  return { label, usedPercent: null, resetsAt: null };
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

  const claudeSummary =
    claudeSession ??
    (usage.claudeCode.status === "ok" ? unavailableMetric("5hr") : null);
  const codexDetailSession =
    codexSession ??
    (usage.codex.status === "ok" ? unavailableMetric("5hr") : null);
  const codexSummary = codexSession ?? codexWeekly ?? codexDetailSession;

  const providers = [
    claudeSummary === null
      ? null
      : {
          name: "Claude" as const,
          summaryMetric: claudeSummary,
          detailMetrics: [claudeSummary, claudeWeekly, claudeFable].filter(
            isPresent,
          ),
        },
    codexSummary === null
      ? null
      : {
          name: "Codex" as const,
          summaryMetric: codexSummary,
          detailMetrics: [codexDetailSession, codexWeekly].filter(isPresent),
        },
  ].filter(isPresent);

  return providers.length > 0 ? { providers } : null;
}

function usageValueToneClass(usedPercent: number | null): string {
  if (usedPercent === null) return "text-muted-foreground";
  if (usedPercent >= 95) return "text-destructive-text";
  if (usedPercent >= 80) return "text-warning-text";
  return "text-foreground";
}

function usageBarToneClass(usedPercent: number | null): string {
  if (usedPercent === null) return "bg-muted-foreground";
  if (usedPercent >= 95) return "bg-destructive";
  if (usedPercent >= 80) return "bg-warning";
  return "bg-primary";
}

function compactUsageAriaLabel(model: CompactUsageLimitsModel): string {
  const providers = model.providers.map((provider) =>
    provider.summaryMetric.usedPercent === null
      ? `${provider.name}: ${provider.summaryMetric.label}, unavailable`
      : `${provider.name}: ${provider.summaryMetric.label}, ${provider.summaryMetric.usedPercent} percent used`,
  );
  return `Provider usage. ${providers.join(". ")}.`;
}

function expandedDockHeight(
  model: CompactUsageLimitsModel,
  collapsedHeight: number,
): number {
  const metricCount = model.providers.reduce(
    (count, provider) => count + provider.detailMetrics.length,
    0,
  );
  return collapsedHeight + 12 + model.providers.length * 32 + metricCount * 32;
}

function useCloseOnEscape(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, open]);
}

function UsageProviderSummary({
  provider,
}: {
  provider: CompactProviderUsage;
}) {
  const metric = provider.summaryMetric;
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="flex min-w-0 items-baseline justify-between gap-2 text-2xs leading-4">
        <span className="truncate font-semibold text-muted-foreground">
          {provider.name} · {metric.label}
        </span>
        <span
          className={cn(
            "shrink-0 tabular-nums font-semibold",
            usageValueToneClass(metric.usedPercent),
          )}
        >
          {metric.usedPercent === null ? "—" : `${metric.usedPercent}%`}
        </span>
      </span>
      <span className="h-0.5 overflow-hidden rounded-full bg-muted/70">
        <span
          className={cn(
            "block h-full rounded-full opacity-80",
            usageBarToneClass(metric.usedPercent),
          )}
          style={{
            width:
              metric.usedPercent === null
                ? "0%"
                : `${Math.max(metric.usedPercent, 2)}%`,
          }}
        />
      </span>
    </span>
  );
}

function UsageSummary({ model }: { model: CompactUsageLimitsModel }) {
  return (
    <span
      className="flex min-w-0 flex-1 items-center"
      aria-label={compactUsageAriaLabel(model)}
    >
      {model.providers.map((provider, index) => (
        <span
          key={provider.name}
          className={cn(
            "flex min-w-0 flex-1 items-center",
            index > 0 && "ml-3 border-l border-border-hairline pl-3",
          )}
        >
          <UsageProviderSummary provider={provider} />
        </span>
      ))}
    </span>
  );
}

function UsageMetricRow({ metric }: { metric: CompactUsageMetric }) {
  const reset = formatProviderUsageReset(metric.resetsAt);
  const usageLabel =
    metric.usedPercent === null
      ? `${metric.label}, unavailable`
      : `${metric.label}, ${metric.usedPercent} percent used`;
  return (
    <div
      className="space-y-1"
      aria-label={`${usageLabel}${reset ? `, ${reset}` : ""}`}
    >
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{metric.label}</span>
        <span
          className={cn(
            "tabular-nums font-medium",
            usageValueToneClass(metric.usedPercent),
          )}
        >
          {metric.usedPercent === null ? "—" : `${metric.usedPercent}%`}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            usageBarToneClass(metric.usedPercent),
          )}
          style={{
            width:
              metric.usedPercent === null
                ? "0%"
                : `${Math.max(metric.usedPercent, 2)}%`,
          }}
        />
      </div>
      {reset ? (
        <p className="text-2xs leading-4 text-subtle-foreground">{reset}</p>
      ) : null}
    </div>
  );
}

function providerPeak(provider: CompactProviderUsage): number | null {
  const availableMetrics = provider.detailMetrics.flatMap((metric) =>
    metric.usedPercent === null ? [] : [metric.usedPercent],
  );
  return availableMetrics.length === 0 ? null : Math.max(...availableMetrics);
}

function UsageDetails({ model }: { model: CompactUsageLimitsModel }) {
  return (
    <div className="grid gap-2 px-2 pb-2">
      {model.providers.map((provider) => {
        const peak = providerPeak(provider);
        return (
          <section
            key={provider.name}
            aria-label={`${provider.name} usage`}
            className="rounded-xl border border-border-hairline bg-surface-raised/70 p-3"
          >
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-semibold text-foreground">
                {provider.name}
              </h3>
              <span className="text-2xs tabular-nums text-muted-foreground">
                Peak {peak === null ? "—" : `${peak}%`}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {provider.detailMetrics.map((metric) => (
                <UsageMetricRow key={metric.label} metric={metric} />
              ))}
            </div>
          </section>
        );
      })}
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

export function SidebarUsageLimitsContent({
  model,
  open,
  onOpenChange,
}: {
  model: CompactUsageLimitsModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const detailsId = useId();
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useCloseOnEscape(open, close);
  const style: UsageDockStyle = {
    "--usage-collapsed-height": `${DESKTOP_COLLAPSED_HEIGHT_PX}px`,
    "--usage-expanded-height": `${expandedDockHeight(model, DESKTOP_COLLAPSED_HEIGHT_PX)}px`,
  };

  return (
    <div
      data-testid="sidebar-usage-limits"
      className={cn(
        "relative shrink-0 px-2 max-md:hidden pointer-coarse:hidden group-data-[collapsible=icon]:hidden",
        open && "z-40",
      )}
    >
      {open ? (
        <button
          type="button"
          aria-label="Close provider usage"
          className="fixed inset-y-0 left-0 z-0 w-(--sidebar-width) bg-surface-scrim/20 backdrop-blur-[2px]"
          onClick={close}
        />
      ) : null}
      <div
        data-open={open}
        style={style}
        className="compact-usage-dock t-resize relative z-10 overflow-hidden rounded-xl border border-sidebar-border bg-sidebar shadow-sm"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={`${compactUsageAriaLabel(model)} ${open ? "Collapse" : "Expand"} details.`}
          className="flex h-14 w-full items-center gap-3 px-3 text-left hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring"
          onClick={() => onOpenChange(!open)}
        >
          <UsageSummary model={model} />
          <Icon
            name="ChevronDown"
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
        <div
          id={detailsId}
          aria-hidden={!open}
          className="compact-usage-details max-h-[calc(var(--usage-expanded-height)-3.5rem)] overflow-y-auto"
        >
          <UsageDetails model={model} />
        </div>
      </div>
    </div>
  );
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
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const close = useCallback(() => setOpen(false), []);
  useCloseOnEscape(open, close);
  const style: UsageDockStyle = {
    "--usage-collapsed-height": `${MOBILE_COLLAPSED_HEIGHT_PX}px`,
    "--usage-expanded-height": `${expandedDockHeight(model, MOBILE_COLLAPSED_HEIGHT_PX)}px`,
  };

  const closeFromDetails = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    close();
  };

  return (
    <div
      data-testid="command-center-usage-rail"
      className={cn(
        "relative mb-3 hidden shrink-0 max-md:block pointer-coarse:block",
        open && "z-40",
      )}
    >
      {open ? (
        <button
          type="button"
          aria-label="Close provider usage"
          className="fixed inset-0 z-0 bg-surface-scrim/25 backdrop-blur-[2px]"
          onClick={close}
        />
      ) : null}
      <div
        data-open={open}
        style={style}
        className="compact-usage-dock t-resize relative z-10 overflow-hidden rounded-xl border border-border-hairline bg-surface-raised/80 shadow-xs"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={`${compactUsageAriaLabel(model)} ${open ? "Collapse" : "Expand"} details.`}
          className="flex h-11 w-full items-center gap-3 px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => setOpen((current) => !current)}
        >
          <UsageSummary model={model} />
        </button>
        <div
          id={detailsId}
          aria-hidden={!open}
          className="compact-usage-details max-h-[calc(var(--usage-expanded-height)-2.75rem)] overflow-y-auto"
          onClick={closeFromDetails}
        >
          <UsageDetails model={model} />
        </div>
      </div>
    </div>
  );
}

export function CommandCenterUsageRail() {
  const model = usePrimaryUsageLimitsModel();
  if (model === null) return null;
  return <CommandCenterUsageRailContent model={model} />;
}
