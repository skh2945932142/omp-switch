import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  SessionFileCache,
  SessionIndexEntry,
  SessionMessagePage,
  SessionMessagePreview,
  SessionRefreshResult,
  SessionRefreshStats,
  SessionSummary,
  SessionUsageRecord,
} from "./domain";
import { normalizeUsage } from "./usage";

export interface SessionIndexResult {
  entries: SessionIndexEntry[];
  invalidLines: number;
}

export interface SessionRefreshOptions {
  force?: boolean;
}

export interface ReadSessionMessagesOptions {
  limit?: number;
  cursor?: string;
}

const CHUNK_SIZE = 64 * 1024;
const HEAD_BYTES = 4096;
const MAX_MESSAGE_PREVIEW_BYTES = 4096;
const FAILURE_STATUS = /error|fail|abort|cancel|refus/i;
const PRIMARY_SESSION_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}[-:]\d{3}Z_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const CURSOR_SECRET = crypto.randomBytes(32);

export function isPrimarySessionFileName(name: string): boolean {
  return PRIMARY_SESSION_NAME.test(name);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function pickString(sources: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const source of sources) {
    const value = firstString(source, keys);
    if (value) return value;
  }
  return undefined;
}

function normalizeRelative(value: string): string {
  return value.split(path.sep).join("/").replaceAll("\\", "/");
}

function stableSessionId(profile: string, relativePath: string): string {
  const digest = crypto.createHash("sha256").update(profile + "\0" + normalizeRelative(relativePath)).digest("hex").slice(0, 24);
  return "s_" + digest;
}

function stableMessageId(sessionId: string, offset: number): string {
  const digest = crypto.createHash("sha256").update(sessionId + "\0" + String(offset)).digest("hex").slice(0, 24);
  return "m_" + digest;
}

function emptyTokens(): Record<string, number> {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 };
}

function cloneTokens(tokens: Record<string, number>): Record<string, number> {
  return { ...emptyTokens(), ...tokens };
}

function addTokens(target: Record<string, number>, source: Record<string, number>): void {
  for (const key of Object.keys(source)) target[key] = (target[key] ?? 0) + (source[key] ?? 0);
}

function timestampOf(record: Record<string, unknown>, message: Record<string, unknown>): string | undefined {
  return firstString(record, ["timestamp", "createdAt", "time"]) ?? firstString(message, ["timestamp", "createdAt", "time"]);
}

function messageRole(record: Record<string, unknown>, message: Record<string, unknown>): string {
  return firstString(message, ["role"]) ?? firstString(record, ["role"]) ?? "unknown";
}

function contentToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(contentToText).filter(Boolean).join("\n");
  const record = asRecord(value);
  if (!record) return "";
  return firstString(record, ["text", "content", "value", "output"]) ?? "";
}

function previewText(record: Record<string, unknown>, message: Record<string, unknown>): { text: string; truncated?: boolean } {
  const raw = contentToText(message.content) || contentToText(record.content) || contentToText(message.text);
  const bytes = Buffer.from(raw, "utf8");
  if (bytes.length <= MAX_MESSAGE_PREVIEW_BYTES) return { text: raw };
  let end = MAX_MESSAGE_PREVIEW_BYTES;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
}

function summaryFor(profile: string, id: string, fileSize: number): SessionSummary {
  return {
    id,
    profile,
    messageCount: 0,
    requestCount: 0,
    failures: 0,
    tokens: emptyTokens(),
    cost: 0,
    fileSize,
    indexedAt: new Date().toISOString(),
    stale: false,
    indexStatus: "ready",
  };
}

function extractTitle(record: Record<string, unknown>): string | undefined {
  if (record.type !== "title" && record.type !== "title_change") return undefined;
  const message = asRecord(record.message) ?? {};
  return firstString(record, ["title", "name"]) ?? firstString(message, ["title", "content"]);
}

function makeUsageRecord(
  record: Record<string, unknown>,
  message: Record<string, unknown>,
  profile: string,
  sessionId: string,
  relativePath: string,
  offset: number,
): SessionUsageRecord | undefined {
  if (messageRole(record, message) !== "assistant") return undefined;
  const rawUsage = asRecord(message.usage) ?? asRecord(record.usage);
  if (!rawUsage) return undefined;
  const normalized = normalizeUsage(rawUsage);
  const status = pickString([message, record], ["stopReason", "status", "event"]);
  const timestamp = timestampOf(record, message);
  return {
    id: firstString(record, ["id", "eventId", "messageId"]) ?? sessionId + ":" + offset,
    sessionId,
    profile,
    startedAt: timestamp,
    firstAt: timestamp,
    lastAt: timestamp,
    model: pickString([message, record], ["model", "modelId"]),
    provider: pickString([message, record], ["provider", "providerId"]),
    status,
    tokens: normalized.tokens,
    cost: normalized.recordedCost,
    requestCount: 1,
    failures: FAILURE_STATUS.test(status ?? "") ? 1 : 0,
    sourceKey: relativePath + ":" + offset,
  };
}

function applyRecord(cache: SessionFileCache, record: Record<string, unknown>, offset: number): void {
  const message = asRecord(record.message) ?? {};
  const timestamp = timestampOf(record, message);
  if (timestamp) {
    if (!cache.summary.startedAt || timestamp < cache.summary.startedAt) cache.summary.startedAt = timestamp;
    if (!cache.summary.lastActiveAt || timestamp > cache.summary.lastActiveAt) cache.summary.lastActiveAt = timestamp;
  }
  const title = extractTitle(record);
  if (title) cache.summary.title = title;
  if (record.type !== "message") return;

  cache.summary.messageCount += 1;

  const model = pickString([message, record], ["model", "modelId"]);
  const provider = pickString([message, record], ["provider", "providerId"])
    ?? (model?.includes("/") ? model.slice(0, model.indexOf("/")) : undefined);
  const status = pickString([message, record], ["stopReason", "status", "event"]);
  if (model) cache.summary.model = model;
  if (provider) cache.summary.provider = provider;
  if (status) cache.summary.status = status;

  const usage = makeUsageRecord(record, message, cache.profile, cache.id, cache.relativePath, offset);
  if (!usage) return;
  usage.model ??= model;
  usage.provider ??= provider;
  cache.usage.push(usage);
  cache.summary.requestCount += 1;
  cache.summary.failures += usage.failures;
  addTokens(cache.summary.tokens, usage.tokens);
  cache.summary.cost += usage.cost ?? 0;
}

async function headHash(filePath: string, maxBytes = HEAD_BYTES): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    let bytesRead = 0;
    while (bytesRead < maxBytes) {
      const result = await handle.read(buffer, bytesRead, maxBytes - bytesRead, bytesRead);
      if (result.bytesRead <= 0) break;
      bytesRead += result.bytesRead;
    }
    return crypto.createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("hex");
  } finally {
    await handle.close();
  }
}

interface ParseRangeResult {
  invalidLines: number;
  completeBytes: number;
  scannedBytes: number;
}

async function parseRange(
  filePath: string,
  start: number,
  end: number,
  onRecord: (record: Record<string, unknown>, offset: number) => void,
): Promise<ParseRangeResult> {
  const handle = await fs.open(filePath, "r");
  let position = start;
  let lineStart = start;
  let pendingParts: Buffer[] = [];
  let pendingBytes = 0;
  let invalidLines = 0;
  let scannedBytes = 0;
  try {
    while (position < end) {
      const size = Math.min(CHUNK_SIZE, end - position);
      const chunk = Buffer.alloc(size);
      const result = await handle.read(chunk, 0, size, position);
      if (result.bytesRead <= 0) break;
      position += result.bytesRead;
      scannedBytes += result.bytesRead;
      const bytes = chunk.subarray(0, result.bytesRead);
      let segmentStart = 0;
      while (segmentStart < bytes.length) {
        const newline = bytes.indexOf(0x0a, segmentStart);
        if (newline < 0) {
          const tail = bytes.subarray(segmentStart);
          if (tail.length) {
            pendingParts.push(tail);
            pendingBytes += tail.length;
          }
          break;
        }
        const segment = bytes.subarray(segmentStart, newline);
        const lineLength = pendingBytes + segment.length + 1;
        const line = pendingBytes
          ? Buffer.concat([...pendingParts, segment], pendingBytes + segment.length)
          : segment;
        const text = line.toString("utf8").replace(/\r$/, "").trim();
        if (text) {
          try {
            const parsed = asRecord(JSON.parse(text));
            if (!parsed) throw new Error("Session line must be an object");
            onRecord(parsed, lineStart);
          } catch {
            invalidLines += 1;
          }
        }
        lineStart += lineLength;
        pendingParts = [];
        pendingBytes = 0;
        segmentStart = newline + 1;
      }
    }
  } finally {
    await handle.close();
  }
  return { invalidLines, completeBytes: lineStart, scannedBytes };
}

async function discoverSessionFiles(root: string): Promise<{ files: string[]; skipped: number }> {
  const files: string[] = [];
  let skipped = 0;
  const rootEntries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isFile()) {
      if (isPrimarySessionFileName(entry.name)) files.push(path.join(root, entry.name));
      else if (entry.name.endsWith(".jsonl")) skipped += 1;
      continue;
    }
    if (!entry.isDirectory()) {
      skipped += 1;
      continue;
    }
    let grouped: import("node:fs").Dirent[] = [];
    try {
      grouped = await fs.readdir(path.join(root, entry.name), { withFileTypes: true });
    } catch {
      skipped += 1;
      continue;
    }
    for (const child of grouped) {
      if (child.isFile() && isPrimarySessionFileName(child.name)) files.push(path.join(root, entry.name, child.name));
      else skipped += 1;
    }
  }
  return { files: files.sort(), skipped };
}

function scanDiagnostics(stats: SessionRefreshStats): SessionRefreshStats {
  const diagnostics = [];
  if (stats.rootMissing) diagnostics.push({ severity: "warning" as const, code: "session-root-missing", message: "会话目录不存在，已保留上次有效缓存。" });
  else if (stats.discovered === 0) diagnostics.push({ severity: "info" as const, code: "session-layout-unrecognized", message: "未发现符合当前 OMP 主会话命名规则的文件。" });
  if (stats.skipped > 0) diagnostics.push({ severity: "info" as const, code: "session-files-skipped", message: "已跳过 " + stats.skipped + " 个非主会话文件或目录。" });
  if (stats.errors > 0) diagnostics.push({ severity: "warning" as const, code: "session-files-unreadable", message: stats.errors + " 个会话文件无法读取，已保留可用缓存。" });
  return { ...stats, diagnostics };
}

export async function quickDiscoverSessionDirectory(
  root: string,
  profile: string,
  previousCaches: SessionFileCache[] = [],
): Promise<SessionRefreshResult> {
  const priorByPath = new Map(previousCaches.filter((cache) => cache.profile === profile).map((cache) => [normalizeRelative(cache.relativePath), cache]));
  let discovered: { files: string[]; skipped: number };
  try {
    discovered = await discoverSessionFiles(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        caches: previousCaches.filter((cache) => cache.profile === profile).map((cache) => {
          const stale = cloneCache(cache);
          stale.summary = { ...stale.summary, stale: true, indexStatus: "stale" };
          return stale;
        }),
        stats: scanDiagnostics({ phase: "quick", discovered: 0, skipped: 0, reused: 0, changed: 0, rebuilt: 0, scannedBytes: 0, invalidLines: 0, errors: 0, rootMissing: true }),
      };
    }
    throw error;
  }
  const stats: SessionRefreshStats = { phase: "quick", discovered: discovered.files.length, skipped: discovered.skipped, reused: 0, changed: 0, rebuilt: 0, scannedBytes: 0, invalidLines: 0, errors: 0 };
  const caches: SessionFileCache[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= discovered.files.length) return;
      const filePath = discovered.files[index];
      const relativePath = normalizeRelative(path.relative(root, filePath));
      const previous = priorByPath.get(relativePath);
      try {
        const stat = await fs.stat(filePath);
        if (previous && (previous.summary.indexStatus === "ready" || previous.summary.indexStatus === "partial") && previous.fileSize === stat.size && previous.mtimeMs === stat.mtimeMs && previous.completeBytes <= stat.size) {
          const reused = cloneCache(previous);
          reused.summary.stale = false;
          reused.summary.fileSize = stat.size;
          reused.mtimeMs = stat.mtimeMs;
          caches.push(reused);
          stats.reused += 1;
          continue;
        }
        const hash = await headHash(filePath);
        if (previous && (previous.summary.indexStatus === "ready" || previous.summary.indexStatus === "partial") && previous.fileSize === stat.size && previous.headHash === hash && previous.completeBytes <= stat.size) {
          const reused = cloneCache(previous);
          reused.summary.stale = false;
          reused.summary.fileSize = stat.size;
          reused.mtimeMs = stat.mtimeMs;
          caches.push(reused);
          stats.reused += 1;
          continue;
        }
        const id = stableSessionId(profile, relativePath);
        const partial: SessionFileCache = {
          id,
          profile,
          relativePath,
          fileSize: stat.size,
          mtimeMs: stat.mtimeMs,
          headHash: hash,
          completeBytes: 0,
          invalidLines: 0,
          summary: { ...summaryFor(profile, id, stat.size), indexStatus: "partial" },
          usage: [],
        };
        const parsed = await parseRange(filePath, 0, Math.min(stat.size, CHUNK_SIZE), (record, offset) => applyRecord(partial, record, offset));
        partial.summary.messageCount = 0;
        partial.summary.requestCount = 0;
        partial.summary.failures = 0;
        partial.summary.tokens = emptyTokens();
        partial.summary.cost = 0;
        partial.usage = [];
        partial.invalidLines = parsed.invalidLines;
        partial.summary.indexedAt = new Date().toISOString();
        caches.push(partial);
        stats.changed += previous ? 1 : 0;
        stats.rebuilt += previous ? 0 : 1;
        stats.scannedBytes += parsed.scannedBytes + Math.min(stat.size, HEAD_BYTES);
        stats.invalidLines += parsed.invalidLines;
      } catch {
        stats.errors += 1;
        if (previous) {
          const stale = cloneCache(previous);
          stale.summary = { ...stale.summary, stale: true, indexStatus: "stale" };
          caches.push(stale);
        }
      }
    }
  }
  await Promise.all([worker(), worker()]);
  for (const previous of previousCaches.filter((cache) => cache.profile === profile)) {
    if (!caches.some((cache) => cache.id === previous.id)) {
      const stale = cloneCache(previous);
      stale.summary = { ...stale.summary, stale: true, indexStatus: "stale" };
      caches.push(stale);
    }
  }
  caches.sort((left, right) => (right.summary.lastActiveAt ?? right.summary.startedAt ?? "").localeCompare(left.summary.lastActiveAt ?? left.summary.startedAt ?? ""));
  return { caches, stats: scanDiagnostics(stats) };
}

function cloneCache(cache: SessionFileCache): SessionFileCache {
  return {
    ...cache,
    summary: { ...cache.summary, tokens: cloneTokens(cache.summary.tokens) },
    usage: cache.usage.map((item) => ({ ...item, tokens: cloneTokens(item.tokens) })),
  };
}

function compressUsage(cache: SessionFileCache): SessionUsageRecord[] {
  const grouped = new Map<string, SessionUsageRecord>();
  for (const record of cache.usage) {
    const day = (record.startedAt ?? record.firstAt ?? "unknown").slice(0, 10);
    const key = day + "\0" + (record.provider ?? "") + "\0" + (record.model ?? "");
    const current = grouped.get(key);
    if (!current) {
      const digest = crypto.createHash("sha256").update(cache.id + "\0" + key).digest("hex").slice(0, 24);
      grouped.set(key, {
        ...record,
        id: "u_" + digest,
        sourceKey: "aggregate:" + digest,
        tokens: cloneTokens(record.tokens),
        requestCount: Math.max(1, record.requestCount),
        failures: record.failures,
      });
      continue;
    }
    addTokens(current.tokens, record.tokens);
    current.requestCount += Math.max(1, record.requestCount);
    current.failures += record.failures;
    current.cost = (current.cost ?? 0) + (record.cost ?? 0);
    if (record.firstAt && (!current.firstAt || record.firstAt < current.firstAt)) current.firstAt = record.firstAt;
    if (record.lastAt && (!current.lastAt || record.lastAt > current.lastAt)) current.lastAt = record.lastAt;
    if (record.status) current.status = record.status;
  }
  return Array.from(grouped.values()).sort((left, right) => (right.lastAt ?? right.startedAt ?? "").localeCompare(left.lastAt ?? left.startedAt ?? ""));
}

async function indexOneFile(
  filePath: string,
  root: string,
  profile: string,
  previous: SessionFileCache | undefined,
  force: boolean,
): Promise<{ cache: SessionFileCache; mode: "reused" | "changed" | "rebuilt"; scannedBytes: number; invalidLines: number }> {
  const relativePath = normalizeRelative(path.relative(root, filePath));
  const before = await fs.stat(filePath);
  const id = stableSessionId(profile, relativePath);
  if (!force && previous && previous.summary.indexStatus === "ready" && previous.id === id && previous.fileSize === before.size && previous.mtimeMs === before.mtimeMs && previous.completeBytes <= before.size) {
    const reused = cloneCache(previous);
    reused.summary.fileSize = before.size;
    reused.summary.stale = false;
    reused.summary.indexStatus = "ready";
    reused.mtimeMs = before.mtimeMs;
    return { cache: reused, mode: "reused", scannedBytes: 0, invalidLines: 0 };
  }
  const currentHead = await headHash(filePath);
  const previousHead = previous ? await headHash(filePath, Math.min(HEAD_BYTES, previous.fileSize)) : currentHead;
  if (!force && previous && previous.summary.indexStatus === "ready" && previous.id === id && previous.fileSize === before.size && previous.headHash === currentHead && previous.completeBytes <= before.size) {
    const reused = cloneCache(previous);
    reused.summary.fileSize = before.size;
    reused.mtimeMs = before.mtimeMs;
    reused.summary.stale = false;
    reused.summary.indexStatus = "ready";
    return { cache: reused, mode: "reused", scannedBytes: 0, invalidLines: 0 };
  }

  const append = !force && previous && previous.summary.indexStatus === "ready" && previous.id === id && before.size > previous.fileSize
    && previous.headHash === previousHead && previous.completeBytes <= previous.fileSize;
  const cache: SessionFileCache = append && previous
    ? cloneCache(previous)
    : {
      id,
      profile,
      relativePath,
      fileSize: before.size,
      mtimeMs: before.mtimeMs,
      headHash: currentHead,
      completeBytes: 0,
      invalidLines: 0,
      summary: summaryFor(profile, id, before.size),
      usage: [],
    };
  const start = append && previous ? previous.completeBytes : 0;
  const parsed = await parseRange(filePath, start, before.size, (record, offset) => applyRecord(cache, record, offset));
  cache.usage = compressUsage(cache);
  cache.fileSize = before.size;
  cache.mtimeMs = before.mtimeMs;
  cache.headHash = currentHead;
  cache.completeBytes = parsed.completeBytes;
  cache.invalidLines = append && previous ? previous.invalidLines + parsed.invalidLines : parsed.invalidLines;
  cache.summary.fileSize = before.size;
  cache.summary.indexedAt = new Date().toISOString();
  cache.summary.stale = false;
  cache.summary.indexStatus = "ready";
  const after = await fs.stat(filePath);
  const afterHead = await headHash(filePath);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || afterHead !== currentHead) throw new Error("Session file changed during indexing");
  return {
    cache,
    mode: append ? "changed" : "rebuilt",
    scannedBytes: parsed.scannedBytes + (append ? 0 : Math.min(before.size, HEAD_BYTES)),
    invalidLines: parsed.invalidLines,
  };
}

export async function refreshSessionDirectory(
  root: string,
  profile: string,
  previousCaches: SessionFileCache[] = [],
  options: SessionRefreshOptions = {},
): Promise<SessionRefreshResult> {
  const prior = previousCaches.filter((cache) => cache.profile === profile);
  const previousByPath = new Map(prior.map((cache) => [normalizeRelative(cache.relativePath), cache]));
  let discovered: { files: string[]; skipped: number };
  try {
    discovered = await discoverSessionFiles(root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
      return {
        caches: prior.map((cache) => {
          const stale = cloneCache(cache);
          stale.summary = { ...stale.summary, stale: true, indexStatus: "stale" };
          return stale;
        }),
        stats: scanDiagnostics({ phase: "complete", discovered: 0, skipped: 0, reused: 0, changed: 0, rebuilt: 0, scannedBytes: 0, invalidLines: 0, errors: code === "ENOENT" ? 0 : 1, rootMissing: code === "ENOENT" }),
      };
    }
    throw error;
  }

  const stats: SessionRefreshStats = {
    phase: "complete",
    discovered: discovered.files.length,
    skipped: discovered.skipped,
    reused: 0,
    changed: 0,
    rebuilt: 0,
    scannedBytes: 0,
    invalidLines: 0,
    errors: 0,
  };
  const results: SessionFileCache[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= discovered.files.length) return;
      const filePath = discovered.files[index];
      const relativePath = normalizeRelative(path.relative(root, filePath));
      const previous = previousByPath.get(relativePath);
      try {
        const result = await indexOneFile(filePath, root, profile, previous, Boolean(options.force));
        results.push(result.cache);
        stats[result.mode] += 1;
        stats.scannedBytes += result.scannedBytes;
        stats.invalidLines += result.invalidLines;
      } catch {
        stats.errors += 1;
        if (previous) {
          const stale = cloneCache(previous);
          stale.summary = { ...stale.summary, stale: true, indexStatus: "stale" };
          results.push(stale);
        }
      }
    }
  }
  await Promise.all([worker(), worker()]);
  for (const previous of prior) {
    if (!results.some((cache) => cache.id === previous.id)) {
      const stale = cloneCache(previous);
      stale.summary = { ...stale.summary, stale: true, indexStatus: "stale" };
      results.push(stale);
    }
  }
  results.sort((left, right) => (right.summary.lastActiveAt ?? right.summary.startedAt ?? "").localeCompare(left.summary.lastActiveAt ?? left.summary.startedAt ?? ""));
  return { caches: results, stats: scanDiagnostics(stats) };
}

function legacyEvent(record: Record<string, unknown>, filePath: string, profile: string, offset: number, length: number): SessionIndexEntry {
  const message = asRecord(record.message) ?? {};
  const metadata = asRecord(record.metadata) ?? {};
  const sources = [message, record, metadata];
  const model = pickString(sources, ["model", "modelId"]);
  const provider = pickString(sources, ["provider", "providerId"])
    ?? (model?.includes("/") ? model.slice(0, model.indexOf("/")) : undefined);
  const rawUsage = asRecord(message.usage) ?? asRecord(record.usage) ?? asRecord(metadata.usage);
  const normalized = normalizeUsage(rawUsage);
  return {
    id: firstString(record, ["id", "eventId", "messageId"]) ?? filePath + ":" + offset,
    sourceKey: filePath + ":" + offset,
    profile,
    filePath,
    offset,
    length,
    startedAt: timestampOf(record, message),
    model,
    provider,
    status: pickString(sources, ["stopReason", "status", "event"]) ?? firstString(record, ["type"]),
    usage: rawUsage ? normalized.tokens : undefined,
    cost: normalized.recordedCost ?? firstNumber(record, ["cost", "totalCost"]) ?? firstNumber(metadata, ["cost", "totalCost"]),
  };
}

export function indexSessionJsonl(raw: string, filePath: string, profile: string): SessionIndexResult {
  const entries: SessionIndexEntry[] = [];
  let invalidLines = 0;
  let offset = 0;
  for (const lineWithEnding of raw.matchAll(/.*(?:\r?\n|$)/g)) {
    const source = lineWithEnding[0];
    if (!source) continue;
    const line = source.replace(/\r?\n$/, "").trim();
    const length = Buffer.byteLength(source);
    if (!line) {
      offset += length;
      continue;
    }
    try {
      const parsed = asRecord(JSON.parse(line));
      if (!parsed) throw new Error("Session line must be an object");
      entries.push(legacyEvent(parsed, filePath, profile, offset, length));
    } catch {
      invalidLines += 1;
    }
    offset += length;
  }
  const seen = new Set<string>();
  return {
    entries: entries.filter((entry) => {
      const key = entry.filePath + ":" + entry.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    invalidLines,
  };
}

function encodeCursor(value: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const mac = crypto.createHmac("sha256", CURSOR_SECRET).update(payload).digest("base64url");
  return payload + "." + mac;
}

function decodeCursor(value: string): Record<string, unknown> {
  try {
    const parts = value.split(".");
    if (parts.length !== 2) throw new Error("Malformed cursor");
    const [payload, mac] = parts;
    if (!payload || !mac) throw new Error("Malformed cursor");
    const expected = crypto.createHmac("sha256", CURSOR_SECRET).update(payload).digest("base64url");
    const left = Buffer.from(mac);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error("Cursor signature mismatch");
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (asRecord(parsed)) return parsed;
  } catch {
    // Do not expose cursor internals to the renderer.
  }
  throw new Error("Invalid session cursor");
}

function assertSessionPath(root: string, relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  const parts = normalized.split("/");
  if (parts.length < 1 || parts.length > 2 || parts.some((part) => !part || part === "." || part === "..")) throw new Error("Invalid session path");
  const fileName = parts.at(-1) ?? "";
  if (!isPrimarySessionFileName(fileName)) throw new Error("Session file is not a verified primary file");
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, ...parts);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) throw new Error("Session path escapes profile root");
  return resolved;
}

function messagePreview(record: Record<string, unknown>, sessionId: string, offset: number): SessionMessagePreview {
  const message = asRecord(record.message) ?? {};
  return {
    id: firstString(record, ["id", "eventId", "messageId"]) ?? stableMessageId(sessionId, offset),
    role: messageRole(record, message),
    timestamp: timestampOf(record, message),
    model: pickString([message, record], ["model", "modelId"]),
    provider: pickString([message, record], ["provider", "providerId"]),
    status: pickString([message, record], ["stopReason", "status", "event"]),
    ...previewText(record, message),
  };
}

interface ReverseMessageReadResult {
  messages: SessionMessagePreview[];
  hasMore: boolean;
  nextEnd?: number;
}

type SessionFileHandle = Awaited<ReturnType<typeof fs.open>>;

async function readFully(handle: SessionFileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, position + offset);
    if (result.bytesRead <= 0) throw new Error("Session file changed while reading");
    offset += result.bytesRead;
  }
  return buffer;
}

async function findLastCompleteLineEnd(filePath: string, fileSize: number): Promise<number> {
  const handle = await fs.open(filePath, "r");
  let position = fileSize;
  try {
    while (position > 0) {
      const start = Math.max(0, position - CHUNK_SIZE);
      const chunk = await readFully(handle, position - start, start);
      const newline = chunk.lastIndexOf(0x0a);
      if (newline >= 0) return start + newline + 1;
      position = start;
    }
    return 0;
  } finally {
    await handle.close();
  }
}

function parseMessagePreview(line: Buffer, sessionId: string, offset: number): SessionMessagePreview | undefined {
  const text = line.toString("utf8").replace(/\r$/, "").trim();
  if (!text) return undefined;
  try {
    const record = asRecord(JSON.parse(text));
    return record?.type === "message" ? messagePreview(record, sessionId, offset) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads JSONL from the tail in fixed-size blocks. `endOffset` is always a verified newline
 * boundary, so incomplete lines still being appended are never exposed as messages.
 */
async function readMessagePageFromTail(
  filePath: string,
  sessionId: string,
  endOffset: number,
  limit: number,
): Promise<ReverseMessageReadResult> {
  const handle = await fs.open(filePath, "r");
  const messages: SessionMessagePreview[] = [];
  let position = endOffset;
  let leading: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let nextEnd: number | undefined;
  let hasMore = false;

  try {
    while (position > 0 && !hasMore) {
      const start = Math.max(0, position - CHUNK_SIZE);
      const length = position - start;
      const chunk = await readFully(handle, length, start);
      const combined = leading.length ? Buffer.concat([chunk, leading]) : chunk;
      let newline = combined.lastIndexOf(0x0a);

      while (newline >= 0) {
        const previousNewline = combined.lastIndexOf(0x0a, newline - 1);
        if (previousNewline < 0 && start > 0) {
          // This line starts in the previous block; retain its ending newline with the prefix.
          leading = combined.subarray(0, newline + 1);
          break;
        }

        const lineStart = previousNewline + 1;
        const preview = parseMessagePreview(combined.subarray(lineStart, newline), sessionId, start + lineStart);
        if (preview) {
          if (messages.length < limit) {
            messages.push(preview);
            nextEnd = start + lineStart;
          } else {
            hasMore = true;
            break;
          }
        }

        if (previousNewline < 0) {
          leading = Buffer.alloc(0);
          break;
        }
        newline = previousNewline;
      }
      position = start;
    }
  } finally {
    await handle.close();
  }

  return { messages, hasMore, nextEnd };
}

function matchesCacheFingerprint(stat: { size: number; mtimeMs: number }, hash: string, cache: SessionFileCache): boolean {
  return stat.size === cache.fileSize && stat.mtimeMs === cache.mtimeMs && hash === cache.headHash && cache.completeBytes <= stat.size;
}

function isWithinDirectory(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

export async function readSessionMessages(
  root: string,
  cache: SessionFileCache,
  options: ReadSessionMessagesOptions = {},
): Promise<SessionMessagePage> {
  const filePath = assertSessionPath(root, cache.relativePath);
  const resolvedRoot = await fs.realpath(root).catch(() => { throw new Error("Session root is unavailable"); });
  const resolvedFile = await fs.realpath(filePath).catch(() => { throw new Error("Session file is unavailable"); });
  if (!isWithinDirectory(resolvedRoot, resolvedFile)) throw new Error("Session file escapes profile root");
  const before = await fs.stat(resolvedFile).catch(() => { throw new Error("Session file is unavailable"); });
  if (!before.isFile()) throw new Error("Session path is not a file");
  const beforeHead = await headHash(resolvedFile);
  if (!matchesCacheFingerprint(before, beforeHead, cache)) {
    throw new Error("Session file changed; refresh the index");
  }
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 50)));
  let scanEnd = cache.completeBytes;
  if (cache.summary.indexStatus !== "ready") scanEnd = await findLastCompleteLineEnd(resolvedFile, before.size);
  if (scanEnd > before.size) throw new Error("Session file changed; refresh the index");
  let endOffset = scanEnd;
  if (options.cursor) {
    const cursor = decodeCursor(options.cursor);
    if (
      cursor.sessionId !== cache.id
      || cursor.fileSize !== cache.fileSize
      || cursor.mtimeMs !== cache.mtimeMs
      || cursor.headHash !== cache.headHash
      || !Number.isInteger(cursor.end)
      || (cursor.end as number) < 0
      || (cursor.end as number) > scanEnd
    ) {
      throw new Error("Session cursor is expired");
    }
    endOffset = cursor.end as number;
  }
  const page = await readMessagePageFromTail(resolvedFile, cache.id, endOffset, limit);
  const after = await fs.stat(resolvedFile).catch(() => { throw new Error("Session file changed while reading"); });
  const afterHead = await headHash(resolvedFile).catch(() => { throw new Error("Session file changed while reading"); });
  if (!matchesCacheFingerprint(after, afterHead, cache)) throw new Error("Session file changed while reading");
  return {
    messages: page.messages,
    hasMore: page.hasMore,
    nextCursor: page.hasMore && page.nextEnd !== undefined
      ? encodeCursor({ sessionId: cache.id, fileSize: cache.fileSize, mtimeMs: cache.mtimeMs, headHash: cache.headHash, end: page.nextEnd })
      : undefined,
  };
}

export function sessionUsageRecords(caches: SessionFileCache[]): SessionUsageRecord[] {
  return caches.flatMap((cache) => cache.usage.map((record) => ({ ...record, tokens: cloneTokens(record.tokens) })));
}
