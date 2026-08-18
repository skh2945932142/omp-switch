import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigConflictError, ConfigValidationError, OmpFilesystemAdapter } from "./index";

const tempRoots: string[] = [];

async function makeAdapter() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-switch-test-"));
  tempRoots.push(root);
  return {
    root,
    adapter: new OmpFilesystemAdapter({ homeDir: root, snapshotDir: path.join(root, "snapshots") }),
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("OmpFilesystemAdapter", () => {
  it("creates missing models.yml and config.yml from a validated patch", async () => {
    const { adapter } = await makeAdapter();
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    const preview = adapter.planPatch(current, {
      provider: {
        id: "demo",
        baseUrl: "https://api.example.test/v1",
        api: "openai-completions",
        auth: "none",
        models: [{ id: "demo-1", api: "openai-completions" }],
      },
      roleAssignments: { default: "demo/demo-1" },
    });

    const result = await adapter.commitPatch(current, preview);

    await expect(fs.readFile(result.config.models.path, "utf8")).resolves.toContain("demo:");
    await expect(fs.readFile(result.config.settings.path, "utf8")).resolves.toContain("default: demo/demo-1");
    expect(result.snapshot.profile).toBe("default");
  });

  it("preserves comments and an untouched provider when patching another provider", async () => {
    const { root, adapter } = await makeAdapter();
    const agentDir = path.join(root, ".omp", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentDir, "models.yml"),
      "# personal routing notes\nproviders:\n  keep: # do not alter\n    baseUrl: https://keep.example/v1\n    apiKey: KEEP_KEY\n    api: openai-completions\n    models:\n      - id: keep-model\n",
    );
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    const preview = adapter.planPatch(current, {
      provider: {
        id: "new",
        baseUrl: "https://new.example/v1",
        api: "openai-completions",
        auth: "none",
        models: [{ id: "new-model", api: "openai-completions" }],
      },
    });

    await adapter.commitPatch(current, preview);

    const updated = await fs.readFile(path.join(agentDir, "models.yml"), "utf8");
    expect(updated).toContain("# personal routing notes");
    expect(updated).toContain("# do not alter");
    expect(updated).toContain("keep:");
    expect(updated).toContain("new:");
  });

  it("preserves comments and unknown fields when editing an existing provider", async () => {
    const { root, adapter } = await makeAdapter();
    const agentDir = path.join(root, ".omp", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentDir, "models.yml"),
      "providers:\n  demo: # provider note\n    # endpoint note\n    baseUrl: https://old.example/v1\n    api: openai-completions\n    apiKey: DEMO_KEY\n    customRouting:\n      # retain this nested note\n      region: local\n    models:\n      - id: demo-model\n",
    );
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    const preview = adapter.planPatch(current, {
      provider: {
        id: "demo",
        baseUrl: "https://new.example/v1",
        api: "openai-completions",
        models: [{ id: "demo-model" }],
      },
    });

    await adapter.commitPatch(current, preview);

    const updated = await fs.readFile(path.join(agentDir, "models.yml"), "utf8");
    expect(updated).toContain("# provider note");
    expect(updated).toContain("# endpoint note");
    expect(updated).toContain("# retain this nested note");
    expect(updated).toContain("customRouting:");
    expect(updated).toContain("https://new.example/v1");
  });

  it("stops a commit when the source file changed after it was loaded", async () => {
    const { root, adapter } = await makeAdapter();
    const agentDir = path.join(root, ".omp", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    const modelsPath = path.join(agentDir, "models.yml");
    await fs.writeFile(modelsPath, "providers: {}\n");
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    const preview = adapter.planPatch(current, {
      provider: {
        id: "demo",
        baseUrl: "https://api.example.test/v1",
        api: "openai-completions",
        auth: "none",
        models: [{ id: "demo-1", api: "openai-completions" }],
      },
    });
    await fs.writeFile(modelsPath, "providers:\n  external: {}\n");

    await expect(adapter.commitPatch(current, preview)).rejects.toBeInstanceOf(ConfigConflictError);
  });

  it("stops a first write when a file appears after the profile was loaded", async () => {
    const { root, adapter } = await makeAdapter();
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    const preview = adapter.planPatch(current, {
      provider: {
        id: "demo",
        baseUrl: "https://api.example.test/v1",
        api: "openai-completions",
        auth: "none",
        models: [{ id: "demo-1" }],
      },
    });
    const agentDir = path.join(root, ".omp", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(path.join(agentDir, "models.yml"), "providers:\n  external: {}\n");

    await expect(adapter.commitPatch(current, preview)).rejects.toBeInstanceOf(ConfigConflictError);
  });

  it("restores a first-write snapshot by removing newly created files", async () => {
    const { adapter } = await makeAdapter();
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    const preview = adapter.planPatch(current, {
      provider: {
        id: "demo",
        baseUrl: "https://api.example.test/v1",
        api: "openai-completions",
        auth: "none",
        models: [{ id: "demo-1", api: "openai-completions" }],
      },
    });
    const result = await adapter.commitPatch(current, preview);

    await adapter.restoreSnapshot(result.snapshot);

    await expect(fs.access(result.config.models.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(result.config.settings.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires confirmation before migrating legacy models.json", async () => {
    const { root, adapter } = await makeAdapter();
    const agentDir = path.join(root, ".omp", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentDir, "models.json"),
      JSON.stringify({ providers: { legacy: { baseUrl: "https://legacy.example/v1", api: "openai-completions", auth: "none", models: [{ id: "legacy-model" }] } } }),
    );
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    const patch = {
      provider: {
        id: "legacy",
        baseUrl: "https://legacy.example/v1",
        api: "openai-completions",
        auth: "none",
        models: [{ id: "legacy-model" }],
      },
    };

    await expect(adapter.commitPatch(current, adapter.planPatch(current, patch))).rejects.toBeInstanceOf(ConfigValidationError);
    const result = await adapter.commitPatch(current, adapter.planPatch(current, { ...patch, confirmLegacyMigration: true }));

    await expect(fs.access(path.join(agentDir, "models.yml"))).resolves.toBeUndefined();
    await adapter.restoreSnapshot(result.snapshot);
    await expect(fs.access(path.join(agentDir, "models.yml"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(path.join(agentDir, "models.json"))).resolves.toBeUndefined();
  });

  it("persists and explicitly clears supported provider extension fields", async () => {
    const { adapter } = await makeAdapter();
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    const created = await adapter.commitPatch(current, adapter.planPatch(current, {
      provider: {
        id: "demo",
        baseUrl: "https://api.example.test/v1",
        api: "openai-completions",
        auth: "none",
        headers: { "X-Client": "omp-switch" },
        compat: { supportsReasoning: true },
        modelOverrides: { "demo-model": { maxTokens: 2048 } },
        models: [{ id: "demo-model" }],
      },
    }));
    expect(created.config.models.value.providers.demo).toMatchObject({
      headers: { "X-Client": "omp-switch" },
      compat: { supportsReasoning: true },
      modelOverrides: { "demo-model": { maxTokens: 2048 } },
    });

    const cleared = await adapter.commitPatch(created.config, adapter.planPatch(created.config, {
      provider: {
        id: "demo",
        baseUrl: "https://api.example.test/v1",
        api: "openai-completions",
        auth: "none",
        headers: null,
        compat: null,
        modelOverrides: null,
        models: [{ id: "demo-model" }],
      },
    }));
    expect(cleared.config.models.value.providers.demo.headers).toBeUndefined();
    expect(cleared.config.models.value.providers.demo.compat).toBeUndefined();
    expect(cleared.config.models.value.providers.demo.modelOverrides).toBeUndefined();
  });

  it("refuses writes when the OMP version adapter is read-only", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-switch-test-"));
    tempRoots.push(root);
    const adapter = new OmpFilesystemAdapter({
      homeDir: root,
      snapshotDir: path.join(root, "snapshots"),
      installation: { executable: "omp", version: "99.0.0", supported: false, reason: "Unsupported OMP schema" },
    });
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    const preview = adapter.planPatch(current, {
      provider: {
        id: "demo",
        baseUrl: "https://api.example.test/v1",
        api: "openai-completions",
        auth: "none",
        models: [{ id: "demo-model" }],
      },
    });

    await expect(adapter.commitPatch(current, preview)).rejects.toBeInstanceOf(ConfigValidationError);
  });
});
