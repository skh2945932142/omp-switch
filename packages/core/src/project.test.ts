import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describeOverlayPrecedence, findProjectOverlay } from "./project";
import { collectReferencedCredentialIds } from "./adapter";

const tempRoots: string[] = [];

async function makeProject(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-project-test-"));
  tempRoots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("project overlay", () => {
  it("finds the nearest .omp directory walking upward", async () => {
    const root = await makeProject({ ".omp/models.yml": "providers: {}\n", "nested/deep/keep.txt": "x" });
    const overlay = await findProjectOverlay(path.join(root, "nested", "deep"));
    expect(overlay?.root).toBe(root);
  });

  it("stops before the home directory instead of reporting ~/.omp as a project overlay", async () => {
    // The user-level config is what this app already edits; surfacing it as a project overlay would
    // be plainly wrong, and every temp dir on Windows lives under the home directory.
    const home = await makeProject({ ".omp/models.yml": "providers: {}\n", "work/nested/keep.txt": "x" });
    expect(await findProjectOverlay(path.join(home, "work", "nested"), { homeDir: home })).toBeNull();
    // Without the boundary the walk escapes and picks up the home-level directory.
    expect((await findProjectOverlay(path.join(home, "work", "nested")))?.root).toBe(home);
  });

  it("still finds a real project overlay inside the home directory", async () => {
    const home = await makeProject({ "work/project/.omp/config.yml": "enabledModels:\n  - openai/gpt-5\n" });
    const overlay = await findProjectOverlay(path.join(home, "work", "project"), { homeDir: home });
    expect(overlay?.root).toBe(path.join(home, "work", "project"));
  });

  it("warns that a project array replaces the user-level array rather than merging", async () => {
    const root = await makeProject({
      ".omp/config.yml": "enabledModels:\n  - openai/gpt-5\nmodelProviderOrder:\n  - openai\n",
    });
    const overlay = await findProjectOverlay(root);
    const diagnostics = describeOverlayPrecedence(overlay!, {
      enabledModels: ["anthropic/claude-sonnet-4-5", "groq/llama-3.3"],
      modelProviderOrder: ["anthropic"],
    });
    const replaced = diagnostics.filter((item) => item.code === "overlay.array-replaced");
    expect(replaced.map((item) => item.path).sort()).toEqual(["enabledModels", "modelProviderOrder"]);
    expect(replaced[0].severity).toBe("warning");
    expect(replaced.find((item) => item.path === "enabledModels")?.message).toContain("2 user-level entries");
  });

  it("stays quiet when the user has no competing array", async () => {
    const root = await makeProject({ ".omp/config.yml": "enabledModels:\n  - openai/gpt-5\n" });
    const overlay = await findProjectOverlay(root);
    expect(describeOverlayPrecedence(overlay!, {})).toEqual([]);
  });

  it("warns when modelRoleStorage sends role writes to the project file", async () => {
    const root = await makeProject({ ".omp/config.yml": "modelRoleStorage: project\n" });
    const overlay = await findProjectOverlay(root);
    const diagnostics = describeOverlayPrecedence(overlay!, {});
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: "warning", code: "overlay.role-storage" }),
    ]);
  });

  it("notes a project layer that reapplies its own model roles", async () => {
    const root = await makeProject({ ".omp/config.yml": "modelRoles:\n  default: openai/gpt-5\n" });
    const overlay = await findProjectOverlay(root);
    expect(describeOverlayPrecedence(overlay!, { modelRoles: { default: "anthropic/claude" } }).map((item) => item.code))
      .toContain("overlay.model-roles");
  });
});

describe("credential references", () => {
  it("extracts credential ids from an !command apiKey reference", () => {
    const ids = collectReferencedCredentialIds({
      providers: {
        openai: { apiKey: '!"C:\\data\\omp-switch-secret.exe" --secret-get "credential-abc" --data-dir "C:\\data"' },
        team: { headers: { "X-Team-Key": '!"bridge.exe" --secret-get "credential-xyz"' } },
        plain: { apiKey: "OPENAI_API_KEY" },
      },
    });
    expect(Array.from(ids).sort()).toEqual(["credential-abc", "credential-xyz"]);
  });

  it("returns nothing for a config with no command references", () => {
    expect(collectReferencedCredentialIds({ providers: {} }).size).toBe(0);
    expect(collectReferencedCredentialIds({ providers: { a: { apiKey: "sk-literal" } } }).size).toBe(0);
  });

  it("ignores an id that could not be a credential id", () => {
    // The vault only ever writes ids matching the anchored pattern, so a mismatch is not a reference.
    expect(collectReferencedCredentialIds({ providers: { a: { apiKey: '!x --secret-get "../escape"' } } }).size).toBe(0);
  });
});
