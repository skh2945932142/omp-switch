import type { ModelsDocument, SessionIndexEntry, SessionUsageRecord } from "./domain";

/**
 * Canonical token counters. These names are taken from what OMP actually writes to session JSONL
 * (`message.usage`), and they are deliberately the same names OMP uses for prices in `models.yml`
 * (`cost.input`, `cost.cacheRead`, …) so usage and pricing line up key for key.
 */
export interface UsageTokens extends Record<string, number> {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
}

/** Prices are per this many tokens, matching OMP's catalog convention. */
export const PRICE_UNIT_TOKENS = 1_000_000;

export interface ModelPrice {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** Keyed by `provider/model`, plus `provider/*` as a provider-level fallback. */
export type PricingTable = Record<string, ModelPrice>;

/** Aliases seen across providers, mapped onto the canonical counters. */
const TOKEN_ALIASES: Record<keyof UsageTokens, string[]> = {
  input: ["input", "inputTokens", "input_tokens", "prompt_tokens", "promptTokens"],
  output: ["output", "outputTokens", "output_tokens", "completion_tokens", "completionTokens"],
  cacheRead: ["cacheRead", "cacheReadInputTokens", "cache_read_input_tokens", "cached_tokens", "cachedTokens"],
  cacheWrite: ["cacheWrite", "cacheCreationInputTokens", "cache_creation_input_tokens"],
  reasoning: ["reasoningTokens", "reasoning_tokens", "reasoning"],
  total: ["totalTokens", "total_tokens"],
};

export function emptyTokens(): UsageTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberAt(source: Record<string, unknown>, names: string[]): number | undefined {
  for (const name of names) {
    const value = source[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

/**
 * Reads a provider-shaped usage object into canonical counters, and pulls out the cost OMP already
 * computed. OMP writes `usage.cost` as a breakdown object with a `total`; a plain number is also
 * accepted because other shapes exist in the wild.
 */
export function normalizeUsage(raw: unknown): { tokens: UsageTokens; recordedCost?: number } {
  if (!isRecord(raw)) return { tokens: emptyTokens() };
  const tokens = emptyTokens();
  for (const key of Object.keys(TOKEN_ALIASES) as Array<keyof UsageTokens>) {
    tokens[key] = numberAt(raw, TOKEN_ALIASES[key]) ?? 0;
  }
  // `total` is reported by OMP but not by every provider; derive it so sorting never sees a zero.
  if (tokens.total === 0) tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;

  const cost = raw.cost;
  let recordedCost: number | undefined;
  if (typeof cost === "number" && Number.isFinite(cost)) recordedCost = cost;
  else if (isRecord(cost)) {
    const total = numberAt(cost, ["total", "totalCost", "usd"]);
    recordedCost = total ?? ["input", "output", "cacheRead", "cacheWrite"]
      .map((key) => (typeof cost[key] === "number" && Number.isFinite(cost[key] as number) ? (cost[key] as number) : 0))
      .reduce((sum, value) => sum + value, 0);
  }
  return { tokens, recordedCost };
}

function priceOf(cost: unknown): ModelPrice | undefined {
  if (!isRecord(cost)) return undefined;
  const price: ModelPrice = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
    const value = cost[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) price[key] = value;
  }
  return Object.keys(price).length > 0 ? price : undefined;
}

/**
 * Extracts prices from models.yml. A model-level `cost` wins over the provider default, and a
 * `modelOverrides` entry wins over both — the same precedence OMP applies.
 */
export function buildPricingTable(models: ModelsDocument, overrides: PricingTable = {}): PricingTable {
  const table: PricingTable = {};
  for (const [providerId, provider] of Object.entries(models.providers ?? {})) {
    if (!isRecord(provider)) continue;
    const providerPrice = priceOf(provider.cost);
    if (providerPrice) table[`${providerId}/*`] = providerPrice;
    for (const model of Array.isArray(provider.models) ? provider.models : []) {
      if (!isRecord(model) || typeof model.id !== "string") continue;
      const modelPrice = priceOf(model.cost);
      if (modelPrice) table[`${providerId}/${model.id}`] = modelPrice;
    }
    for (const [modelId, override] of Object.entries(isRecord(provider.modelOverrides) ? provider.modelOverrides : {})) {
      const overridePrice = priceOf(isRecord(override) ? override.cost : undefined);
      if (overridePrice) table[`${providerId}/${modelId}`] = overridePrice;
    }
  }
  // User overrides are applied last so a custom price always wins.
  return { ...table, ...overrides };
}

export function findPrice(table: PricingTable, provider: string | undefined, model: string | undefined): ModelPrice | undefined {
  if (!model) return undefined;
  if (provider) return table[`${provider}/${model}`] ?? table[`${provider}/*`];
  // Without a provider, accept a unique match on the model id alone.
  const matches = Object.entries(table).filter(([key]) => key.endsWith(`/${model}`));
  return matches.length === 1 ? matches[0][1] : undefined;
}

export function computeCost(tokens: UsageTokens, price: ModelPrice | undefined): number | undefined {
  if (!price) return undefined;
  const parts: Array<[number, number | undefined]> = [
    [tokens.input, price.input],
    [tokens.output, price.output],
    [tokens.cacheRead, price.cacheRead],
    [tokens.cacheWrite, price.cacheWrite],
  ];
  let total = 0;
  let priced = false;
  for (const [count, rate] of parts) {
    if (rate === undefined) continue;
    priced = true;
    total += (count * rate) / PRICE_UNIT_TOKENS;
  }
  return priced ? total : undefined;
}

export interface UsageBucket {
  key: string;
  requests: number;
  failures: number;
  tokens: UsageTokens;
  /** Cost OMP recorded for the turn. Authoritative when present. */
  recordedCost: number;
  /** Cost derived from models.yml prices, for validation and for turns OMP priced at zero. */
  computedCost: number;
  /** Requests a price could be resolved for, so a partial total is not mistaken for a full one. */
  pricedRequests: number;
  firstAt?: string;
  lastAt?: string;
}

export interface UsageReport {
  totals: UsageBucket;
  byModel: UsageBucket[];
  byProvider: UsageBucket[];
  byDay: UsageBucket[];
  /**
   * Daily series per model key, sorted by day. Lets the UI draw an in-row trend for a single model
   * without a second pass over the raw entries. Missing keys mean the model had no traffic.
   */
  byModelByDay: Record<string, UsageBucket[]>;
  /**
   * Daily series per provider, sorted by day. Same shape as byModelByDay so the per-provider
   * breakdown can draw an identical in-row trend.
   */
  byProviderByDay: Record<string, UsageBucket[]>;
  /** `provider/model` seen with tokens but with no resolvable price. */
  unpriced: string[];
}

export interface SummarizeUsageOptions {
  pricing?: PricingTable;
  /** Inclusive ISO date bounds (`YYYY-MM-DD` compared lexically against the timestamp). */
  from?: string;
  to?: string;
}

const FAILURE_STATUS = /error|fail|abort|cancel|refus/i;

function emptyBucket(key: string): UsageBucket {
  return { key, requests: 0, failures: 0, tokens: emptyTokens(), recordedCost: 0, computedCost: 0, pricedRequests: 0 };
}

function addTo(
  bucket: UsageBucket,
  tokens: UsageTokens,
  recorded: number,
  computed: number | undefined,
  requests: number,
  failures: number,
  firstAt?: string,
  lastAt?: string,
): void {
  bucket.requests += requests;
  bucket.failures += failures;
  for (const key of Object.keys(tokens) as Array<keyof UsageTokens>) bucket.tokens[key] += tokens[key];
  bucket.recordedCost += recorded;
  if (computed !== undefined) {
    bucket.computedCost += computed;
    bucket.pricedRequests += requests;
  }
  if (firstAt) {
    if (!bucket.firstAt || firstAt < bucket.firstAt) bucket.firstAt = firstAt;
  }
  if (lastAt) {
    if (!bucket.lastAt || lastAt > bucket.lastAt) bucket.lastAt = lastAt;
  }
}

export type UsageInput = SessionIndexEntry | SessionUsageRecord;

function isSessionIndexEntry(entry: UsageInput): entry is SessionIndexEntry {
  return "filePath" in entry;
}

/**
 * The new session cache stores assistant usage privately as SessionUsageRecord. Keep the legacy
 * event shape accepted during migration so old callers and tests do not lose their reports.
 */
export function summarizeUsage(entries: UsageInput[], options: SummarizeUsageOptions = {}): UsageReport {
  return summarizeUsageInputs(entries, options);
}

/**
 * Aggregates indexed session entries. Only entries that actually carry tokens count as requests, so
 * the non-assistant events in a session file (tool results, mode changes) do not inflate the counts.
 */
function summarizeUsageInputs(entries: UsageInput[], options: SummarizeUsageOptions = {}): UsageReport {
  const pricing = options.pricing ?? {};
  const totals = emptyBucket("total");
  const byModel = new Map<string, UsageBucket>();
  const byProvider = new Map<string, UsageBucket>();
  const byDay = new Map<string, UsageBucket>();
  // Nested maps: key -> day -> bucket. Collapsed into byModelByDay / byProviderByDay at the end.
  const byModelByDay = new Map<string, Map<string, UsageBucket>>();
  const byProviderByDay = new Map<string, Map<string, UsageBucket>>();
  const unpriced = new Set<string>();
  const seen = new Set<string>();

  for (const entry of entries) {
    const legacy = isSessionIndexEntry(entry) ? entry : undefined;
    const compressed = legacy ? undefined : (entry as SessionUsageRecord);
    const dedupeKey = legacy
      ? legacy.filePath + ":" + (legacy.sourceKey ?? legacy.id)
      : compressed!.sessionId + ":" + (compressed!.sourceKey ?? compressed!.id);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const { tokens } = normalizeUsage(legacy?.usage ?? compressed?.tokens);
    if (tokens.total === 0) continue;

    const startedAt = legacy?.startedAt ?? compressed?.startedAt ?? compressed?.firstAt;
    const model = legacy?.model ?? compressed?.model;
    const provider = legacy?.provider ?? compressed?.provider;
    const status = legacy?.status ?? compressed?.status;
    const cost = legacy?.cost ?? compressed?.cost;
    const requestCount = compressed?.requestCount ?? 1;
    const failures = compressed?.failures ?? (FAILURE_STATUS.test(status ?? "") ? 1 : 0);
    const firstAt = legacy?.startedAt ?? compressed?.firstAt ?? startedAt;
    const lastAt = legacy?.startedAt ?? compressed?.lastAt ?? startedAt;
    const day = startedAt?.slice(0, 10);
    if (options.from && (!day || day < options.from)) continue;
    if (options.to && (!day || day > options.to)) continue;

    const price = findPrice(pricing, provider, model);
    const computed = computeCost(tokens, price);
    const recorded = typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
    const modelKey = provider && model ? provider + "/" + model : model ?? "unknown";

    if (computed === undefined && model) unpriced.add(modelKey);

    addTo(totals, tokens, recorded, computed, requestCount, failures, firstAt, lastAt);
    for (const [map, key] of [[byModel, modelKey], [byProvider, provider ?? "unknown"], [byDay, day ?? "unknown"]] as const) {
      const bucket = map.get(key) ?? emptyBucket(key);
      addTo(bucket, tokens, recorded, computed, requestCount, failures, firstAt, lastAt);
      map.set(key, bucket);
    }
    // Per-model daily bucket, so the UI can draw an in-row trend for one model.
    if (day) {
      const perModel = byModelByDay.get(modelKey) ?? new Map<string, UsageBucket>();
      const dayBucket = perModel.get(day) ?? emptyBucket(day);
      addTo(dayBucket, tokens, recorded, computed, requestCount, failures, firstAt, lastAt);
      perModel.set(day, dayBucket);
      byModelByDay.set(modelKey, perModel);

      const providerKey = provider ?? "unknown";
      const perProvider = byProviderByDay.get(providerKey) ?? new Map<string, UsageBucket>();
      const providerDayBucket = perProvider.get(day) ?? emptyBucket(day);
      addTo(providerDayBucket, tokens, recorded, computed, requestCount, failures, firstAt, lastAt);
      perProvider.set(day, providerDayBucket);
      byProviderByDay.set(providerKey, perProvider);
    }
  }

  const byCost = (left: UsageBucket, right: UsageBucket): number =>
    (right.recordedCost || right.computedCost) - (left.recordedCost || left.computedCost) || right.tokens.total - left.tokens.total;

  // Collapse the nested maps into day-sorted arrays keyed by model / provider.
  const collapse = (nested: Map<string, Map<string, UsageBucket>>): Record<string, UsageBucket[]> => {
    const record: Record<string, UsageBucket[]> = {};
    for (const [key, perKey] of nested) {
      record[key] = Array.from(perKey.values()).sort((left, right) => left.key.localeCompare(right.key));
    }
    return record;
  };

  return {
    totals,
    byModel: Array.from(byModel.values()).sort(byCost),
    byProvider: Array.from(byProvider.values()).sort(byCost),
    byDay: Array.from(byDay.values()).sort((left, right) => left.key.localeCompare(right.key)),
    byModelByDay: collapse(byModelByDay),
    byProviderByDay: collapse(byProviderByDay),
    unpriced: Array.from(unpriced).sort(),
  };
}
