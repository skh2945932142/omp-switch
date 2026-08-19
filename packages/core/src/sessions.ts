import fs from "node:fs/promises";
import path from "node:path";
import type { SessionIndexEntry } from "./domain";
import { normalizeUsage } from "./usage";

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

/**
 * OMP records the interesting fields on `message` for assistant turns — `message.usage`,
 * `message.model`, `message.provider`, `message.stopReason` — not at the top level. The top level
 * only carries `id`, `timestamp`, `type` and `parentId`. Older and foreign shapes are still read as
 * a fallback, but the `message` paths are what real session files use.
 */
function extractEvent(record: Record<string, unknown>, filePath: string, profile: string, offset: number, length: number): SessionIndexEntry {
  const message = asRecord(record.message) ?? {};
  const metadata = asRecord(record.metadata) ?? {};
  const sources = [message, record, metadata];
  const pick = (keys: string[]): string | undefined => {
    for (const source of sources) {
      const value = firstString(source, keys);
      if (value) return value;
    }
    return undefined;
  };

  const model = pick(["model", "modelId"]);
  const provider = pick(["provider", "providerId"])
    ?? (model?.includes("/") ? model.slice(0, model.indexOf("/")) : undefined);
  const startedAt = firstString(record, ["timestamp", "createdAt", "time"]) ?? pick(["timestamp", "createdAt"]);
  const rawUsage = asRecord(message.usage) ?? asRecord(record.usage) ?? asRecord(metadata.usage);
  const { tokens, recordedCost } = normalizeUsage(rawUsage);
  const cost = recordedCost ?? firstNumber(record, ["cost", "totalCost"]) ?? firstNumber(metadata, ["cost", "totalCost"]);
  // stopReason is where OMP marks an errored or aborted turn; `type` only says "message".
  const status = pick(["stopReason", "status", "event"]) ?? firstString(record, ["type"]);

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
    status,
    usage: rawUsage ? tokens : undefined,
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
