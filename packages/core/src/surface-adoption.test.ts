import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OmpSurfaceAdapter } from "./surface";
const roots: string[] = [];
async function fixture(retention = 30) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-adoption-")); roots.push(root);
  const profile = { id: "default", name: "Default", kind: "default" as const, agentDir: path.join(root, "agent") };
  const snapshotDir = path.join(root, "snapshots");
  const adapter = new OmpSurfaceAdapter({ snapshotDir, snapshotRetention: retention });
  return { root, profile, adapter, snapshotDir, target: path.join(profile.agentDir, "prompts", "review.md") };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("guarded prompt adoption", () => {
  it("previews without filesystem writes, adopts a copy and safely undoes creation", async () => {
    const { adapter, profile, target } = await fixture();
    const preview = await adapter.previewPromptWrite(profile, "review", "new text");
    await expect(fs.stat(profile.agentDir)).rejects.toThrow();
    expect(preview.beforeText).toBe(""); expect(preview.expected.exists).toBe(false);
    const snapshot = await adapter.commitPromptWrite(profile, preview);
    expect(await fs.readFile(target, "utf8")).toBe("new text");
    expect(await adapter.listPromptSnapshots(profile)).toHaveLength(1);
    await adapter.restorePromptSnapshot(profile, snapshot.id);
    await expect(fs.stat(target)).rejects.toThrow();
    expect((await adapter.listPromptSnapshots(profile))[0].status).toBe("restored");
  });
  it("requires explicit overwrite and restores the original target", async () => {
    const { adapter, profile, target } = await fixture();
    await adapter.write(profile, "prompt", "review", "original");
    const preview = await adapter.previewPromptWrite(profile, "review", "replacement");
    expect(preview.beforeText).toBe("original");
    await expect(adapter.commitPromptWrite(profile, preview)).rejects.toThrow(/overwrite/i);
    expect(await fs.readFile(target, "utf8")).toBe("original");
    const snapshot = await adapter.commitPromptWrite(profile, preview, true);
    await adapter.restorePromptSnapshot(profile, snapshot.id);
    expect(await fs.readFile(target, "utf8")).toBe("original");
  });
  it("refuses external edits between preview and confirmation", async () => {
    const { adapter, profile, target } = await fixture();
    await adapter.write(profile, "prompt", "review", "original");
    const preview = await adapter.previewPromptWrite(profile, "review", "replacement");
    await fs.writeFile(target, "editor change");
    await expect(adapter.commitPromptWrite(profile, preview, true)).rejects.toThrow();
    expect(await fs.readFile(target, "utf8")).toBe("editor change");
    expect(await adapter.listPromptSnapshots(profile)).toEqual([]);
  });
  it("refuses a target created after the preview", async () => {
    const { adapter, profile, target } = await fixture();
    const preview = await adapter.previewPromptWrite(profile, "review", "new");
    await adapter.write(profile, "prompt", "review", "someone else");
    await expect(adapter.commitPromptWrite(profile, preview, true)).rejects.toThrow();
    expect(await fs.readFile(target, "utf8")).toBe("someone else");
  });
  it("does not write when the snapshot cannot be saved", async () => {
    const { adapter, profile, snapshotDir, target } = await fixture();
    await adapter.write(profile, "prompt", "review", "original");
    const preview = await adapter.previewPromptWrite(profile, "review", "new");
    await fs.writeFile(snapshotDir, "not a directory");
    await expect(adapter.commitPromptWrite(profile, preview, true)).rejects.toThrow();
    expect(await fs.readFile(target, "utf8")).toBe("original");
  });
  it("preserves old content when the final rename fails", async () => {
    const { adapter, profile, target } = await fixture();
    await adapter.write(profile, "prompt", "review", "original");
    const preview = await adapter.previewPromptWrite(profile, "review", "new");
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => { if (to === target) throw new Error("Injected rename failure"); await rename(from, to); });
    await expect(adapter.commitPromptWrite(profile, preview, true)).rejects.toThrow("Injected rename failure");
    expect(await fs.readFile(target, "utf8")).toBe("original");
  });
  it("refuses undo over an external edit, including for newly created targets", async () => {
    const { adapter, profile, target } = await fixture();
    const snapshot = await adapter.commitPromptWrite(profile, await adapter.previewPromptWrite(profile, "review", "new"));
    await fs.writeFile(target, "later edit");
    await expect(adapter.restorePromptSnapshot(profile, snapshot.id)).rejects.toThrow();
    expect(await fs.readFile(target, "utf8")).toBe("later edit");
  });
  it("rejects target symlinks before reading or writing outside the profile", async () => {
    const { adapter, profile, root } = await fixture();
    const outside = path.join(root, "outside"); await fs.mkdir(outside);
    await fs.mkdir(profile.agentDir, { recursive: true });
    await fs.symlink(outside, path.join(profile.agentDir, "prompts"), "junction");
    await expect(adapter.previewPromptWrite(profile, "review", "new")).rejects.toThrow();
    expect(await fs.readdir(outside)).toEqual([]);
  });
  it("rejects forged previews and unsafe names", async () => {
    const { adapter, profile } = await fixture();
    await expect(adapter.previewPromptWrite(profile, "../escape", "text")).rejects.toThrow();
    const preview = await adapter.previewPromptWrite(profile, "review", "text");
    await expect(adapter.commitPromptWrite(profile, { ...preview, profileId: "other" })).rejects.toThrow();
    await expect(adapter.commitPromptWrite(profile, { ...preview, targetPath: "/tmp/escape.md" })).rejects.toThrow();
    await expect(adapter.restorePromptSnapshot(profile, "../../escape")).rejects.toThrow();
  });
  it("survives restart and limits retained snapshots without losing the newest", async () => {
    const { adapter, profile, snapshotDir } = await fixture(2);
    for (let n = 0; n < 3; n++) {
      const preview = await adapter.previewPromptWrite(profile, `p${n}`, `text${n}`);
      await adapter.commitPromptWrite(profile, preview);
    }
    const reopened = new OmpSurfaceAdapter({ snapshotDir, snapshotRetention: 2 });
    const snapshots = await reopened.listPromptSnapshots(profile);
    expect(snapshots).toHaveLength(2); expect(snapshots.some((s) => s.name === "p2")).toBe(true);
    await reopened.restorePromptSnapshot(profile, snapshots.find((s) => s.name === "p2")!.id);
    await expect(fs.stat(path.join(profile.agentDir, "prompts", "p2.md"))).rejects.toThrow();
  });
});
