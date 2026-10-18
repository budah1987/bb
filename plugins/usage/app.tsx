import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import {
  definePluginApp,
  type PluginRpcResult,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { usageRpcContract } from "./server.js";

type Dashboard = PluginRpcResult<(typeof usageRpcContract)["dashboard"]>;

const DAY_OPTIONS = [7, 30, 90, 365] as const;
type DayOption = (typeof DAY_OPTIONS)[number];

function parseDayOption(value: string): DayOption {
  const parsed = Number(value);
  if (parsed === 7 || parsed === 30 || parsed === 90 || parsed === 365) return parsed;
  return 30;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 3 : 2,
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function daysAgo(day: string, days: number): boolean {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  return new Date(`${day}T00:00:00Z`) >= start;
}

function UsagePanel() {
  const rpc = useRpc<typeof usageRpcContract>();
  const realtime = useRealtimeConnectionState();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState<DayOption>(30);
  const [machineId, setMachineId] = useState("all");

  const load = useCallback(async () => {
    try {
      setError(null);
      setDashboard(await rpc.call("dashboard", {}));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Usage data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  const sync = useCallback(async () => {
    setRefreshing(true);
    try {
      await rpc.call("sync", {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Usage refresh could not be started.");
    } finally {
      setRefreshing(false);
    }
  }, [rpc]);

  useEffect(() => { void load(); }, [load]);
  useRealtime("usage-updated", useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    if (realtime === "connected") void load();
  }, [load, realtime]);

  const filteredRecords = useMemo(() => (dashboard?.records ?? []).filter((record) =>
    daysAgo(record.day, days) && (machineId === "all" || record.machineId === machineId),
  ), [dashboard?.records, days, machineId]);
  const totals = useMemo(() => filteredRecords.reduce((total, record) => ({
    cost: total.cost + record.costUsd,
    tokens: total.tokens + record.processedTokens,
    responses: total.responses + 1,
  }), { cost: 0, tokens: 0, responses: 0 }), [filteredRecords]);
  const models = useMemo(() => Object.values(filteredRecords.reduce<Record<string, {
    label: string; cost: number; tokens: number; responses: number;
  }>>((summary, record) => {
    const key = `${record.modelProviderName}:${record.model}`;
    const item = summary[key] ?? { label: key, cost: 0, tokens: 0, responses: 0 };
    item.cost += record.costUsd;
    item.tokens += record.processedTokens;
    item.responses += 1;
    summary[key] = item;
    return summary;
  }, {})).sort((left, right) => right.cost - left.cost || right.tokens - left.tokens).slice(0, 12), [filteredRecords]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6" aria-busy={loading}>
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Coding-agent activity across your connected machines</p>
          <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {dashboard?.lastSyncedAt ? `Last updated ${new Date(dashboard.lastSyncedAt).toLocaleString()}` : "Waiting for the first collection."}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50"
          onClick={() => void sync()}
          disabled={refreshing}
        >
          <Icon name="ArrowReloadHorizontal" aria-hidden className={refreshing ? "size-4 animate-spin" : "size-4"} />
          {refreshing ? "Refreshing" : "Refresh usage"}
        </button>
      </header>

      <section className="flex flex-wrap items-end gap-3" aria-label="Usage filters">
        <label className="grid gap-1 text-sm font-medium">
          Period
          <select
            className="min-h-9 rounded-md border border-border bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={days}
            onChange={(event) => setDays(parseDayOption(event.target.value))}
          >
            {DAY_OPTIONS.map((value) => <option key={value} value={value}>Last {value} days</option>)}
          </select>
        </label>
        <label className="grid min-w-48 gap-1 text-sm font-medium">
          Machine
          <select
            className="min-h-9 rounded-md border border-border bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={machineId}
            onChange={(event) => setMachineId(event.target.value)}
          >
            <option value="all">All machines</option>
            {dashboard?.machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
          </select>
        </label>
      </section>

      {error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Usage totals">
        <Metric label="Estimated API cost" value={formatUsd(totals.cost)} detail="Agent-reported cost is used when an estimate is unavailable." />
        <Metric label="Tokens processed" value={formatNumber(totals.tokens)} detail="Input, cache writes, output, and reasoning." />
        <Metric label="Recorded responses" value={formatNumber(totals.responses)} detail="Assistant responses with usage metadata." />
      </section>

      <section className="rounded-lg border border-border" aria-labelledby="model-usage-heading">
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          <div>
            <h2 id="model-usage-heading" className="font-semibold">Model usage</h2>
            <p className="text-sm text-muted-foreground">Highest estimated cost first</p>
          </div>
          <span className="text-sm tabular-nums text-muted-foreground">{filteredRecords.length} entries</span>
        </div>
        {loading ? <p className="px-4 py-8 text-sm text-muted-foreground">Loading usage data…</p>
          : models.length === 0 ? <p className="px-4 py-8 text-sm text-muted-foreground">No usage metadata was found for this selection.</p>
          : <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th scope="col" className="px-4 py-2 font-medium">Model</th><th scope="col" className="px-4 py-2 text-right font-medium">Cost</th><th scope="col" className="px-4 py-2 text-right font-medium">Tokens</th><th scope="col" className="px-4 py-2 text-right font-medium">Responses</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {models.map((model) => <tr key={model.label}><th scope="row" className="px-4 py-3 font-medium">{model.label}</th><td className="px-4 py-3 text-right tabular-nums">{formatUsd(model.cost)}</td><td className="px-4 py-3 text-right tabular-nums">{formatNumber(model.tokens)}</td><td className="px-4 py-3 text-right tabular-nums">{formatNumber(model.responses)}</td></tr>)}
              </tbody>
            </table>
          </div>}
      </section>

      {dashboard?.providerLimits.length ? <section className="space-y-3" aria-labelledby="provider-limits-heading">
        <div><h2 id="provider-limits-heading" className="font-semibold">Subscription windows</h2><p className="text-sm text-muted-foreground">Reported by connected providers; these are separate from estimated API cost.</p></div>
        <div className="grid gap-3 md:grid-cols-2">{dashboard.providerLimits.map((limit) => <article key={`${limit.machineId}:${limit.providerId}`} className="rounded-lg border border-border p-4"><h3 className="font-medium">{limit.providerName} <span className="font-normal text-muted-foreground">on {limit.machineName}</span></h3>{limit.planLabel ? <p className="mt-1 text-sm text-muted-foreground">{limit.planLabel}</p> : null}<ul className="mt-3 space-y-2">{limit.windows.map((window) => <li key={window.label} className="flex items-center justify-between gap-3 text-sm"><span>{window.label}</span><span className="tabular-nums text-muted-foreground">{Math.round(window.usedPercent)}% used{window.resetsAt ? ` · resets ${new Date(window.resetsAt).toLocaleString()}` : ""}</span></li>)}</ul></article>)}</div>
      </section> : null}

      {dashboard ? <p className="text-sm text-muted-foreground">{dashboard.notice}</p> : null}
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="rounded-lg border border-border bg-background p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-sm text-muted-foreground">{detail}</p></article>;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "usage",
    title: "Usage",
    icon: "ChartColumn",
    path: "usage",
    component: UsagePanel,
  });
});
