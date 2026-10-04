import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MetadataStore } from "./metadata-store";
import { PromptLibraryService } from "./prompt-library-service";
const roots: string[] = []; const stores: MetadataStore[] = [];
async function fixture(backend: "auto" | "json") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-library-service-")); roots.push(root);
  const store = new MetadataStore(path.join(root, "data"), { backend }); await store.init(); stores.push(store);
  const sourceRoot = path.join(root, "materials"); await fs.mkdir(sourceRoot);
  const file = path.join(sourceRoot, "代码审查.md"); await fs.writeFile(file, "UNIQUE_BODY_MARKER inspect errors");
  const profile = { id: "default", name: "Default", kind: "default" as const, agentDir: path.join(root, "agent") };
  let writable = true;
  const options = { snapshotDir: path.join(root, "snapshots"), profileFor: (id: string) => ({ ...profile, id }), isWritable: () => writable };
  const service = new PromptLibraryService(store, options);
  return { root, store, sourceRoot, file, profile, options, service, readOnly: () => { writable = false; } };
}
afterEach(async () => { for (const store of stores.splice(0)) store.close(); await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe.each(["auto", "json"] as const)("prompt library persistence (%s)", (backend) => {
  it("persists references and classification across restart, but never body text", async () => {
    const { service, store, options, sourceRoot } = await fixture(backend);
    const view = await service.addSource(sourceRoot); const id = view.entries[0].id;
    await service.updateMetadata(id, { favorite: true, tags: ["排错", "排错", " code "] });
    await service.read(id); await service.noteUse(id, "copy");
    expect((await service.list("errors")).entries).toHaveLength(1);
    const reopened = new PromptLibraryService(store, options); const saved = await reopened.list();
    expect(saved.metadata[id]).toMatchObject({ favorite: true, tags: ["排错", "code"], lastAction: "copy" });
    expect(saved.metadata[id].lastUsedAt).toBeTruthy();
    expect(JSON.stringify(store.getPreference("promptLibrary.v1"))).not.toContain("UNIQUE_BODY_MARKER");
  });
  it("merges concurrent favorite and tag edits without lost updates", async () => {
    const { service, sourceRoot } = await fixture(backend); const view = await service.addSource(sourceRoot); const id = view.entries[0].id;
    await Promise.all([service.updateMetadata(id, { favorite: true }), service.updateMetadata(id, { tags: ["work"] })]);
    expect((await service.list()).metadata[id]).toMatchObject({ favorite: true, tags: ["work"] });
    await expect(service.updateMetadata(id, { tags: ["bad\nline"] })).rejects.toThrow();
  });
  it("shows lost files after restart instead of dropping favorites", async () => {
    const { service, sourceRoot, file, store, options } = await fixture(backend); const view = await service.addSource(sourceRoot); const id = view.entries[0].id;
    await service.updateMetadata(id, { favorite: true }); await fs.unlink(file);
    const reopened = new PromptLibraryService(store, options); const saved = await reopened.list();
    expect(saved.entries[0]).toMatchObject({ id, available: false }); expect(saved.metadata[id].favorite).toBe(true);
  });
  it("removes references and classification without deleting the source", async () => {
    const { service, sourceRoot, file } = await fixture(backend); const view = await service.addSource(sourceRoot);
    await service.updateMetadata(view.entries[0].id, { favorite: true }); await service.removeSource(view.sources[0].id);
    const next = await service.list(); expect(next.sources).toEqual([]); expect(next.entries).toEqual([]); expect(next.metadata).toEqual({});
    expect(await fs.readFile(file, "utf8")).toContain("UNIQUE_BODY_MARKER");
  });
  it("adopts and restores through owned preview handles", async () => {
    const { service, sourceRoot, profile, store, options } = await fixture(backend); const view = await service.addSource(sourceRoot);
    const preview = await service.previewAdoption("default", view.entries[0].id, "review");
    expect(preview.overwriteRequired).toBe(false);
    const snapshot = await service.commitAdoption(preview.id, false);
    const target = path.join(profile.agentDir, "prompts", "review.md");
    expect(await fs.readFile(target, "utf8")).toContain("UNIQUE_BODY_MARKER");
    await expect(service.commitAdoption(preview.id, false)).rejects.toThrow();
    const reopened = new PromptLibraryService(store, options);
    expect(await reopened.listSnapshots("default")).toHaveLength(1);
    await reopened.restoreSnapshot("default", snapshot.id); await expect(fs.stat(target)).rejects.toThrow();
  });
  it("refuses source edits after preview and guessed preview handles", async () => {
    const { service, sourceRoot, file, profile } = await fixture(backend); const view = await service.addSource(sourceRoot);
    const preview = await service.previewAdoption("default", view.entries[0].id, "review"); await fs.writeFile(file, "changed source");
    await expect(service.commitAdoption(preview.id, true)).rejects.toThrow(/changed/i);
    await expect(fs.stat(profile.agentDir)).rejects.toThrow();
    await expect(service.commitAdoption("pa_fake", true)).rejects.toThrow();
    await expect(service.read("../../anything")).rejects.toThrow();
  });
  it("enforces read-only mode again at confirmation and restore", async () => {
    const { service, sourceRoot, readOnly, profile } = await fixture(backend); const view = await service.addSource(sourceRoot);
    const preview = await service.previewAdoption("default", view.entries[0].id, "review"); readOnly();
    await expect(service.commitAdoption(preview.id, false)).rejects.toThrow(/read.only/i);
    await expect(service.previewAdoption("default", view.entries[0].id, "review")).rejects.toThrow(/read.only/i);
    await expect(service.restoreSnapshot("default", "ps_00000000-0000-0000-0000-000000000000")).rejects.toThrow(/read.only/i);
    expect((await service.list()).entries).toHaveLength(1); await expect(fs.stat(profile.agentDir)).rejects.toThrow();
  });
});
