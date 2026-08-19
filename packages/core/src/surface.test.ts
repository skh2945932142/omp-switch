import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OmpSurfaceAdapter, validateSurfaceName } from "./surface";

const roots: string[] = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-switch-surface-"));
  roots.push(root);
  return { adapter: new OmpSurfaceAdapter(), profile: { id: "default", name: "Default", kind: "default" as const, agentDir: path.join(root, ".omp", "agent") } };
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe("OMP managed surfaces", () => {
  it("creates, lists, exports and imports prompts and skills", async () => {
    const { adapter, profile } = await fixture();
    await adapter.write(profile, "prompt", "review", "Review this change.");
    await adapter.write(profile, "skill", "release", "---\nname: release\n---\n");
    expect((await adapter.list(profile, "prompt")).map((entry) => entry.name)).toEqual(["review"]);
    expect((await adapter.list(profile, "skill")).map((entry) => entry.name)).toEqual(["release"]);
    const bundle = await adapter.exportBundle(profile);
    expect(bundle.items).toHaveLength(2);
    const second = { ...profile, id: "work", name: "work", kind: "named" as const, agentDir: path.join(path.dirname(profile.agentDir), "profiles", "work", "agent") };
    await adapter.importBundle(second, bundle);
    expect(await adapter.list(second, "skill")).toHaveLength(1);
  });

  it("rejects traversal before it reaches the filesystem", () => {
    expect(() => validateSurfaceName("../secret")).toThrow();
    expect(() => validateSurfaceName("skill/name")).toThrow();
  });

  it("keeps profile entries ahead of read-only project sources", async () => {
    const { profile } = await fixture();
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-switch-project-surface-"));
    roots.push(projectRoot);
    await fs.mkdir(path.join(projectRoot, "skills", "shared"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "skills", "shared", "SKILL.md"), "project");
    await fs.mkdir(path.join(profile.agentDir, "skills", "shared"), { recursive: true });
    await fs.writeFile(path.join(profile.agentDir, "skills", "shared", "SKILL.md"), "profile");
    const adapter = new OmpSurfaceAdapter({ projectRoot });
    const entries = await adapter.list(profile, "skill");
    expect(entries.filter((entry) => entry.name === "shared")).toHaveLength(1);
    expect(entries.find((entry) => entry.name === "shared")?.source).toBe("profile");
  });
});
