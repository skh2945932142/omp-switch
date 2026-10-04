import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PromptLibrary } from "./index";

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-library-"));
  roots.push(root);
  return root;
}
async function text(root: string, name: string, content = "review this change") {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return file;
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe("local prompt library", () => {
  it("keeps Chinese and duplicate names distinct by source and relative path", async () => {
    const a = await fixture(); const b = await fixture();
    await text(a, "代码审查.md"); await text(a, "nested/代码审查.md"); await text(b, "代码审查.md");
    const library = new PromptLibrary();
    const source = await library.addSource(a);
    expect((await library.addSource(a)).id).toBe(source.id);
    await library.addSource(b);
    const scan = await library.refresh();
    expect(scan.entries).toHaveLength(3);
    expect(new Set(scan.entries.map((entry) => entry.id)).size).toBe(3);
    expect(scan.entries.map((entry) => entry.relativePath)).toContain("nested/代码审查.md");
    expect(scan.issues).toEqual([]);
  });

  it("searches names and complete UTF-8 text without changing files", async () => {
    const root = await fixture(); const file = await text(root, "one.md", "检查边界情况");
    await text(root, "release.md", "prepare a build");
    const library = new PromptLibrary(); await library.addSource(root); await library.refresh();
    expect((await library.search("边界")).entries.map((e) => e.name)).toEqual(["one"]);
    expect((await library.search("release")).entries.map((e) => e.name)).toEqual(["release"]);
    expect((await library.search("missing")).entries).toEqual([]);
    expect(await fs.readFile(file, "utf8")).toBe("检查边界情况");
  });

  it("invalidates cached text after an external edit", async () => {
    const root = await fixture(); const file = await text(root, "one.md", "old marker");
    const library = new PromptLibrary(); await library.addSource(root); const { entries } = await library.refresh();
    const before = await library.read(entries[0].id);
    await fs.writeFile(file, "new marker");
    expect((await library.search("old")).entries).toEqual([]);
    const after = await library.read(entries[0].id, true);
    expect(after.content).toBe("new marker"); expect(after.hash).not.toBe(before.hash);
  });

  it("retains unavailable references after files disappear", async () => {
    const root = await fixture(); const file = await text(root, "gone.md");
    const library = new PromptLibrary(); await library.addSource(root); const first = await library.refresh();
    await fs.unlink(file);
    const next = await library.refresh();
    expect(next.entries[0]).toMatchObject({ id: first.entries[0].id, available: false });
    await expect(library.read(first.entries[0].id)).rejects.toThrow();
  });

  it("rejects guessed IDs and never follows file or directory symlinks", async () => {
    const root = await fixture(); const outside = await fixture();
    await text(outside, "secret.md", "outside");
    await fs.symlink(path.join(outside, "secret.md"), path.join(root, "link.md"));
    await fs.symlink(outside, path.join(root, "linked-dir"), "junction");
    const library = new PromptLibrary(); await library.addSource(root);
    expect((await library.refresh()).entries).toEqual([]);
    await expect(library.read("../../secret.md")).rejects.toThrow();
    expect((await library.search("outside")).entries).toEqual([]);
  });

  it("rejects a registered file replaced by an escaping symlink", async () => {
    const root = await fixture(); const outside = await fixture(); const file = await text(root, "one.md");
    const secret = await text(outside, "secret.md");
    const library = new PromptLibrary(); await library.addSource(root); const { entries } = await library.refresh();
    await fs.unlink(file); await fs.symlink(secret, file);
    await expect(library.read(entries[0].id)).rejects.toThrow();
  });

  it("bounds traversal and reports incomplete coverage", async () => {
    const root = await fixture();
    await text(root, "one.md"); await text(root, "nested/two.md"); await text(root, ".hidden.md");
    await text(root, "node_modules/ignored.md");
    const library = new PromptLibrary([], { maxDepth: 0 }); await library.addSource(root);
    const scan = await library.refresh();
    expect(scan.entries.map((e) => e.name)).toEqual(["one"]);
    expect(scan.issues.some((i) => i.code === "depth")).toBe(true);
  });

  it("bounds the number of collected files", async () => {
    const root = await fixture(); await text(root, "a.md"); await text(root, "b.md");
    const library = new PromptLibrary([], { maxFiles: 1 }); await library.addSource(root);
    const scan = await library.refresh();
    expect(scan.entries).toHaveLength(1); expect(scan.issues.some((i) => i.code === "files")).toBe(true);
  });

  it("reports oversized text rather than exporting a truncated preview", async () => {
    const root = await fixture(); await text(root, "big.md", "0123456789");
    const library = new PromptLibrary([], { maxFileBytes: 5 }); await library.addSource(root);
    const { entries } = await library.refresh();
    expect(entries[0].available).toBe(false);
    await expect(library.read(entries[0].id)).rejects.toThrow();
    expect((await library.search("012")).entries).toEqual([]);
  });

  it("reports invalid UTF-8 without replacing undecodable bytes", async () => {
    const root = await fixture(); await fs.writeFile(path.join(root, "bad.md"), Buffer.from([0xc3, 0x28]));
    const library = new PromptLibrary(); await library.addSource(root); const { entries } = await library.refresh();
    await expect(library.read(entries[0].id)).rejects.toThrow();
    expect((await library.search("anything")).issues.some((i) => i.code === "encoding")).toBe(true);
  });

  it("limits body search work and exposes the skipped coverage", async () => {
    const root = await fixture(); await text(root, "a.md", "first"); await text(root, "b.md", "second");
    const library = new PromptLibrary([], { maxSearchBytes: 5, maxCacheBytes: 5 }); await library.addSource(root); await library.refresh();
    const found = await library.search("second");
    expect(found.complete).toBe(false); expect(found.issues.some((i) => i.code === "budget")).toBe(true);
    expect((await library.read((await library.refresh()).entries.find((e) => e.name === "b")!.id)).content).toBe("second");
  });

  it("removes a source from the trusted read registry", async () => {
    const root = await fixture(); await text(root, "one.md");
    const library = new PromptLibrary(); const source = await library.addSource(root); const { entries } = await library.refresh();
    library.removeSource(source.id);
    expect((await library.refresh()).entries).toEqual([]);
    await expect(library.read(entries[0].id)).rejects.toThrow();
  });
});
