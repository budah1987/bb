import { createHash } from "node:crypto";
import { providers } from "@opencode-ai/models/snapshot";

export interface UsageRecord {
  eventKey: string;
  timestamp: string;
  day: string;
  agentId: "codex" | "claude" | "grok" | "pi" | "opencode";
  agentName: string;
  modelProviderId: string;
  modelProviderName: string;
  model: string;
  costUsd: number;
  cacheSavingsUsd: number;
  processedTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  loggedCostUsd: number | null;
  pricingStatus: "estimated" | "logged" | "unknown";
}

export interface ParseContext {
  machineId: string;
  machineName: string;
}

interface Price {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function providerName(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeProviderId(value: string): string {
  const normalized = value.toLowerCase().replace(/_/gu, "-") || "unknown";
  return normalized === "x-ai" ? "xai" : normalized;
}

function lookupPrice(providerId: string, model: string): Price | null {
  const provider = providers[providerId];
  const candidate =
    provider?.models[model] ??
    provider?.models[model.toLowerCase()] ??
    Object.entries(provider?.models ?? {}).find(([id]) =>
      model.toLowerCase().startsWith(id.toLowerCase()),
    )?.[1];
  const cost = candidate?.cost;
  if (!cost) return null;
  return {
    input: Math.max(0, cost.input),
    cached: Math.max(0, cost.cache_read ?? cost.input),
    cacheWrite: Math.max(0, cost.cache_write ?? cost.input),
    output: Math.max(0, cost.output),
  };
}

function usageRecord(
  input: Omit<UsageRecord, "day" | "costUsd" | "cacheSavingsUsd" | "modelProviderName" | "pricingStatus">,
): UsageRecord {
  const price = lookupPrice(input.modelProviderId, input.model);
  const estimatedCost = price
    ? (input.uncachedInputTokens * price.input +
        input.cachedInputTokens * price.cached +
        input.cacheWriteTokens * price.cacheWrite +
        input.outputTokens * price.output) /
      1_000_000
    : null;
  const loggedCost = input.loggedCostUsd;
  const costUsd = estimatedCost ?? loggedCost ?? 0;
  return {
    ...input,
    day: input.timestamp.slice(0, 10),
    modelProviderName: providerName(input.modelProviderId),
    costUsd,
    cacheSavingsUsd: price
      ? (input.cachedInputTokens * Math.max(0, price.input - price.cached)) /
        1_000_000
      : 0,
    pricingStatus: estimatedCost !== null ? "estimated" : loggedCost !== null ? "logged" : "unknown",
  };
}

function parseLines(content: string): unknown[] {
  return content.split(/\r?\n/u).flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

export function sourceId(machineId: string, agentId: string, filePath: string): string {
  return createHash("sha256").update(`${machineId}:${agentId}:${filePath}`).digest("hex");
}

export function parseCodex(content: string, context: ParseContext): UsageRecord[] {
  let sessionId = "unknown";
  let model = "unknown";
  return parseLines(content).flatMap((value, index) => {
    const row = object(value);
    const payload = object(row?.payload);
    if (!row || !payload) return [];
    if (row.type === "session_meta") sessionId = text(payload.id, sessionId);
    if (row.type === "turn_context") model = text(payload.model, model);
    const usage = object(object(payload.info)?.last_token_usage);
    const timestamp = isoTimestamp(row.timestamp);
    if (row.type !== "event_msg" || payload.type !== "token_count" || !usage || !timestamp) return [];
    const cached = number(usage.cached_input_tokens);
    const input = number(usage.input_tokens);
    const cacheWrite = number(usage.cache_write_input_tokens);
    return [usageRecord({
      eventKey: `codex:${context.machineId}:${sessionId}:${index}`,
      timestamp,
      agentId: "codex", agentName: "Codex", modelProviderId: "openai", model,
      uncachedInputTokens: Math.max(0, input - cached), cachedInputTokens: cached,
      cacheWriteTokens: cacheWrite, outputTokens: number(usage.output_tokens),
      processedTokens: input + cacheWrite + number(usage.output_tokens), loggedCostUsd: null,
    })];
  });
}

export function parseClaude(content: string, context: ParseContext): UsageRecord[] {
  return parseLines(content).flatMap((value, index) => {
    const row = object(value); const message = object(row?.message); const usage = object(message?.usage);
    const timestamp = isoTimestamp(row?.timestamp ?? message?.timestamp);
    if (!row || row.type !== "assistant" || message?.role !== "assistant" || !usage || !timestamp) return [];
    const cached = number(usage.cache_read_input_tokens); const input = number(usage.input_tokens); const written = number(usage.cache_creation_input_tokens); const output = number(usage.output_tokens);
    return [usageRecord({
      eventKey: `claude:${context.machineId}:${text(message.id, String(index))}`, timestamp,
      agentId: "claude", agentName: "Claude Code", modelProviderId: "anthropic", model: text(message.model),
      uncachedInputTokens: Math.max(0, input - cached), cachedInputTokens: cached, cacheWriteTokens: written,
      outputTokens: output, processedTokens: input + written + output, loggedCostUsd: null,
    })];
  });
}

export function parseGrok(content: string, context: ParseContext): UsageRecord[] {
  return parseLines(content).flatMap((value, index) => {
    const row = object(value); const usage = object(row?.ctx); const timestamp = isoTimestamp(row?.timestamp ?? row?.ts);
    if (!row || row.msg !== "shell.turn.inference_done" || !usage || !timestamp) return [];
    const cached = number(usage.cached_prompt_tokens); const input = number(usage.prompt_tokens); const output = number(usage.completion_tokens) + number(usage.reasoning_tokens);
    return [usageRecord({
      eventKey: `grok:${context.machineId}:${text(row.sid, "unknown")}:${index}`, timestamp,
      agentId: "grok", agentName: "Grok", modelProviderId: "xai", model: text(usage.model, "grok-build"),
      uncachedInputTokens: Math.max(0, input - cached), cachedInputTokens: cached, cacheWriteTokens: 0,
      outputTokens: output, processedTokens: input + output, loggedCostUsd: null,
    })];
  });
}

export function parsePi(content: string, context: ParseContext): UsageRecord[] {
  let sessionId = "unknown";
  return parseLines(content).flatMap((value, index) => {
    const row = object(value); if (!row) return [];
    if (row.type === "session") sessionId = text(row.id, sessionId);
    const message = object(row.message); const usage = object(message?.usage); const timestamp = isoTimestamp(row.timestamp ?? message?.timestamp);
    if (row.type !== "message" || message?.role !== "assistant" || !usage || !timestamp) return [];
    const cached = number(usage.cacheRead); const input = number(usage.input); const written = number(usage.cacheWrite); const output = number(usage.output);
    return [usageRecord({
      eventKey: `pi:${context.machineId}:${sessionId}:${text(row.id, String(index))}`, timestamp,
      agentId: "pi", agentName: "Pi", modelProviderId: normalizeProviderId(text(message.provider)), model: text(message.model ?? message.responseModel),
      uncachedInputTokens: Math.max(0, input - cached), cachedInputTokens: cached, cacheWriteTokens: written,
      outputTokens: output, processedTokens: input + written + output, loggedCostUsd: number(object(usage.cost)?.total) || null,
    })];
  });
}

export function parseOpenCode(records: readonly {
  day: string; modelProviderId: string; model: string; loggedCostUsd: number; inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; outputTokens: number; reasoningTokens: number;
}[], context: ParseContext): UsageRecord[] {
  return records.flatMap((row) => {
    const timestamp = isoTimestamp(`${row.day}T00:00:00Z`); if (!timestamp) return [];
    const provider = normalizeProviderId(row.modelProviderId); const cached = number(row.cachedInputTokens); const input = number(row.inputTokens); const output = number(row.outputTokens) + number(row.reasoningTokens);
    return [usageRecord({
      eventKey: `opencode:${context.machineId}:${row.day}:${provider}:${row.model}`, timestamp,
      agentId: "opencode", agentName: "OpenCode", modelProviderId: provider, model: text(row.model),
      uncachedInputTokens: Math.max(0, input - cached), cachedInputTokens: cached, cacheWriteTokens: number(row.cacheWriteTokens),
      outputTokens: output, processedTokens: input + number(row.cacheWriteTokens) + output, loggedCostUsd: number(row.loggedCostUsd) || null,
    })];
  });
}
