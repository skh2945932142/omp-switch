import type { PromptAdoptionPreview, PromptLibraryEntry, PromptLibraryMetadata, PromptLibrarySource, PromptWriteSnapshot } from "@omp-switch/core";
import type { OmpSwitchApi } from "./global";

function validateSurfaceName(value: string): string {
  const name = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,80}$/.test(name) || name.includes("..")) throw new Error("Invalid profile prompt name");
  return name;
}
function normalizeLibraryMetadata(current: PromptLibraryMetadata | undefined, patch: { favorite?: boolean; tags?: string[] }): PromptLibraryMetadata {
  if (patch.favorite !== undefined && typeof patch.favorite !== "boolean") throw new Error("Invalid favorite value");
  const tags = patch.tags === undefined ? (current?.tags ?? []) : [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))];
  return { favorite: patch.favorite ?? current?.favorite ?? false, tags, lastUsedAt: current?.lastUsedAt, lastAction: current?.lastAction };
}

type LibraryMethods = Pick<OmpSwitchApi,
  "promptLibraryList" | "refreshPromptLibrary" | "choosePromptLibrarySource" | "removePromptLibrarySource" |
  "updatePromptLibraryMetadata" | "readPromptLibraryEntry" | "notePromptLibraryUse" | "previewPromptAdoption" |
  "commitPromptAdoption" | "listPromptAdoptions" | "restorePromptAdoption" |
  "listSurface" | "readSurface" | "writeSurface" | "deleteSurface">;

/** Browser-only fixtures exercise the same visible state transitions without filesystem access. */
export function createPromptLibraryMock(): LibraryMethods {
  let sources: PromptLibrarySource[] = [];
  let entries: PromptLibraryEntry[] = [];
  const metadata: Record<string, PromptLibraryMetadata> = {};
  const texts = new Map<string, string>();
  const targets = new Map<string, string>();
  const previews = new Map<string, PromptAdoptionPreview>();
  const snapshots = new Map<string, { snapshot: PromptWriteSnapshot; before?: string; after: string }>();
  const key = (profile: string, kind: string, name: string) => `${profile}\0${kind}\0${name}`;
  const note = (id: string, action: "open" | "copy" | "adopt") => {
    if (!entries.some((entry) => entry.id === id)) throw new Error("Unknown library entry");
    metadata[id] = { ...normalizeLibraryMetadata(metadata[id], {}), lastUsedAt: new Date().toISOString(), lastAction: action };
  };
  const view = (query = "") => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return structuredClone({ sources, entries: entries.filter((entry) => terms.every((term) => `${entry.relativePath}\n${texts.get(entry.id)}`.toLowerCase().includes(term))), issues: [], complete: true, metadata });
  };
  return {
    promptLibraryList: async (query) => view(query),
    refreshPromptLibrary: async () => view(),
    choosePromptLibrarySource: async () => {
      if (!sources.length) {
        const source = { id: "pls_00000000-0000-0000-0000-000000000001", root: "D:/demo-prompts", label: "demo-prompts" };
        sources = [source];
        entries = [
          { id: "pl_00000000000000000000000000000001", sourceId: source.id, name: "代码审查", relativePath: "代码审查.md", size: 56, updatedAt: new Date().toISOString(), available: true },
          { id: "pl_00000000000000000000000000000002", sourceId: source.id, name: "release", relativePath: "work/release.md", size: 34, updatedAt: new Date().toISOString(), available: true },
        ];
        texts.set(entries[0].id, "Review this change. Inspect edge cases and errors.");
        texts.set(entries[1].id, "Prepare a release checklist.");
      }
      return view();
    },
    removePromptLibrarySource: async (id) => {
      if (!sources.some((source) => source.id === id)) throw new Error("Unknown library source");
      for (const entry of entries.filter((entry) => entry.sourceId === id)) { delete metadata[entry.id]; texts.delete(entry.id); }
      sources = sources.filter((source) => source.id !== id); entries = entries.filter((entry) => entry.sourceId !== id); previews.clear(); return view();
    },
    updatePromptLibraryMetadata: async (id, patch) => { if (!texts.has(id)) throw new Error("Unknown library entry"); metadata[id] = normalizeLibraryMetadata(metadata[id], patch); return structuredClone(metadata[id]); },
    readPromptLibraryEntry: async (id) => { const entry = entries.find((item) => item.id === id); if (!entry) throw new Error("Unknown library entry"); note(id, "open"); return { entry: { ...entry }, content: texts.get(id)!, hash: "d".repeat(64) }; },
    notePromptLibraryUse: async (id) => { note(id, "copy"); },
    previewPromptAdoption: async (profileId, entryId, name) => {
      validateSurfaceName(name); if (!texts.has(entryId)) throw new Error("Unknown library entry");
      const before = targets.get(key(profileId, "prompt", name));
      const preview = { id: `pa_${crypto.randomUUID()}`, profileId, entryId, name, targetPath: `~/.omp/${profileId === "default" ? "agent" : `profiles/${profileId}/agent`}/prompts/${name}.md`, beforeText: before ?? "", content: texts.get(entryId)!, overwriteRequired: before !== undefined };
      previews.set(preview.id, preview); return { ...preview };
    },
    commitPromptAdoption: async (id, overwrite) => {
      const preview = previews.get(id); if (!preview) throw new Error("Preview expired");
      const targetKey = key(preview.profileId, "prompt", preview.name); const before = targets.get(targetKey);
      if ((before !== undefined) !== preview.overwriteRequired || (before ?? "") !== preview.beforeText) throw new Error("Prompt target changed; preview again");
      if (preview.overwriteRequired && !overwrite) throw new Error("Explicit overwrite confirmation is required");
      if (texts.get(preview.entryId) !== preview.content) throw new Error("Source changed");
      const snapshot: PromptWriteSnapshot = { id: `ps_${crypto.randomUUID()}`, profile: preview.profileId, name: preview.name, createdAt: new Date().toISOString(), existed: preview.overwriteRequired, afterHash: "d".repeat(64), status: "committed" };
      targets.set(targetKey, preview.content); snapshots.set(snapshot.id, { snapshot, before, after: preview.content }); previews.delete(id); note(preview.entryId, "adopt"); return { ...snapshot };
    },
    listPromptAdoptions: async (profile) => Array.from(snapshots.values()).filter((record) => record.snapshot.profile === profile).reverse().map((record) => ({ ...record.snapshot })),
    restorePromptAdoption: async (profile, id) => {
      const record = snapshots.get(id); if (!record || record.snapshot.profile !== profile || record.snapshot.status === "restored") throw new Error("Invalid snapshot");
      const targetKey = key(profile, "prompt", record.snapshot.name);
      if (targets.get(targetKey) !== record.after) throw new Error("Prompt changed after adoption");
      if (record.before === undefined) targets.delete(targetKey); else targets.set(targetKey, record.before);
      record.snapshot.status = "restored";
    },
    listSurface: async (profile, kind) => Array.from(targets.keys()).filter((k) => k.startsWith(`${profile}\0${kind}\0`)).map((k) => ({ id: k, name: k.split("\0")[2], path: k.split("\0")[2], source: "profile" as const, enabled: true })),
    readSurface: async (profile, kind, name) => { const value = targets.get(key(profile, kind, name)); if (value === undefined) throw new Error("Surface entry not found"); return value; },
    writeSurface: async (profile, kind, name, content) => { validateSurfaceName(name); targets.set(key(profile, kind, name), content); return { id: key(profile, kind, name), name, path: name, source: "profile" as const, enabled: true }; },
    deleteSurface: async (profile, kind, name) => { targets.delete(key(profile, kind, name)); },
  };
}
