import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
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
  extraSources?: Partial<Record<SurfaceKind, SurfaceSource[]>>;
  projectRoot?: string;
  homeDir?: string;
  pluginRoots?: Partial<Record<SurfaceKind, string[]>>;
}

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
