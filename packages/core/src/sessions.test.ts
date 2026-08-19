import { describe, expect, it } from "vitest";
import { indexSessionJsonl } from "./sessions";

/**
 * These fixtures mirror the shape observed in real `~/.omp/agent/sessions/*.jsonl`: the top level
 * carries only id/timestamp/type/parentId, and everything interesting lives on `message`.
 */
const ASSISTANT_TURN = JSON.stringify({
  type: "message",
  id: "evt-1",
  timestamp: "2026-08-18T10:00:00Z",
  parentId: "evt-0",
  message: {
    role: "assistant",
    api: "openai-completions",
    provider: "xiaomi-token-plan-cn",
    model: "mimo-v2.5-pro",
    stopReason: "toolUse",
    usage: {
      input: 31757,
      output: 36,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 31793,
      reasoningTokens: 25,
      cost: { input: 0.013814295, output: 0.00003132, cacheRead: 0, cacheWrite: 0, total: 0.013845615 },
    },
  },
});

describe("session JSONL index", () => {
  it("reads usage, model, provider and cost from the message object", () => {
    const result = indexSessionJsonl(`${ASSISTANT_TURN}\nnot-json\n`, "C:/sessions/demo.jsonl", "default");

    expect(result.invalidLines).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: "evt-1",
      provider: "xiaomi-token-plan-cn",
      model: "mimo-v2.5-pro",
      status: "toolUse",
      startedAt: "2026-08-18T10:00:00Z",
      offset: 0,
      // usage.cost.total, not a top-level cost field.
      cost: 0.013845615,
      usage: { input: 31757, output: 36, reasoning: 25, total: 31793 },
    });
    expect(result.entries[0].length).toBeGreaterThan(0);
  });

  it("marks an errored or aborted turn through stopReason", () => {
    // `type` is always "message", so it cannot be used to detect failures.
    const failed = JSON.stringify({
      type: "message",
      id: "evt-2",
      timestamp: "2026-08-18T11:00:00Z",
      message: { role: "assistant", model: "m", provider: "p", stopReason: "error", usage: { input: 1, output: 1, cost: { total: 0 } } },
    });
    expect(indexSessionJsonl(failed, "C:/s.jsonl", "default").entries[0].status).toBe("error");
  });

  it("leaves non-assistant events without usage", () => {
    const other = JSON.stringify({ type: "mode_change", id: "evt-3", timestamp: "2026-08-18T12:00:00Z", mode: "plan" });
    const entry = indexSessionJsonl(other, "C:/s.jsonl", "default").entries[0];
    expect(entry.usage).toBeUndefined();
    expect(entry.cost).toBeUndefined();
  });

  it("still understands a flat top-level shape", () => {
    // Kept as a fallback for foreign or older writers.
    const flat = '{"id":"f","timestamp":"2026-08-18T00:00:00Z","model":"openrouter/openai/gpt-4.1","usage":{"input_tokens":10,"output_tokens":5},"cost":0.02}';
    expect(indexSessionJsonl(flat, "C:/s.jsonl", "default").entries[0]).toMatchObject({
      provider: "openrouter",
      cost: 0.02,
      usage: { input: 10, output: 5, total: 15 },
    });
  });

  it("deduplicates repeated event IDs from incremental scans", () => {
    const result = indexSessionJsonl(`${ASSISTANT_TURN}\n${ASSISTANT_TURN}\n`, "C:/sessions/repeated.jsonl", "default");
    expect(result.entries).toHaveLength(1);
  });
});
