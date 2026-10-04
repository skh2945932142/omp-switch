import crypto from "node:crypto";
import {
  OmpSurfaceAdapter, PromptLibrary, normalizeLibraryMetadata, validateProfileName,
  type ProfileRef, type PromptAdoptionPreview, type PromptLibraryEntry, type PromptLibraryMetadata,
  type PromptLibrarySource, type PromptLibraryView, type PromptWritePreview,
} from "@omp-switch/core";
import type { MetadataStore } from "./metadata-store";

interface StoredLibrary {
  version: 1;
  sources: PromptLibrarySource[];
  entries: PromptLibraryEntry[];
  metadata: Record<string, PromptLibraryMetadata>;
}
interface LibraryServiceOptions {
  snapshotDir: string;
  profileFor(id: string): ProfileRef;
  isWritable(): boolean;
}

/** OS orchestration: the core owns filesystem rules; this service owns persistence and preview capabilities. */
export class PromptLibraryService {
  private library: PromptLibrary;
  private adopter: OmpSurfaceAdapter;
  private classification: Record<string, PromptLibraryMetadata>;
  private current: Awaited<ReturnType<PromptLibrary["refresh"]>> | null = null;
  private gate: Promise<void> = Promise.resolve();
  private previews = new Map<string, { profile: ProfileRef; entryId: string; sourceHash: string; preview: PromptWritePreview; expiresAt: number }>();

  constructor(private readonly metadata: Pick<MetadataStore, "getPreference" | "setPreference">, private readonly options: LibraryServiceOptions) {
    const stored = metadata.getPreference<StoredLibrary>("promptLibrary.v1");
    if (stored && (stored.version !== 1 || !Array.isArray(stored.sources) || stored.sources.length > 32 || !Array.isArray(stored.entries) || stored.entries.length > 64_000 || !stored.metadata || typeof stored.metadata !== "object")) throw new Error("Invalid saved prompt library");
    this.library = new PromptLibrary(stored?.sources, {}, stored?.entries);
    this.classification = structuredClone(stored?.metadata ?? {});
    this.adopter = new OmpSurfaceAdapter({ snapshotDir: options.snapshotDir });
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.current) { this.current = await this.library.refresh(); await this.persist(); }
  }

  private async persist(): Promise<void> {
    const entries = (this.current?.entries ?? []).map(({ id, sourceId, relativePath, name, size, updatedAt, available }) => ({ id, sourceId, relativePath, name, size, updatedAt, available }));
    await this.metadata.setPreference("promptLibrary.v1", { version: 1, sources: this.library.listSources(), entries, metadata: this.classification } satisfies StoredLibrary);
  }

  private assertEntry(id: string): void {
    if (!this.current?.entries.some((entry) => entry.id === id)) throw new Error("Unknown library entry");
  }

  private writableProfile(id: string): ProfileRef {
    validateProfileName(id);
    if (!this.options.isWritable()) throw new Error("OMP profile is read-only");
    return this.options.profileFor(id);
  }

  list(query = ""): Promise<PromptLibraryView> {
    return this.run(async () => { await this.ensureLoaded(); return { ...await this.library.search(query), metadata: structuredClone(this.classification) }; });
  }

  refresh(): Promise<PromptLibraryView> {
    return this.run(async () => {
      this.current = await this.library.refresh(); await this.persist();
      return { ...this.current, metadata: structuredClone(this.classification) };
    });
  }

  addSource(root: string): Promise<PromptLibraryView> {
    return this.run(async () => {
      await this.ensureLoaded();
      if (this.library.listSources().length >= 32) throw new Error("Library supports at most 32 sources");
      await this.library.addSource(root);
      this.current = await this.library.refresh(); await this.persist();
      return { ...this.current, metadata: structuredClone(this.classification) };
    });
  }

  removeSource(id: string): Promise<PromptLibraryView> {
    return this.run(async () => {
      await this.ensureLoaded();
      const removed = this.current!.entries.filter((entry) => entry.sourceId === id);
      this.library.removeSource(id);
      for (const entry of removed) delete this.classification[entry.id];
      this.previews.clear();
      this.current = await this.library.refresh(); await this.persist();
      return { ...this.current, metadata: structuredClone(this.classification) };
    });
  }

  updateMetadata(id: string, patch: { favorite?: boolean; tags?: string[] }): Promise<PromptLibraryMetadata> {
    return this.run(async () => {
      await this.ensureLoaded(); this.assertEntry(id);
      const next = normalizeLibraryMetadata(this.classification[id], patch);
      this.classification[id] = next; await this.persist(); return structuredClone(next);
    });
  }

  private async recordUse(id: string, action: "open" | "copy" | "adopt"): Promise<void> {
    this.assertEntry(id);
    this.classification[id] = { ...normalizeLibraryMetadata(this.classification[id], {}), lastUsedAt: new Date().toISOString(), lastAction: action };
    await this.persist();
  }

  read(id: string) {
    return this.run(async () => { await this.ensureLoaded(); const text = await this.library.read(id); await this.recordUse(id, "open"); return text; });
  }

  noteUse(id: string, action: "copy"): Promise<void> {
    return this.run(async () => {
      if (action !== "copy") throw new Error("Invalid library action");
      await this.ensureLoaded(); await this.recordUse(id, action);
    });
  }

  previewAdoption(profileId: string, entryId: string, name: string): Promise<PromptAdoptionPreview> {
    return this.run(async () => {
      const profile = this.writableProfile(profileId); await this.ensureLoaded();
      const text = await this.library.read(entryId, true);
      const preview = await this.adopter.previewPromptWrite(profile, name, text.content);
      for (const [id, pending] of this.previews) if (pending.expiresAt <= Date.now()) this.previews.delete(id);
      if (this.previews.size >= 8) this.previews.delete(this.previews.keys().next().value!);
      const id = `pa_${crypto.randomUUID()}`;
      this.previews.set(id, { profile, entryId, sourceHash: text.hash, preview, expiresAt: Date.now() + 10 * 60_000 });
      return { id, profileId, entryId, name: preview.name, targetPath: preview.targetPath, beforeText: preview.beforeText, content: preview.content, overwriteRequired: preview.expected.exists };
    });
  }

  commitAdoption(id: string, overwrite: boolean) {
    return this.run(async () => {
      const pending = this.previews.get(id);
      if (!pending || pending.expiresAt <= Date.now() || typeof overwrite !== "boolean") throw new Error("Prompt preview expired; preview again");
      const profile = this.writableProfile(pending.profile.id);
      try {
        const current = await this.library.read(pending.entryId, true);
        if (current.hash !== pending.sourceHash) throw new Error("Source prompt changed; preview again");
        const snapshot = await this.adopter.commitPromptWrite(profile, pending.preview, overwrite);
        try { await this.recordUse(pending.entryId, "adopt"); }
        catch { throw new Error("Prompt was adopted, but library metadata could not be saved. Adoption history still contains the recovery snapshot."); }
        return snapshot;
      } finally { this.previews.delete(id); }
    });
  }

  listSnapshots(profileId: string) {
    return this.run(async () => { validateProfileName(profileId); return this.adopter.listPromptSnapshots(this.options.profileFor(profileId)); });
  }
  restoreSnapshot(profileId: string, id: string): Promise<void> {
    return this.run(async () => { await this.adopter.restorePromptSnapshot(this.writableProfile(profileId), id); });
  }
}
