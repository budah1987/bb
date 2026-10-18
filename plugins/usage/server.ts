import { createHash } from "node:crypto";
import {
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  parseClaude,
  parseCodex,
  parseGrok,
  parseOpenCode,
  parsePi,
  sourceId,
  type ParseContext,
  type UsageRecord,
} from "./collectors.js";

const AGENTS = [
  { id: "codex", name: "Codex" },
  { id: "claude", name: "Claude Code" },
  { id: "grok", name: "Grok" },
  { id: "pi", name: "Pi" },
  { id: "opencode", name: "OpenCode" },
] as const;
type AgentId = (typeof AGENTS)[number]["id"];
type JsonAgentId = Exclude<AgentId, "opencode">;
type Database = ReturnType<BbPluginApi["storage"]["database"]>;
type Machine = { id: string; name: string };

const SYNC_INTERVAL_MS = 15 * 60_000;

const machineSchema = z.object({ id: z.string(), name: z.string(), status: z.string() });
const usageRecordSchema = z.object({
  day: z.string(), agentId: z.string(), agentName: z.string(),
  machineId: z.string(), machineName: z.string(),
  modelProviderId: z.string(), modelProviderName: z.string(), model: z.string(),
  costUsd: z.number(), processedTokens: z.number(), cachedInputTokens: z.number(),
  cacheWriteTokens: z.number(), outputTokens: z.number(), loggedCostUsd: z.number().nullable(),
  pricingStatus: z.string(),
});
const providerLimitSchema = z.object({
  machineId: z.string(), machineName: z.string(), providerId: z.string(), providerName: z.string(),
  planLabel: z.string().nullable(), windows: z.array(z.object({
    label: z.string(), usedPercent: z.number(), resetsAt: z.string().nullable(),
  })),
});

export const usageRpcContract = defineRpcContract({
  dashboard: { input: z.object({}), output: z.object({
    generatedAt: z.string(), lastSyncedAt: z.string().nullable(),
    machines: z.array(machineSchema), records: z.array(usageRecordSchema),
    providerLimits: z.array(providerLimitSchema),
    notice: z.string(),
  }) },
  sync: { input: z.object({}), output: z.object({ ok: z.literal(true) }) },
});

// These first four entries deliberately preserve the legacy Usage plugin's
// migration order. Plugin migrations are indexed, so changing an entry would
// make an existing Usage database silently incompatible.
const migrations = [
  `CREATE TABLE IF NOT EXISTS usage_events (
    event_key TEXT PRIMARY KEY, timestamp TEXT NOT NULL, day TEXT NOT NULL,
    provider_id TEXT NOT NULL, provider_name TEXT NOT NULL, model TEXT NOT NULL,
    cost_usd REAL NOT NULL, cache_savings_usd REAL NOT NULL,
    processed_tokens INTEGER NOT NULL, cached_input_tokens INTEGER NOT NULL,
    cache_write_tokens INTEGER NOT NULL, uncached_input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS usage_events_day_idx ON usage_events(day);
  CREATE INDEX IF NOT EXISTS usage_events_provider_idx ON usage_events(provider_id, day);
  CREATE TABLE IF NOT EXISTS usage_sources (
    source_id TEXT PRIMARY KEY, machine_id TEXT NOT NULL, machine_name TEXT NOT NULL,
    provider_id TEXT NOT NULL, root_reference TEXT NOT NULL, content_sha TEXT NOT NULL,
    last_seen_generation TEXT NOT NULL, last_success_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS usage_sources_machine_idx ON usage_sources(machine_id, provider_id);
  CREATE TABLE IF NOT EXISTS usage_event_sources (
    event_key TEXT NOT NULL, source_id TEXT NOT NULL, PRIMARY KEY (event_key, source_id)
  );
  CREATE INDEX IF NOT EXISTS usage_event_sources_source_idx ON usage_event_sources(source_id);
  CREATE TABLE IF NOT EXISTS usage_sync_state (
    machine_id TEXT NOT NULL, provider_id TEXT NOT NULL, status TEXT NOT NULL, last_attempt_at TEXT,
    last_success_at TEXT, record_count INTEGER NOT NULL DEFAULT 0, error TEXT, PRIMARY KEY (machine_id, provider_id)
  );`,
  "ALTER TABLE usage_sources ADD COLUMN pricing_version TEXT;",
  `CREATE TABLE IF NOT EXISTS usage_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT OR IGNORE INTO usage_metadata (key, value)
  SELECT 'last_completed_sync_at', MAX(COALESCE(last_success_at, last_attempt_at))
  FROM usage_sync_state
  HAVING COUNT(*) > 0;`,
  `ALTER TABLE usage_events ADD COLUMN model_provider_id TEXT NOT NULL DEFAULT 'unknown';
  ALTER TABLE usage_events ADD COLUMN model_provider_name TEXT NOT NULL DEFAULT 'Unknown';
  ALTER TABLE usage_events ADD COLUMN logged_cost_usd REAL;
  ALTER TABLE usage_events ADD COLUMN pricing_status TEXT NOT NULL DEFAULT 'unknown';
  UPDATE usage_events SET
    model_provider_id=CASE provider_id WHEN 'codex' THEN 'openai' WHEN 'claude' THEN 'anthropic' WHEN 'grok' THEN 'xai' ELSE 'unknown' END,
    model_provider_name=CASE provider_id WHEN 'codex' THEN 'OpenAI' WHEN 'claude' THEN 'Anthropic' WHEN 'grok' THEN 'xAI' ELSE 'Unknown' END,
    pricing_status='models-dev-alias';
  CREATE INDEX IF NOT EXISTS usage_events_model_provider_idx ON usage_events(model_provider_id, day);`,
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function expandHome(value: string, home: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") return home;
  return trimmed.startsWith("~/") ? `${home}/${trimmed.slice(2)}` : trimmed;
}

function rootsFor(agentId: JsonAgentId, home: string, piRoots: string): string[] {
  if (agentId === "codex") return [`${home}/.codex/sessions`];
  if (agentId === "claude") return [`${home}/.claude/projects`];
  if (agentId === "grok") return [`${home}/.grok/logs`];
  return [
    `${home}/.pi/agent/sessions`,
    ...piRoots.split(";").map((value) => expandHome(value, home)).filter(Boolean),
  ];
}

function parserFor(agentId: JsonAgentId) {
  return agentId === "codex" ? parseCodex : agentId === "claude" ? parseClaude : agentId === "grok" ? parseGrok : parsePi;
}

function storeRecords(args: {
  db: Database;
  machine: Machine;
  agentId: AgentId;
  source: { id: string; rootReference: string; sha256: string; generation: string };
  records: readonly UsageRecord[];
}): void {
  const { db, machine, agentId, source, records } = args;
  const insert = db.prepare(`INSERT INTO usage_events (
    event_key, timestamp, day, provider_id, provider_name, model, cost_usd,
    cache_savings_usd, processed_tokens, cached_input_tokens, cache_write_tokens,
    uncached_input_tokens, output_tokens, model_provider_id, model_provider_name,
    logged_cost_usd, pricing_status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(event_key) DO UPDATE SET
    timestamp=excluded.timestamp, day=excluded.day, provider_id=excluded.provider_id,
    provider_name=excluded.provider_name, model=excluded.model,
    cost_usd=excluded.cost_usd, cache_savings_usd=excluded.cache_savings_usd,
    processed_tokens=excluded.processed_tokens, cached_input_tokens=excluded.cached_input_tokens,
    cache_write_tokens=excluded.cache_write_tokens, uncached_input_tokens=excluded.uncached_input_tokens,
    output_tokens=excluded.output_tokens, model_provider_id=excluded.model_provider_id,
    model_provider_name=excluded.model_provider_name, logged_cost_usd=excluded.logged_cost_usd,
    pricing_status=excluded.pricing_status`);
  const insertMapping = db.prepare("INSERT OR IGNORE INTO usage_event_sources (event_key, source_id) VALUES (?, ?)");
  const write = db.transaction(() => {
    db.prepare(`INSERT INTO usage_sources (
      source_id, machine_id, machine_name, provider_id, root_reference, content_sha,
      last_seen_generation, last_success_at, pricing_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET
      machine_name=excluded.machine_name, root_reference=excluded.root_reference,
      content_sha=excluded.content_sha, last_seen_generation=excluded.last_seen_generation,
      last_success_at=excluded.last_success_at, pricing_version=excluded.pricing_version`)
      .run(source.id, machine.id, machine.name, agentId, source.rootReference, source.sha256,
        source.generation, new Date().toISOString(), "built-in-1");
    db.prepare("DELETE FROM usage_event_sources WHERE source_id=?").run(source.id);
    for (const row of records) {
      insert.run(
        row.eventKey, row.timestamp, row.day, row.agentId, row.agentName, row.model,
        row.costUsd, row.cacheSavingsUsd, row.processedTokens, row.cachedInputTokens,
        row.cacheWriteTokens, row.uncachedInputTokens, row.outputTokens,
        row.modelProviderId, row.modelProviderName, row.loggedCostUsd, row.pricingStatus,
      );
      insertMapping.run(row.eventKey, source.id);
    }
    db.prepare("DELETE FROM usage_events WHERE event_key NOT IN (SELECT event_key FROM usage_event_sources)").run();
  });
  write();
}

function writeLastSyncedAt(db: Database, value: string): void {
  db.prepare(`INSERT INTO usage_metadata (key, value) VALUES ('last_completed_sync_at', ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(value);
}

function readLastSyncedAt(db: Database): string | null {
  const result = db.prepare("SELECT value FROM usage_metadata WHERE key='last_completed_sync_at'").get();
  return z.object({ value: z.string() }).nullable().catch(null).parse(result)?.value ?? null;
}

const usageSummarySchema = z.object({
  estimatedCostUsd: z.number(),
  processedTokens: z.number(),
  recordedResponses: z.number().int(),
});

export function parseUsageSummaryArguments(argv: string[]): {
  days: number;
  machineId: string | null;
  json: boolean;
} {
  if (argv[0] !== "summary") {
    throw new Error("Usage: bb usage summary [--days <1-365>] [--machine <host-id>] [--json]");
  }
  let days = 30;
  let machineId: string | null = null;
  let json = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--days") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 365) {
        throw new Error("--days must be a whole number from 1 through 365.");
      }
      days = value;
      index += 1;
      continue;
    }
    if (argument === "--machine") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--machine requires a host id.");
      machineId = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown usage option: ${argument ?? ""}`);
  }
  return { days, machineId, json };
}

function readUsageSummary(
  db: Database,
  options: { days: number; machineId: string | null },
): z.infer<typeof usageSummarySchema> {
  const machineFilter = options.machineId === null ? "" : "AND machine_id=?";
  const values = options.machineId === null
    ? [`-${options.days - 1} days`]
    : [`-${options.days - 1} days`, options.machineId];
  const result = db.prepare(`WITH canonical AS (
    SELECT e.*, MIN(s.machine_id) machine_id
    FROM usage_events e
    JOIN usage_event_sources es ON es.event_key=e.event_key
    JOIN usage_sources s ON s.source_id=es.source_id
    GROUP BY e.event_key
  ) SELECT COALESCE(SUM(cost_usd), 0) estimatedCostUsd,
    COALESCE(SUM(processed_tokens), 0) processedTokens,
    COUNT(*) recordedResponses
    FROM canonical WHERE day >= date('now', ?) ${machineFilter}`).get(...values);
  return usageSummarySchema.parse(result);
}

async function collectJsonAgent(args: {
  bb: BbPluginApi; db: Database; hostId: string; home: string; machineName: string;
  agentId: JsonAgentId; piRoots: string;
}): Promise<void> {
  const parser = parserFor(args.agentId);
  for (const root of [...new Set(rootsFor(args.agentId, args.home, args.piRoots))]) {
    let listing;
    try {
      listing = await args.bb.sdk.files.list({
        hostId: args.hostId, path: root,
        query: args.agentId === "codex" ? "rollout-" : args.agentId === "grok" ? "unified.jsonl" : ".jsonl",
        limit: 5_000,
      });
    } catch {
      continue;
    }
    for (const file of listing.files) {
      const filePath = file.path.startsWith("/") ? file.path : `${root}/${file.path}`;
      if (!filePath.endsWith(".jsonl") || (args.agentId === "grok" && !filePath.endsWith("/unified.jsonl"))) continue;
      try {
        const read = await args.bb.sdk.files.read({ hostId: args.hostId, path: filePath });
        if (read.contentEncoding !== "utf8") continue;
        storeRecords({
          db: args.db,
          machine: { id: args.hostId, name: args.machineName },
          agentId: args.agentId,
          source: {
            id: sourceId(args.hostId, args.agentId, filePath),
            rootReference: sourceId(args.hostId, args.agentId, root),
            sha256: createHash("sha256").update(read.content).digest("hex"),
            generation: new Date().toISOString(),
          },
          records: parser(read.content, { machineId: args.hostId, machineName: args.machineName }),
        });
      } catch (error) {
        args.bb.log.debug(`Usage could not read ${sourceId(args.hostId, args.agentId, filePath).slice(0, 12)}: ${errorMessage(error)}`);
      }
    }
  }
}

async function collectOpenCode(args: {
  bb: BbPluginApi; db: Database; hostId: string; home: string; machineName: string; databasePath: string;
}): Promise<void> {
  const databasePath = expandHome(args.databasePath, args.home) || `${args.home}/.local/share/opencode/opencode.db`;
  const result = await args.bb.sdk.system.experimental_openCodeUsageHistory({
    hostId: args.hostId,
    databasePath,
  });
  if (result.status === "missing") return;
  if (result.status === "unavailable") throw new Error(result.message);
  storeRecords({
    db: args.db,
    machine: { id: args.hostId, name: args.machineName },
    agentId: "opencode",
    source: {
      id: sourceId(args.hostId, "opencode", databasePath),
      rootReference: sourceId(args.hostId, "opencode", databasePath),
      sha256: createHash("sha256").update(JSON.stringify(result.records)).digest("hex"),
      generation: new Date().toISOString(),
    },
    records: parseOpenCode(result.records, { machineId: args.hostId, machineName: args.machineName }),
  });
  if (result.truncated) args.bb.log.warn(`${args.machineName}/opencode: history was truncated to the safe aggregate limit.`);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define({
    piSessionRoots: { type: "string", label: "Extra Pi session roots", description: "Semicolon-separated paths; ~/ is expanded on each machine.", default: "" },
    openCodeDatabasePath: { type: "string", label: "OpenCode database path", description: "Optional override; defaults to ~/.local/share/opencode/opencode.db.", default: "" },
  });
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);
  let running: Promise<void> | null = null;

  const sync = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      const config = await settings.get();
      const machines = await bb.sdk.hosts.list();
      for (const machine of machines) {
        if (machine.status !== "connected") continue;
        try {
          const home = (await bb.sdk.hosts.directory({ hostId: machine.id })).directory;
          await Promise.all([
            collectJsonAgent({ bb, db, hostId: machine.id, home, machineName: machine.name, agentId: "codex", piRoots: config.piSessionRoots }),
            collectJsonAgent({ bb, db, hostId: machine.id, home, machineName: machine.name, agentId: "claude", piRoots: config.piSessionRoots }),
            collectJsonAgent({ bb, db, hostId: machine.id, home, machineName: machine.name, agentId: "grok", piRoots: config.piSessionRoots }),
            collectJsonAgent({ bb, db, hostId: machine.id, home, machineName: machine.name, agentId: "pi", piRoots: config.piSessionRoots }),
            collectOpenCode({ bb, db, hostId: machine.id, home, machineName: machine.name, databasePath: config.openCodeDatabasePath }),
          ]);
        } catch (error) {
          bb.log.warn(`${machine.name}: usage collection failed: ${errorMessage(error)}`);
        }
      }
      const completedAt = new Date().toISOString();
      writeLastSyncedAt(db, completedAt);
      bb.realtime.publish("usage-updated", { completedAt });
    })().finally(() => { running = null; });
    return running;
  };

  bb.cli.register({
    name: "usage",
    summary: "Inspect coding-agent token usage and estimated API cost",
    commands: [{
      name: "summary",
      summary: "Print collected usage totals",
      usage: "bb usage summary [--days <1-365>] [--machine <host-id>] [--json]",
    }],
    run(argv) {
      try {
        const options = parseUsageSummaryArguments(argv);
        const summary = readUsageSummary(db, options);
        if (options.json) return { exitCode: 0, stdout: `${JSON.stringify(summary)}\n` };
        return {
          exitCode: 0,
          stdout: [
            `Usage for the last ${options.days} days${options.machineId ? ` on ${options.machineId}` : ""}:`,
            `Estimated API cost: $${summary.estimatedCostUsd.toFixed(2)}`,
            `Tokens processed: ${summary.processedTokens.toLocaleString()}`,
            `Recorded responses: ${summary.recordedResponses.toLocaleString()}`,
          ].join("\n") + "\n",
        };
      } catch (error) {
        return { exitCode: 2, stderr: `${errorMessage(error)}\n` };
      }
    },
  });

  bb.rpc.register(usageRpcContract, {
    async dashboard() {
      const machines = (await bb.sdk.hosts.list()).map((host) => ({ id: host.id, name: host.name, status: host.status }));
      const providerLimits = (await Promise.all(machines.filter((machine) => machine.status === "connected").map(async (machine) => {
        try {
          const limits = await bb.sdk.system.usageLimits({ hostId: machine.id });
          return ([
            ["codex", "Codex", limits.codex], ["claudeCode", "Claude Code", limits.claudeCode], ["cursor", "Cursor", limits.cursor],
          ] as const).flatMap(([providerId, providerName, limit]) => limit.status === "ok" && limit.windows.length > 0
            ? [{ machineId: machine.id, machineName: machine.name, providerId, providerName, planLabel: limit.planLabel, windows: limit.windows }]
            : []);
        } catch { return []; }
      }))).flat();
      const records = z.array(usageRecordSchema).parse(db.prepare(`WITH canonical AS (
        SELECT e.*, MIN(s.machine_id) machine_id, MIN(s.machine_name) machine_name
        FROM usage_events e
        JOIN usage_event_sources es ON es.event_key=e.event_key
        JOIN usage_sources s ON s.source_id=es.source_id
        GROUP BY e.event_key
      ) SELECT day, provider_id agentId, provider_name agentName,
        machine_id machineId, machine_name machineName,
        model_provider_id modelProviderId, model_provider_name modelProviderName, model,
        SUM(cost_usd) costUsd, SUM(processed_tokens) processedTokens,
        SUM(cached_input_tokens) cachedInputTokens, SUM(cache_write_tokens) cacheWriteTokens,
        SUM(output_tokens) outputTokens,
        CASE WHEN COUNT(logged_cost_usd)=0 THEN NULL ELSE SUM(logged_cost_usd) END loggedCostUsd,
        CASE WHEN SUM(CASE WHEN pricing_status='unknown' THEN 1 ELSE 0 END)>0 THEN 'unknown'
          WHEN SUM(CASE WHEN pricing_status='logged' THEN 1 ELSE 0 END)>0 THEN 'logged'
          ELSE 'estimated' END pricingStatus
        FROM canonical
        WHERE day >= date('now', '-365 days')
        GROUP BY day, provider_id, model_provider_id, machine_id, model
        ORDER BY day DESC, agentName, model`).all());
      return {
        generatedAt: new Date().toISOString(), lastSyncedAt: readLastSyncedAt(db), machines, records, providerLimits,
        notice: "Only usage metadata is stored. Prompts and message content are never retained.",
      };
    },
    sync() { void sync().catch((error) => bb.log.error(`Usage sync failed: ${errorMessage(error)}`)); return { ok: true as const }; },
  });

  bb.background.service("usage-collector", {
    async start(signal) {
      while (!signal.aborted) {
        await sync().catch((error) => bb.log.error(`Usage sync failed: ${errorMessage(error)}`));
        await delay(SYNC_INTERVAL_MS, signal);
      }
    },
  });
}
