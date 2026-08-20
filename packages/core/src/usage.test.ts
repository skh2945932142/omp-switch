import { describe, expect, it } from "vitest";
import type { SessionIndexEntry, SessionUsageRecord } from "./domain";
import { buildPricingTable, computeCost, findPrice, normalizeUsage, PRICE_UNIT_TOKENS, summarizeUsage } from "./usage";

function entry(overrides: Partial<SessionIndexEntry> = {}): SessionIndexEntry {
  return {
    id: overrides.id ?? "e",
    profile: "default",
    filePath: "C:/s.jsonl",
    offset: 0,
    length: 10,
    startedAt: "2026-08-18T10:00:00Z",
    model: "mimo-v2.5-pro",
    provider: "xiaomi",
    status: "stop",
    usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 1500 },
    cost: 0.001,
    ...overrides,
  };
}

describe("usage normalization", () => {
  it("reads the native OMP usage shape including the nested cost breakdown", () => {
    const { tokens, recordedCost } = normalizeUsage({
      input: 31757, output: 36, cacheRead: 0, cacheWrite: 0, totalTokens: 31793, reasoningTokens: 25,
      cost: { input: 0.013814295, output: 0.00003132, cacheRead: 0, cacheWrite: 0, total: 0.013845615 },
    });
    expect(tokens).toEqual({ input: 31757, output: 36, cacheRead: 0, cacheWrite: 0, reasoning: 25, total: 31793 });
    expect(recordedCost).toBe(0.013845615);
  });

  it("maps provider-specific aliases onto the canonical counters", () => {
    expect(normalizeUsage({ prompt_tokens: 7, completion_tokens: 3 }).tokens)
      .toMatchObject({ input: 7, output: 3, total: 10 });
    expect(normalizeUsage({ cache_read_input_tokens: 4, cache_creation_input_tokens: 2 }).tokens)
      .toMatchObject({ cacheRead: 4, cacheWrite: 2, total: 6 });
  });

  it("derives a missing total and accepts a flat numeric cost", () => {
    const { tokens, recordedCost } = normalizeUsage({ input: 2, output: 3, cost: 0.5 });
    expect(tokens.total).toBe(5);
    expect(recordedCost).toBe(0.5);
  });

  it("sums a cost breakdown that has no total", () => {
    expect(normalizeUsage({ input: 1, cost: { input: 0.25, output: 0.75 } }).recordedCost).toBe(1);
  });

  it("returns zeroed counters for a non-object", () => {
    expect(normalizeUsage(undefined).tokens.total).toBe(0);
    expect(normalizeUsage("nope").recordedCost).toBeUndefined();
  });
});

describe("pricing", () => {
  const models = {
    providers: {
      xiaomi: {
        cost: { input: 1, output: 2 },
        models: [
          { id: "mimo-v2.5-pro", cost: { input: 0.435, output: 0.87, cacheRead: 0.0036 } },
          { id: "cheap" },
        ],
        modelOverrides: { "mimo-v2.5-pro": { cost: { input: 9, output: 9 } } },
      },
      keyless: { models: [{ id: "free", cost: { input: 0, output: 0 } }] },
    },
  };

  it("prefers modelOverrides, then the model, then the provider default", () => {
    const table = buildPricingTable(models);
    expect(table["xiaomi/mimo-v2.5-pro"]).toEqual({ input: 9, output: 9 });
    // A model with no cost of its own falls back to the provider entry.
    expect(findPrice(table, "xiaomi", "cheap")).toEqual({ input: 1, output: 2 });
    expect(table["xiaomi/*"]).toEqual({ input: 1, output: 2 });
  });

  it("lets a user override beat everything from models.yml", () => {
    const table = buildPricingTable(models, { "xiaomi/mimo-v2.5-pro": { input: 0.1 } });
    expect(table["xiaomi/mimo-v2.5-pro"]).toEqual({ input: 0.1 });
  });

  it("keeps a zero price, which is not the same as an absent one", () => {
    const table = buildPricingTable(models);
    expect(computeCost(normalizeUsage({ input: 1000 }).tokens, table["keyless/free"])).toBe(0);
    expect(computeCost(normalizeUsage({ input: 1000 }).tokens, undefined)).toBeUndefined();
  });

  it("prices per million tokens, matching the cost OMP recorded", () => {
    // Derived from a real turn: 31757 input tokens cost 0.013814295, so 0.435 per million.
    expect(computeCost(normalizeUsage({ input: 31757 }).tokens, { input: 0.435 })).toBeCloseTo(0.013814295, 9);
    expect(PRICE_UNIT_TOKENS).toBe(1_000_000);
  });

  it("resolves a model id without a provider only when it is unambiguous", () => {
    const table = { "a/shared": { input: 1 }, "b/shared": { input: 2 }, "c/unique": { input: 3 } };
    expect(findPrice(table, undefined, "shared")).toBeUndefined();
    expect(findPrice(table, undefined, "unique")).toEqual({ input: 3 });
  });
});

describe("usage aggregation", () => {
  const pricing = { "xiaomi/mimo-v2.5-pro": { input: 0.435, output: 0.87 } };

  it("reports recorded and computed cost side by side", () => {
    const report = summarizeUsage([entry()], { pricing });
    expect(report.totals.requests).toBe(1);
    expect(report.totals.recordedCost).toBe(0.001);
    // 1000 input at 0.435/M plus 500 output at 0.87/M.
    expect(report.totals.computedCost).toBeCloseTo(0.00087, 9);
    expect(report.totals.pricedRequests).toBe(1);
  });

  it("ignores events with no tokens so tool results do not inflate the count", () => {
    const report = summarizeUsage([entry({ id: "a" }), entry({ id: "b", offset: 1, usage: undefined, cost: undefined })], { pricing });
    expect(report.totals.requests).toBe(1);
  });

  it("groups by model, provider and day, and counts failures", () => {
    const report = summarizeUsage([
      entry({ id: "a", offset: 0 }),
      entry({ id: "b", offset: 1, status: "aborted" }),
      entry({ id: "c", offset: 2, model: "other", provider: "groq", startedAt: "2026-08-19T01:00:00Z" }),
    ], { pricing });

    expect(report.totals.requests).toBe(3);
    expect(report.totals.failures).toBe(1);
    expect(report.byModel.map((bucket) => bucket.key)).toEqual(expect.arrayContaining(["xiaomi/mimo-v2.5-pro", "groq/other"]));
    expect(report.byProvider.map((bucket) => bucket.key).sort()).toEqual(["groq", "xiaomi"]);
    expect(report.byDay.map((bucket) => bucket.key)).toEqual(["2026-08-18", "2026-08-19"]);
    expect(report.byDay[0].requests).toBe(2);
  });

  it("names models it could not price instead of silently reporting a low total", () => {
    const report = summarizeUsage([entry({ model: "unpriced-model" })], { pricing });
    expect(report.unpriced).toEqual(["xiaomi/unpriced-model"]);
    expect(report.totals.pricedRequests).toBe(0);
    expect(report.totals.computedCost).toBe(0);
  });

  it("filters by inclusive date bounds", () => {
    const entries = [
      entry({ id: "a", offset: 0, startedAt: "2026-08-17T10:00:00Z" }),
      entry({ id: "b", offset: 1, startedAt: "2026-08-18T10:00:00Z" }),
      entry({ id: "c", offset: 2, startedAt: "2026-08-19T10:00:00Z" }),
    ];
    expect(summarizeUsage(entries, { from: "2026-08-18" }).totals.requests).toBe(2);
    expect(summarizeUsage(entries, { to: "2026-08-18" }).totals.requests).toBe(2);
    expect(summarizeUsage(entries, { from: "2026-08-18", to: "2026-08-18" }).totals.requests).toBe(1);
  });

  it("deduplicates the same source location", () => {
    const duplicate = entry({ id: "same", offset: 5 });
    expect(summarizeUsage([duplicate, { ...duplicate }], { pricing }).totals.requests).toBe(1);
  });

  it("tracks the observed time range", () => {
    const report = summarizeUsage([
      entry({ id: "a", offset: 0, startedAt: "2026-08-18T08:00:00Z" }),
      entry({ id: "b", offset: 1, startedAt: "2026-08-18T20:00:00Z" }),
    ], { pricing });
    expect(report.totals.firstAt).toBe("2026-08-18T08:00:00Z");
    expect(report.totals.lastAt).toBe("2026-08-18T20:00:00Z");
  });

  it("keeps the same report when fed compressed session usage records", () => {
    const legacy = entry({ id: "compressed", sourceKey: "session:0" });
    const compressed: SessionUsageRecord = {
      id: "compressed",
      sessionId: "s_fixture",
      profile: "default",
      sourceKey: "session:0",
      startedAt: legacy.startedAt,
      model: legacy.model,
      provider: legacy.provider,
      status: legacy.status,
      tokens: legacy.usage ?? {},
      cost: legacy.cost,
      requestCount: 1,
      failures: 0,
    };
    expect(summarizeUsage([compressed], { pricing }).totals).toEqual(summarizeUsage([legacy], { pricing }).totals);
  });
});
