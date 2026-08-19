import { describe, expect, it } from "vitest";
import { indexSessionJsonl, summarizeSessionUsage } from "./sessions";

describe("session JSONL index", () => {
  it("keeps raw locations while indexing usage and model metadata", () => {
    const result = indexSessionJsonl(
      '{"id":"one","timestamp":"2026-08-18T00:00:00Z","model":"openrouter/openai/gpt-4.1","usage":{"input_tokens":10,"output_tokens":5},"cost":0.02}\nnot-json\n{"id":"two","status":"error"}\n',
      "C:/sessions/demo.jsonl",
      "default",
    );
    expect(result.invalidLines).toBe(1);
    expect(result.entries[0]).toMatchObject({ id: "one", provider: "openrouter", offset: 0, usage: { input_tokens: 10 } });
    expect(result.entries[0].length).toBeGreaterThan(0);
    expect(summarizeSessionUsage(result.entries)).toEqual({ usage: { input_tokens: 10, output_tokens: 5 }, cost: 0.02, failures: 1 });
  });

  it("deduplicates repeated event IDs from incremental JSONL scans", () => {
    const result = indexSessionJsonl(
      '{"id":"same","timestamp":"2026-08-18T00:00:00Z","usage":{"input_tokens":2},"cost":0.01}\n{"id":"same","timestamp":"2026-08-18T00:00:00Z","usage":{"input_tokens":2},"cost":0.01}\n',
      "C:/sessions/repeated.jsonl",
      "default",
    );
    expect(result.entries).toHaveLength(1);
    expect(summarizeSessionUsage(result.entries)).toMatchObject({ usage: { input_tokens: 2 }, cost: 0.01 });
  });
});
