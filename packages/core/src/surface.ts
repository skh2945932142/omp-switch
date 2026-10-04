import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { validateProfileName } from "./paths";
import { assertFileExpectation, sha256File, sha256Text, writeTextAtomic, type FileExpectation } from "./yaml-config";
import type { ManagedSurfaceEntry, ProfileRef, SurfaceSourceKind } from "./domain";

export type SurfaceKind = "prompt" | "skill";

export interface SurfaceBundle {
  version: 1;
  profile: string;
  items: Array<{ kind: SurfaceKind; name: string; content: string }>;
}

export interface SurfaceSource {
  root: string;
  source: SurfaceSourceKind;
  writable: boolean;
}

export interface SurfaceAdapterOptions {
  snapshotDir?: string;
  snapshotRetention?: number;
  extraSources?: Partial<Record<SurfaceKind, SurfaceSource[]>>;
  projectRoot?: string;
  homeDir?: string;
  pluginRoots?: Partial<Record<SurfaceKind, string[]>>;
}

export interface PromptWritePreview {
  profileId: string;
  name: string;
  targetPath: string;
  content: string;
  beforeText: string;
  expected: FileExpectation;
}
export interface PromptWriteSnapshot {
  id: string;
  profile: string;
  name: string;
  createdAt: string;
  existed: boolean;
  beforeHash?: string;
  afterHash: string;
  status: "prepared" | "committed" | "restored";
}
const PROMPT_SNAPSHOT_ID = /^ps_[a-f0-9-]{36}$/;
const MAX_PROMPT_BYTES = 1024 * 1024;

const ENTRY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,80}$/;

export function validateSurfaceName(value: string): string {
  const name = value.trim();
  if (!ENTRY_PATTERN.test(name) || name.includes("..")) throw new Error("Surface names may contain letters, numbers, spaces, dot, underscore and dash only");
  return name;
}

function sourceRoot(profile: ProfileRef, kind: SurfaceKind): string {
  return path.join(profile.agentDir, kind === "prompt" ? "prompts" : "skills");
}

function entryPath(root: string, kind: SurfaceKind, name: string): string {
  const safeName = validateSurfaceName(name);
  const target = kind === "prompt" ? path.join(root, `${safeName}.md`) : path.join(root, safeName, "SKILL.md");
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Surface path escapes its root");
  return target;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class OmpSurfaceAdapter {
  constructor(private readonly options: SurfaceAdapterOptions = {}) {}

  private projectSource(projectRoot: string | undefined, kind: SurfaceKind): SurfaceSource | undefined {
    if (!projectRoot) return undefined;
    const homeDir = this.options.homeDir ? path.resolve(this.options.homeDir) : undefined;
    let current = path.resolve(projectRoot);
    while (true) {
      if (homeDir && current === homeDir) return undefined;
      const candidate = path.join(current, ".omp", kind === "prompt" ? "prompts" : "skills");
      if (fsSync.existsSync(candidate)) return { root: candidate, source: "project", writable: false };
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }

  getSources(profile: ProfileRef, kind: SurfaceKind): SurfaceSource[] {
    const sources: SurfaceSource[] = [
      { root: sourceRoot(profile, kind), source: "profile", writable: true },
      ...(this.projectSource(this.options.projectRoot, kind) ? [this.projectSource(this.options.projectRoot, kind)!] : []),
      ...((this.options.pluginRoots?.[kind] ?? []).map((root) => ({ root, source: "plugin" as const, writable: false }))),
      ...(this.options.extraSources?.[kind] ?? []),
    ];
    const seenRoots = new Set<string>();
    return sources.filter((source) => {
      const root = path.resolve(source.root);
      if (seenRoots.has(root)) return false;
      seenRoots.add(root);
      return true;
    });
  }

  async list(profile: ProfileRef, kind: SurfaceKind): Promise<ManagedSurfaceEntry[]> {
    const entries: ManagedSurfaceEntry[] = [];
    for (const source of this.getSources(profile, kind)) {
      let children: import("node:fs").Dirent[] = [];
      try {
        children = await fs.readdir(source.root, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      for (const child of children) {
        if (kind === "prompt" && child.isFile() && child.name.endsWith(".md")) {
          const name = child.name.slice(0, -3);
          if (!ENTRY_PATTERN.test(name)) continue;
          const filePath = path.join(source.root, child.name);
          const stat = await fs.stat(filePath);
          entries.push({ id: `${source.source}:${filePath}`, name, path: filePath, source: source.source, enabled: true, updatedAt: stat.mtime.toISOString() });
        }
        if (kind === "skill" && child.isDirectory() && await exists(path.join(source.root, child.name, "SKILL.md"))) {
          const name = child.name;
          if (!ENTRY_PATTERN.test(name)) continue;
          const filePath = path.join(source.root, name, "SKILL.md");
          const stat = await fs.stat(filePath);
          entries.push({ id: `${source.source}:${filePath}`, name, path: filePath, source: source.source, enabled: true, updatedAt: stat.mtime.toISOString() });
        }
      }
    }
    const unique = new Map<string, ManagedSurfaceEntry>();
    for (const entry of entries) if (!unique.has(entry.name)) unique.set(entry.name, entry);
    return Array.from(unique.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  async read(entry: ManagedSurfaceEntry): Promise<string> {
    return fs.readFile(entry.path, "utf8");
  }

  async write(profile: ProfileRef, kind: SurfaceKind, name: string, content: string): Promise<ManagedSurfaceEntry> {
    const root = sourceRoot(profile, kind);
    const filePath = entryPath(root, kind, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    const stat = await fs.stat(filePath);
    return { id: `profile:${filePath}`, name: validateSurfaceName(name), path: filePath, source: "profile", enabled: true, updatedAt: stat.mtime.toISOString() };
  }

  async remove(profile: ProfileRef, kind: SurfaceKind, name: string): Promise<void> {
    const root = sourceRoot(profile, kind);
    const filePath = entryPath(root, kind, name);
    await fs.rm(filePath, { force: true });
    if (kind === "skill") await fs.rmdir(path.dirname(filePath)).catch(() => undefined);
  }

  async exportBundle(profile: ProfileRef, kinds: SurfaceKind[] = ["prompt", "skill"]): Promise<SurfaceBundle> {
    const items: SurfaceBundle["items"] = [];
    for (const kind of kinds) {
      for (const entry of await this.list(profile, kind)) {
        if (entry.source !== "profile") continue;
        items.push({ kind, name: entry.name, content: await this.read(entry) });
      }
    }
    return { version: 1, profile: profile.id, items };
  }

  private async guardedPromptPath(profile: ProfileRef, name: string): Promise<string> {
    validateProfileName(profile.id);
    const target = entryPath(sourceRoot(profile, "prompt"), "prompt", name);
    for (const [file, directory] of [[profile.agentDir, true], [sourceRoot(profile, "prompt"), true], [target, false]] as const) {
      try {
        const stat = await fs.lstat(file);
        if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error("Prompt target must not contain links or special files");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return target;
  }

  async previewPromptWrite(profile: ProfileRef, name: string, content: string): Promise<PromptWritePreview> {
    if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_PROMPT_BYTES || content.includes("\0")) throw new Error("Prompt must be UTF-8 text within 1 MiB");
    const targetPath = await this.guardedPromptPath(profile, name);
    let beforeText = ""; let existed = false;
    try {
      const stat = await fs.stat(targetPath);
      if (stat.size > MAX_PROMPT_BYTES) throw new Error("Existing prompt exceeds the preview size limit");
      const buffer = await fs.readFile(targetPath);
      if (buffer.length > MAX_PROMPT_BYTES) throw new Error("Existing prompt exceeds the preview size limit");
      beforeText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
      existed = true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const expected: FileExpectation = { exists: existed, hash: existed ? sha256Text(beforeText) : undefined };
    await assertFileExpectation(targetPath, expected);
    return { profileId: profile.id, name: validateSurfaceName(name), targetPath, content, beforeText, expected };
  }

  private snapshotDirectory(profile: ProfileRef, id?: string): string {
    validateProfileName(profile.id);
    if (!this.options.snapshotDir) throw new Error("Prompt snapshot storage is not configured");
    if (id !== undefined && !PROMPT_SNAPSHOT_ID.test(id)) throw new Error("Invalid prompt snapshot ID");
    return path.join(this.options.snapshotDir, profile.id, ...(id ? [id] : []));
  }

  private async readPromptSnapshot(profile: ProfileRef, id: string): Promise<PromptWriteSnapshot> {
    const directory = this.snapshotDirectory(profile, id);
    for (const file of [this.snapshotDirectory(profile), directory, path.join(directory, "snapshot.json")]) {
      if ((await fs.lstat(file)).isSymbolicLink()) throw new Error("Prompt snapshot links are not allowed");
    }
    const record = JSON.parse(await fs.readFile(path.join(directory, "snapshot.json"), "utf8")) as PromptWriteSnapshot;
    if (record.id !== id || record.profile !== profile.id || typeof record.name !== "string" || typeof record.existed !== "boolean" ||
      typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt)) ||
      !/^[a-f0-9]{64}$/.test(record.afterHash) || (record.existed && !/^[a-f0-9]{64}$/.test(record.beforeHash ?? "")) ||
      !["prepared", "committed", "restored"].includes(record.status)) throw new Error("Invalid prompt snapshot");
    validateSurfaceName(record.name);
    return record;
  }

  async listPromptSnapshots(profile: ProfileRef): Promise<PromptWriteSnapshot[]> {
    const directory = this.snapshotDirectory(profile);
    let children: import("node:fs").Dirent[];
    try { children = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const snapshots: PromptWriteSnapshot[] = [];
    for (const child of children) if (child.isDirectory() && PROMPT_SNAPSHOT_ID.test(child.name)) {
      try { snapshots.push(await this.readPromptSnapshot(profile, child.name)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  async commitPromptWrite(profile: ProfileRef, preview: PromptWritePreview, overwrite = false): Promise<PromptWriteSnapshot> {
    const target = await this.guardedPromptPath(profile, preview.name);
    if (preview.profileId !== profile.id || preview.targetPath !== target ||
      typeof preview.content !== "string" || Buffer.byteLength(preview.content, "utf8") > MAX_PROMPT_BYTES || preview.content.includes("\0") ||
      (preview.expected.exists && preview.expected.hash !== sha256Text(preview.beforeText))) throw new Error("Invalid prompt preview");
    if (preview.expected.exists && !overwrite) throw new Error("Explicit overwrite confirmation is required");
    await assertFileExpectation(target, preview.expected);
    const record: PromptWriteSnapshot = {
      id: `ps_${crypto.randomUUID()}`, profile: profile.id, name: preview.name, createdAt: new Date().toISOString(),
      existed: preview.expected.exists, beforeHash: preview.expected.hash, afterHash: sha256Text(preview.content), status: "prepared",
    };
    const directory = this.snapshotDirectory(profile, record.id);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    if (record.existed) await fs.writeFile(path.join(directory, "before.md"), preview.beforeText, { mode: 0o600 });
    // The planned after-hash also permits recovery if the process exits after rename but before the status update.
    await writeTextAtomic(path.join(directory, "snapshot.json"), JSON.stringify(record));
    await this.guardedPromptPath(profile, preview.name);
    await writeTextAtomic(target, preview.content, preview.expected);
    record.status = "committed";
    await writeTextAtomic(path.join(directory, "snapshot.json"), JSON.stringify(record));
    const retention = this.options.snapshotRetention ?? 30;
    if (!Number.isSafeInteger(retention) || retention < 1) throw new Error("Invalid prompt snapshot retention");
    const snapshots = await this.listPromptSnapshots(profile);
    const retainedOrder = [record, ...snapshots.filter((item) => item.id !== record.id)];
    for (const old of retainedOrder.slice(retention)) await fs.rm(this.snapshotDirectory(profile, old.id), { recursive: true });
    return record;
  }

  async restorePromptSnapshot(profile: ProfileRef, id: string): Promise<void> {
    const record = await this.readPromptSnapshot(profile, id);
    if (record.status === "restored") throw new Error("Prompt snapshot has already been restored");
    const target = await this.guardedPromptPath(profile, record.name);
    const expected = { exists: true, hash: record.afterHash };
    await assertFileExpectation(target, expected);
    if (record.existed) {
      const backup = path.join(this.snapshotDirectory(profile, id), "before.md");
      if ((await fs.lstat(backup)).isSymbolicLink() || await sha256File(backup) !== record.beforeHash) throw new Error("Prompt backup changed");
      const content = await fs.readFile(backup, "utf8");
      await this.guardedPromptPath(profile, record.name);
      await writeTextAtomic(target, content, expected);
    } else {
      await this.guardedPromptPath(profile, record.name);
      await assertFileExpectation(target, expected);
      await fs.unlink(target);
    }
    record.status = "restored";
    await writeTextAtomic(path.join(this.snapshotDirectory(profile, id), "snapshot.json"), JSON.stringify(record));
  }

  async importBundle(profile: ProfileRef, bundle: SurfaceBundle): Promise<ManagedSurfaceEntry[]> {
    if (bundle.version !== 1 || !Array.isArray(bundle.items)) throw new Error("Unsupported surface bundle");
    const written: ManagedSurfaceEntry[] = [];
    for (const item of bundle.items) {
      if (item.kind !== "prompt" && item.kind !== "skill" || typeof item.content !== "string") throw new Error("Surface bundle contains an invalid item");
      written.push(await this.write(profile, item.kind, item.name, item.content));
    }
    return written;
  }
}
