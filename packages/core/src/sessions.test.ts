import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexSessionJsonl, quickDiscoverSessionDirectory, readSessionMessages, refreshSessionDirectory } from "./sessions";
import type { SessionFileCache } from "./domain";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

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

function primaryName(id = "019f428b-2bca-7000-8c4f-b21fd95671f4"): string {
  return "2026-08-18T10-00-00-000Z_" + id + ".jsonl";
}

function line(value: unknown): string {
  return JSON.stringify(value) + "\r\n";
}

function assistant(id: string, timestamp: string, content = "assistant", input = 3): Record<string, unknown> {
  return {
    type: "message",
    id,
    timestamp,
    message: {
      role: "assistant",
      content,
      provider: "fixture-provider",
      model: "fixture-model",
      stopReason: "stop",
      usage: { input, output: 2, totalTokens: input + 2, cost: { total: 0.001 } },
    },
  };
}

describe("session summary refresh", () => {
  it("quickly discovers titles without retaining message offsets or indexing attachment JSONL", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-quick-"));
    tempRoots.push(root);
    const file = path.join(root, primaryName());
    await fs.writeFile(file, [
      line({ type: "title", title: "initial", timestamp: "2026-08-18T10:00:00Z" }),
      line({ type: "title_change", title: "latest", timestamp: "2026-08-18T10:01:00Z" }),
      line(assistant("a", "2026-08-18T10:02:00Z")),
    ].join(""), "utf8");
    await fs.mkdir(path.join(root, "project", "attachments"), { recursive: true });
    await fs.writeFile(path.join(root, "project", "attachments", "tool-result.jsonl"), line(assistant("skip", "2026-08-18T10:03:00Z")), "utf8");

    const result = await quickDiscoverSessionDirectory(root, "default");

    expect(result.stats.phase).toBe("quick");
    expect(result.caches).toHaveLength(1);
    expect(result.caches[0]?.summary).toMatchObject({ title: "latest", indexStatus: "partial", messageCount: 0, requestCount: 0 });
    expect(result.stats.diagnostics?.some((diagnostic) => diagnostic.code === "session-files-skipped")).toBe(true);
    const reused = await quickDiscoverSessionDirectory(root, "default", result.caches);
    expect(reused.stats.reused).toBe(1);
    expect(reused.stats.scannedBytes).toBe(0);
  });

  it("creates one summary per verified primary file and skips attachments/unknown jsonl", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-fixture-"));
    tempRoots.push(root);
    const primary = path.join(root, primaryName());
    await fs.writeFile(primary, [
      line({ type: "title", title: "initial", timestamp: "2026-08-18T10:00:00Z" }),
      line({ type: "message", id: "u", timestamp: "2026-08-18T10:01:00Z", message: { role: "user", content: "hello" } }),
      line(assistant("a", "2026-08-18T10:02:00Z")),
      line({ type: "title_change", title: "latest", timestamp: "2026-08-18T10:03:00Z" }),
      line({ type: "toolResult", id: "tool", timestamp: "2026-08-18T10:04:00Z", content: "tool" }),
      "not-json\r\n",
      JSON.stringify(assistant("partial", "2026-08-18T10:05:00Z")),
    ].join(""), "utf8");
    await fs.mkdir(path.join(root, "project", "attachments"), { recursive: true });
    await fs.writeFile(path.join(root, "project", primaryName("019f4310-90a6-7000-9b0e-2dbd359cf6dc")), line(assistant("b", "2026-08-19T10:00:00Z")), "utf8");
    await fs.writeFile(path.join(root, "project", "tool-result.jsonl"), line(assistant("skip", "2026-08-19T10:00:00Z")), "utf8");
    await fs.writeFile(path.join(root, "project", "attachments", primaryName("019f453e-55fe-7000-9224-96af997e4370")), line(assistant("skip2", "2026-08-19T10:00:00Z")), "utf8");
    await fs.writeFile(path.join(root, "unknown.jsonl"), line(assistant("skip3", "2026-08-19T10:00:00Z")), "utf8");

    const result = await refreshSessionDirectory(root, "default");
    expect(result.caches).toHaveLength(2);
    const first = result.caches.find((cache) => cache.relativePath === primaryName());
    expect(first?.summary).toMatchObject({ title: "latest", messageCount: 2, requestCount: 1, fileSize: expect.any(Number) });
    expect(first?.summary.id).not.toContain(root);
    expect(first?.usage).toHaveLength(1);
    expect(first?.invalidLines).toBe(1);
    expect(result.stats.skipped).toBeGreaterThanOrEqual(2);
  });

  it("reuses unchanged files and parses only an appended complete tail", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-incremental-"));
    tempRoots.push(root);
    const file = path.join(root, primaryName());
    await fs.writeFile(file, line(assistant("a", "2026-08-18T10:00:00Z")), "utf8");
    const first = await refreshSessionDirectory(root, "default");
    const second = await refreshSessionDirectory(root, "default", first.caches);
    expect(second.stats.reused).toBe(1);
    expect(second.stats.scannedBytes).toBe(0);
    await fs.appendFile(file, line(assistant("b", "2026-08-18T11:00:00Z")), "utf8");
    const third = await refreshSessionDirectory(root, "default", second.caches);
    expect(third.stats.changed).toBe(1);
    expect(third.caches[0].summary.requestCount).toBe(2);
    expect(third.caches[0].usage).toHaveLength(1);
    expect(third.caches[0].usage[0].requestCount).toBe(2);
    expect(third.stats.scannedBytes).toBeGreaterThan(0);
  });

  it("falls back to a full rebuild after truncation and keeps old cache on missing root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-stale-"));
    tempRoots.push(root);
    const file = path.join(root, primaryName());
    await fs.writeFile(file, line(assistant("a", "2026-08-18T10:00:00Z")) + line(assistant("b", "2026-08-18T11:00:00Z")), "utf8");
    const first = await refreshSessionDirectory(root, "default");
    await fs.writeFile(file, line(assistant("c", "2026-08-18T12:00:00Z")), "utf8");
    const rebuilt = await refreshSessionDirectory(root, "default", first.caches);
    expect(rebuilt.stats.rebuilt).toBe(1);
    expect(rebuilt.caches[0].summary.requestCount).toBe(1);
    await fs.rm(root, { recursive: true, force: true });
    const stale = await refreshSessionDirectory(root, "default", rebuilt.caches);
    expect(stale.stats.rootMissing).toBe(true);
    expect(stale.caches[0].summary.stale).toBe(true);
  });

  it("returns latest-first message pages with a fingerprint-bound cursor and truncates previews", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-pages-"));
    tempRoots.push(root);
    const file = path.join(root, primaryName());
    const huge = "x".repeat(5000);
    await fs.writeFile(file, [
      line({ type: "message", id: "u", timestamp: "2026-08-18T09:00:00Z", message: { role: "user", content: "user" } }),
      line(assistant("a", "2026-08-18T10:00:00Z", huge)),
      line({ type: "message", id: "t", timestamp: "2026-08-18T11:00:00Z", message: { role: "tool", content: "tool" } }),
      line(assistant("b", "2026-08-18T12:00:00Z", "last")),
    ].join(""), "utf8");
    const refreshed = await refreshSessionDirectory(root, "default");
    const cache = refreshed.caches[0] as SessionFileCache;
    const first = await readSessionMessages(root, cache, { limit: 2 });
    expect(first.messages.map((message) => message.id)).toEqual(["b", "t"]);
    expect(first.messages[0].role).toBe("assistant");
    expect(first.messages[1].role).toBe("tool");
    expect(first.nextCursor).toBeTruthy();
    const second = await readSessionMessages(root, cache, { limit: 2, cursor: first.nextCursor });
    expect(second.messages.map((message) => message.id)).toEqual(["a", "u"]);
    expect(second.messages.find((message) => message.id === "a")?.text.length).toBe(4096);
    await expect(readSessionMessages(root, { ...cache, fileSize: cache.fileSize + 1 }, { cursor: first.nextCursor })).rejects.toThrow(/changed|cursor/i);
    await expect(readSessionMessages(root, { ...cache, relativePath: "../outside/" + primaryName() }, {})).rejects.toThrow(/path|root/i);
  });

  it("reads message pages by scanning backwards when cached message offsets are absent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-reverse-pages-"));
    tempRoots.push(root);
    const file = path.join(root, primaryName());
    await fs.writeFile(file, [
      line({ type: "message", timestamp: "2026-08-18T09:00:00Z", message: { role: "user", content: "first" } }),
      line({ type: "custom", timestamp: "2026-08-18T10:00:00Z", content: "ignore" }),
      line({ type: "message", id: "last", timestamp: "2026-08-18T11:00:00Z", message: { role: "assistant", content: "last" } }),
    ].join(""), "utf8");
    const refreshed = await refreshSessionDirectory(root, "default");
    const cache = refreshed.caches[0] as SessionFileCache;

    const first = await readSessionMessages(root, cache, { limit: 1 });
    expect(first.messages.map((message) => message.id)).toEqual(["last"]);
    expect(first.nextCursor).toBeTruthy();

    const second = await readSessionMessages(root, cache, { limit: 1, cursor: first.nextCursor });
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0]?.role).toBe("user");
    expect(second.messages[0]?.id).toMatch(/^m_[a-f0-9]{24}$/);
  });

  it("can show messages from a quick-discovery partial cache", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-partial-pages-"));
    tempRoots.push(root);
    const file = path.join(root, primaryName());
    await fs.writeFile(file, [line(assistant("old", "2026-08-18T10:00:00Z")), line(assistant("new", "2026-08-18T11:00:00Z"))].join(""), "utf8");
    const partial = (await quickDiscoverSessionDirectory(root, "default")).caches[0] as SessionFileCache;

    const page = await readSessionMessages(root, partial, { limit: 1 });

    expect(page.messages.map((message) => message.id)).toEqual(["new"]);
  });

  it("rejects a tampered core message cursor", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-cursor-"));
    tempRoots.push(root);
    const file = path.join(root, primaryName());
    await fs.writeFile(file, [line(assistant("first", "2026-08-18T10:00:00Z")), line(assistant("last", "2026-08-18T11:00:00Z"))].join(""), "utf8");
    const cache = (await refreshSessionDirectory(root, "default")).caches[0] as SessionFileCache;
    const page = await readSessionMessages(root, cache, { limit: 1 });
    const cursor = page.nextCursor as string;
    const tampered = cursor.slice(0, -1) + (cursor.endsWith("A") ? "B" : "A");

    await expect(readSessionMessages(root, cache, { limit: 1, cursor: tampered })).rejects.toThrow(/invalid.*cursor/i);
    await expect(readSessionMessages(root, cache, { limit: 1, cursor: cursor + ".extra" })).rejects.toThrow(/invalid.*cursor/i);
  });

  it("handles CRLF records across 64 KiB boundaries and keeps UTF-8 previews valid", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-boundary-"));
    tempRoots.push(root);
    const file = path.join(root, primaryName());
    const wide = "前".repeat(30_000);
    await fs.writeFile(file, [
      line({ type: "message", id: "old", timestamp: "2026-08-18T09:00:00Z", message: { role: "user", content: wide } }),
      line(assistant("new", "2026-08-18T10:00:00Z", "最新")),
    ].join(""), "utf8");
    const cache = (await refreshSessionDirectory(root, "default")).caches[0] as SessionFileCache;
    const page = await readSessionMessages(root, cache, { limit: 2 });

    expect(page.messages.map((message) => message.id)).toEqual(["new", "old"]);
    const old = page.messages[1];
    expect(old?.truncated).toBe(true);
    expect(Buffer.byteLength(old?.text ?? "", "utf8")).toBeLessThanOrEqual(4096);
    expect(old?.text).not.toContain("\uFFFD");
  });
});
