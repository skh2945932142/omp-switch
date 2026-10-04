import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { sha256Text } from "./yaml-config";

export interface PromptLibrarySource { id: string; root: string; label: string }
export interface PromptLibraryEntry {
  id: string;
  sourceId: string;
  relativePath: string;
  name: string;
  size: number;
  updatedAt: string;
  available: boolean;
  snippet?: string;
}
export type PromptLibraryIssueCode = "missing" | "unreadable" | "symlink" | "depth" | "files" | "size" | "encoding" | "changed" | "budget";
export interface PromptLibraryIssue { sourceId: string; relativePath?: string; code: PromptLibraryIssueCode }
export interface PromptLibraryResult {
  sources: PromptLibrarySource[];
  entries: PromptLibraryEntry[];
  issues: PromptLibraryIssue[];
  complete: boolean;
}
export interface PromptLibraryText { entry: PromptLibraryEntry; content: string; hash: string }
export interface PromptLibraryLimits {
  maxDepth: number;
  maxFiles: number;
  maxVisits: number;
  maxFileBytes: number;
  maxCacheBytes: number;
  maxSearchBytes: number;
}
const DEFAULT_LIMITS: PromptLibraryLimits = {
  maxDepth: 8, maxFiles: 2_000, maxVisits: 20_000,
  maxFileBytes: 1024 * 1024, maxCacheBytes: 64 * 1024 * 1024, maxSearchBytes: 64 * 1024 * 1024,
};
const EXCLUDED_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage"]);
const SOURCE_ID = /^pls_[a-f0-9-]{36}$/;
const comparable = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;

export class PromptLibraryError extends Error {
  constructor(public readonly code: PromptLibraryIssueCode, message: string) { super(message); this.name = "PromptLibraryError"; }
}

export function isPathWithin(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** The chosen root is canonical; replacing it or any descendant by a link is not consent to a new source. */
export async function assertLibraryPath(root: string, relativePath: string): Promise<string> {
  const target = path.resolve(root, relativePath);
  if (!isPathWithin(root, target)) throw new PromptLibraryError("symlink", "Library file escapes its source");
  const canonical = await fs.realpath(root);
  if (comparable(canonical) !== comparable(path.resolve(root))) throw new PromptLibraryError("symlink", "Library source changed its destination");
  const pieces = path.relative(root, target).split(path.sep);
  let current = root;
  for (const piece of pieces) {
    current = path.join(current, piece);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new PromptLibraryError("symlink", "Library links are not followed");
  }
  if (!isPathWithin(canonical, await fs.realpath(target))) throw new PromptLibraryError("symlink", "Library file escapes its source");
  return target;
}

function issueCode(error: unknown): PromptLibraryIssueCode {
  if (error instanceof PromptLibraryError) return error.code;
  return (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "unreadable";
}

/** Source-bound, read-only text collection. Only metadata belongs in the application's durable store. */
export class PromptLibrary {
  private sources: PromptLibrarySource[];
  private entries = new Map<string, PromptLibraryEntry>();
  private issues: PromptLibraryIssue[] = [];
  private cache = new Map<string, { text: PromptLibraryText; fingerprint: string; bytes: number }>();
  private cacheBytes = 0;
  private readonly limits: PromptLibraryLimits;

  constructor(sources: PromptLibrarySource[] = [], limits: Partial<PromptLibraryLimits> = {}, knownEntries: PromptLibraryEntry[] = []) {
    this.sources = sources.map((source) => {
      if (!SOURCE_ID.test(source.id) || !path.isAbsolute(source.root)) throw new Error("Invalid library source");
      return { ...source, root: path.resolve(source.root) };
    });
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    for (const value of Object.values(this.limits)) if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid library resource limit");
    for (const entry of knownEntries) if (this.sources.some((s) => s.id === entry.sourceId) && entry.id === this.entryId(entry.sourceId, entry.relativePath)) {
      this.entries.set(entry.id, { ...entry, available: false, snippet: undefined });
    }
  }

  listSources(): PromptLibrarySource[] { return this.sources.map((source) => ({ ...source })); }

  async addSource(root: string): Promise<PromptLibrarySource> {
    const canonical = await fs.realpath(root);
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error("Library source must be a directory");
    const existing = this.sources.find((s) => comparable(s.root) === comparable(canonical));
    if (existing) return { ...existing };
    const source = { id: `pls_${crypto.randomUUID()}`, root: canonical, label: path.basename(canonical) || canonical };
    this.sources.push(source);
    return { ...source };
  }

  removeSource(id: string): void {
    if (!this.sources.some((source) => source.id === id)) throw new Error("Unknown library source");
    this.sources = this.sources.filter((source) => source.id !== id);
    for (const [key, entry] of this.entries) if (entry.sourceId === id) { this.entries.delete(key); this.evict(key); }
    this.issues = this.issues.filter((issue) => issue.sourceId !== id);
  }

  private entryId(sourceId: string, relativePath: string): string {
    return `pl_${crypto.createHash("sha256").update(sourceId + "\0" + relativePath).digest("hex").slice(0, 32)}`;
  }

  async refresh(): Promise<PromptLibraryResult> {
    const previous = this.entries;
    const next = new Map<string, PromptLibraryEntry>();
    const issues: PromptLibraryIssue[] = [];
    for (const source of this.sources) {
      let count = 0; let visits = 0; let exhausted = false;
      const walk = async (directory: string, depth: number): Promise<void> => {
        const handle = await fs.opendir(directory);
        for await (const child of handle) {
          if (exhausted) break;
          if (++visits > this.limits.maxVisits) { issues.push({ sourceId: source.id, code: "files" }); exhausted = true; break; }
          if (child.name.startsWith(".")) continue;
          const file = path.join(directory, child.name);
          const relativePath = path.relative(source.root, file).split(path.sep).join("/");
          if (child.isSymbolicLink()) { issues.push({ sourceId: source.id, relativePath, code: "symlink" }); continue; }
          if (child.isDirectory()) {
            if (EXCLUDED_DIRS.has(child.name)) continue;
            if (depth >= this.limits.maxDepth) { issues.push({ sourceId: source.id, relativePath, code: "depth" }); continue; }
            try { await assertLibraryPath(source.root, path.relative(source.root, file)); await walk(file, depth + 1); }
            catch (error) { issues.push({ sourceId: source.id, relativePath, code: issueCode(error) }); }
          } else if (child.isFile() && child.name.toLowerCase().endsWith(".md")) {
            if (count >= this.limits.maxFiles) { issues.push({ sourceId: source.id, code: "files" }); exhausted = true; break; }
            count++;
            try {
              await assertLibraryPath(source.root, path.relative(source.root, file));
              const stat = await fs.stat(file);
              const available = stat.size <= this.limits.maxFileBytes;
              const id = this.entryId(source.id, relativePath);
              next.set(id, { id, sourceId: source.id, relativePath, name: child.name.slice(0, -3), size: stat.size, updatedAt: stat.mtime.toISOString(), available });
              if (!available) issues.push({ sourceId: source.id, relativePath, code: "size" });
            } catch (error) { issues.push({ sourceId: source.id, relativePath, code: issueCode(error) }); }
          }
        }
      };
      try {
        const canonical = await fs.realpath(source.root);
        if (comparable(canonical) !== comparable(source.root)) throw new PromptLibraryError("symlink", "Library source changed its destination");
        await walk(source.root, 0);
      } catch (error) { issues.push({ sourceId: source.id, code: issueCode(error) }); }
    }
    for (const [id, entry] of previous) if (!next.has(id) && this.sources.some((s) => s.id === entry.sourceId)) {
      next.set(id, { ...entry, available: false, snippet: undefined }); this.evict(id);
    }
    this.entries = next; this.issues = issues;
    return this.result(Array.from(next.values()), issues);
  }

  private evict(id: string): void {
    const cached = this.cache.get(id);
    if (cached) { this.cacheBytes -= cached.bytes; this.cache.delete(id); }
  }

  async read(id: string, fresh = false): Promise<PromptLibraryText> {
    const entry = this.entries.get(id);
    const source = entry && this.sources.find((s) => s.id === entry.sourceId);
    if (!entry || !source) throw new Error("Unknown library entry");
    const file = await assertLibraryPath(source.root, entry.relativePath.split("/").join(path.sep));
    const before = await fs.stat(file);
    if (!before.isFile()) throw new PromptLibraryError("unreadable", "Library entry is not a regular file");
    if (before.size > this.limits.maxFileBytes) throw new PromptLibraryError("size", "Library text exceeds its size limit");
    const fingerprint = [before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs].join(":");
    const cached = this.cache.get(id);
    if (!fresh && cached?.fingerprint === fingerprint) {
      this.cache.delete(id); this.cache.set(id, cached);
      return { ...cached.text, entry: { ...cached.text.entry } };
    }
    this.evict(id);
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let content: string;
    try {
      const opened = await handle.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino) throw new PromptLibraryError("changed", "Library file changed while opening");
      const buffer = Buffer.alloc(Math.min(before.size + 1, this.limits.maxFileBytes + 1));
      let bytes = 0;
      while (bytes < buffer.length) {
        const part = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
        if (part.bytesRead === 0) break;
        bytes += part.bytesRead;
      }
      const after = await handle.stat();
      await assertLibraryPath(source.root, entry.relativePath.split("/").join(path.sep));
      const current = await fs.stat(file);
      if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.dev !== before.dev || current.ino !== before.ino) {
        throw new PromptLibraryError("changed", "Library file changed while reading");
      }
      try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, bytes)); }
      catch { throw new PromptLibraryError("encoding", "Library text must be valid UTF-8"); }
      if (content.includes("\0")) throw new PromptLibraryError("encoding", "Library text contains binary data");
    } finally { await handle.close(); }
    const text = { entry: { ...entry, size: before.size, updatedAt: before.mtime.toISOString(), available: true }, content, hash: sha256Text(content) };
    this.entries.set(id, text.entry);
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes <= this.limits.maxCacheBytes) {
      while (this.cacheBytes + bytes > this.limits.maxCacheBytes && this.cache.size) this.evict(this.cache.keys().next().value!);
      this.cache.set(id, { text, fingerprint, bytes }); this.cacheBytes += bytes;
    }
    return { ...text, entry: { ...text.entry } };
  }

  async search(query: string): Promise<PromptLibraryResult> {
    if (typeof query !== "string" || query.length > 512) throw new Error("Invalid library search");
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return this.result(Array.from(this.entries.values()), this.issues);
    const found: PromptLibraryEntry[] = [];
    const issues = [...this.issues]; let used = 0;
    for (const entry of this.sorted(Array.from(this.entries.values()))) {
      const name = entry.relativePath.toLowerCase(); let content = "";
      if (entry.available) {
        if (used + entry.size > this.limits.maxSearchBytes) issues.push({ sourceId: entry.sourceId, relativePath: entry.relativePath, code: "budget" });
        else {
          try {
            const text = await this.read(entry.id); used += Buffer.byteLength(text.content, "utf8");
            if (used <= this.limits.maxSearchBytes) content = text.content;
            else issues.push({ sourceId: entry.sourceId, relativePath: entry.relativePath, code: "budget" });
          } catch (error) { issues.push({ sourceId: entry.sourceId, relativePath: entry.relativePath, code: issueCode(error) }); }
        }
      }
      const lower = content.toLowerCase();
      if (terms.every((term) => name.includes(term) || lower.includes(term))) {
        const at = lower.indexOf(terms[0]);
        found.push({ ...entry, snippet: at < 0 ? undefined : content.slice(Math.max(0, at - 40), at + 120) });
      }
    }
    return this.result(found, issues);
  }

  private sorted(entries: PromptLibraryEntry[]): PromptLibraryEntry[] {
    return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath) || a.sourceId.localeCompare(b.sourceId));
  }
  private result(entries: PromptLibraryEntry[], issues: PromptLibraryIssue[]): PromptLibraryResult {
    return { sources: this.listSources(), entries: this.sorted(entries).map((entry) => ({ ...entry })), issues: issues.map((issue) => ({ ...issue })), complete: issues.length === 0 };
  }
}

export interface PromptLibraryMetadata {
  favorite: boolean;
  tags: string[];
  lastUsedAt?: string;
  lastAction?: "open" | "copy" | "adopt";
}
export interface PromptLibraryView extends PromptLibraryResult { metadata: Record<string, PromptLibraryMetadata> }
export interface PromptAdoptionPreview {
  id: string;
  profileId: string;
  entryId: string;
  name: string;
  targetPath: string;
  beforeText: string;
  content: string;
  overwriteRequired: boolean;
}
export function normalizeLibraryMetadata(current: PromptLibraryMetadata | undefined, patch: { favorite?: boolean; tags?: string[] }): PromptLibraryMetadata {
  if (!patch || typeof patch !== "object" || Object.keys(patch).some((key) => key !== "favorite" && key !== "tags") ||
    (patch.favorite !== undefined && typeof patch.favorite !== "boolean")) throw new Error("Invalid library metadata patch");
  let tags = current?.tags ?? [];
  if (patch.tags !== undefined) {
    if (!Array.isArray(patch.tags) || patch.tags.length > 20 || patch.tags.some((tag) => typeof tag !== "string" || !/^[^\r\n\0]{1,64}$/.test(tag.trim()))) throw new Error("Library tags must contain at most 20 nonempty single-line labels");
    tags = [...new Set(patch.tags.map((tag) => tag.trim()))];
  }
  return { ...current, favorite: patch.favorite ?? current?.favorite ?? false, tags };
}
