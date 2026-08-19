import fs from "node:fs/promises";
import path from "node:path";
import type { SessionIndexEntry } from "./domain";

export interface SessionIndexResult {
  entries: SessionIndexEntry[];
  invalidLines: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
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

function extractUsage(record: Record<string, unknown>): Record<string, number> | undefined {
  const candidate = asRecord(record.usage) ?? asRecord(asRecord(record.metadata)?.usage);
  if (!candidate) return undefined;
  const usage = Object.fromEntries(Object.entries(candidate).filter(([, value]) => typeof value === "number" && Number.isFinite(value))) as Record<string, number>;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function extractEvent(record: Record<string, unknown>, filePath: string, profile: string, offset: number, length: number): SessionIndexEntry {
  const metadata = asRecord(record.metadata) ?? {};
  const model = firstString(record, ["model", "modelId"]) ?? firstString(metadata, ["model", "modelId"]);
  const provider = firstString(record, ["provider", "providerId"]) ?? firstString(metadata, ["provider", "providerId"])
    ?? (model?.includes("/") ? model.slice(0, model.indexOf("/")) : undefined);
  const startedAt = firstString(record, ["timestamp", "createdAt", "time"]) ?? firstString(metadata, ["timestamp", "createdAt"]);
  const cost = firstNumber(record, ["cost", "totalCost"]) ?? firstNumber(metadata, ["cost", "totalCost"]);
  return {
    id: firstString(record, ["id", "eventId", "messageId"]) ?? `${filePath}:${offset}`,
    sourceKey: `${filePath}:${offset}`,
    profile,
    filePath,
    offset,
    length,
    startedAt,
    model,
    provider,
    status: firstString(record, ["status", "type", "event"]),
    usage: extractUsage(record),
    cost,
  };
}

function dedupeEntries(entries: SessionIndexEntry[]): SessionIndexEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.filePath}:${entry.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
      entries.push(extractEvent(parsed, filePath, profile, offset, length));
    } catch {
      invalidLines += 1;
    }
    offset += length;
  }
  return { entries: dedupeEntries(entries), invalidLines };
}

export async function indexSessionFile(filePath: string, profile: string): Promise<SessionIndexResult> {
  return indexSessionJsonl(await fs.readFile(filePath, "utf8"), filePath, profile);
}

async function findJsonl(root: string, result: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) await findJsonl(target, result);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(target);
  }
}

export async function indexSessionDirectory(root: string, profile: string): Promise<SessionIndexResult> {
  const files: string[] = [];
  await findJsonl(root, files);
  const results = await Promise.all(files.map((file) => indexSessionFile(file, profile)));
  return {
    entries: dedupeEntries(results.flatMap((result) => result.entries)).sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? "")),
    invalidLines: results.reduce((total, result) => total + result.invalidLines, 0),
  };
}

export function summarizeSessionUsage(entries: SessionIndexEntry[]): { usage: Record<string, number>; cost: number; failures: number } {
  const usage: Record<string, number> = {};
  let cost = 0;
  let failures = 0;
  for (const entry of dedupeEntries(entries)) {
    for (const [key, value] of Object.entries(entry.usage ?? {})) usage[key] = (usage[key] ?? 0) + value;
    if (typeof entry.cost === "number") cost += entry.cost;
    if (/error|fail|abort|cancel/i.test(entry.status ?? "")) failures += 1;
  }
  return { usage, cost, failures };
}
