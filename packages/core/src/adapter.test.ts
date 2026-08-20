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
  it("previewPatch returns the exact text a commit would write, without touching the disk", async () => {
    const { root, adapter } = await makeAdapter();
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    const patch: Parameters<OmpFilesystemAdapter["planPatch"]>[1] = {
      provider: {
        id: "demo",
        baseUrl: "https://api.example.test/v1",
        api: "openai-completions",
        auth: "none",
        models: [{ id: "demo-1", api: "openai-completions" }],
      },
      roleAssignments: { default: "demo/demo-1" },
    };
    const before = await fs.readFile((current as { models: { path: string } }).models.path, "utf8").catch(() => "");

    const preview = adapter.previewPatch(current, patch);

    expect(preview.modelsText).toContain("demo:");
    expect(preview.settingsText).toContain("default: demo/demo-1");
    // Nothing was written: the file on disk is unchanged (still absent in this fresh home) and no
    // snapshot directory exists.
    const after = await fs.readFile((current as { models: { path: string } }).models.path, "utf8").catch(() => "");
    expect(after).toBe(before);
    await expect(fs.readdir(path.join(root, "snapshots"))).rejects.toMatchObject({ code: "ENOENT" });

    // And committing the same patch produces byte-identical text.
    const result = await adapter.commitPatch(current, adapter.planPatch(current, patch));
    await expect(fs.readFile(result.config.models.path, "utf8")).resolves.toBe(preview.modelsText);
    await expect(fs.readFile(result.config.settings.path, "utf8")).resolves.toBe(preview.settingsText);
  });

  it("previewPatch refuses the same invalid patches commitPatch refuses", async () => {
    const { adapter } = await makeAdapter();
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    expect(() => adapter.previewPatch(current, { provider: { id: "x" } as never })).toThrow(ConfigValidationError);
  });

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

  it("refuses to restore over an edit made after the snapshot, unless forced", async () => {
    const { adapter } = await makeAdapter();
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    const result = await adapter.commitPatch(current, adapter.planPatch(current, {
      provider: { id: "demo", baseUrl: "https://api.example.test/v1", api: "openai-completions", auth: "none", models: [{ id: "demo-1" }] },
    }));

    // Something else edits the file after OMP Switch wrote it.
    await fs.appendFile(result.config.models.path, "\n# edited by another tool\n");

    await expect(adapter.restoreSnapshot(result.snapshot)).rejects.toBeInstanceOf(ConfigConflictError);
    await expect(fs.readFile(result.config.models.path, "utf8")).resolves.toContain("another tool");

    await adapter.restoreSnapshot(result.snapshot, { force: true });
    await expect(fs.access(result.config.models.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("edits an anchored provider in place so the anchor and its aliases survive", async () => {
    const { root, adapter } = await makeAdapter();
    const agentDir = path.join(root, ".omp", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentDir, "models.yml"),
      [
        "providers:",
        "  shared: &common",
        "    baseUrl: https://api.example.test/v1",
        "    api: openai-completions",
        "    auth: none",
        "    models:",
        "      - id: shared-1",
        "  mirror: *common",
        "",
      ].join("\n"),
    );
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    expect(current.models.diagnostics.some((item) => item.code === "yaml.anchors")).toBe(true);

    const result = await adapter.commitPatch(current, adapter.planPatch(current, {
      provider: { id: "shared", baseUrl: "https://changed.example/v1", api: "openai-completions", auth: "none", models: [{ id: "shared-1" }] },
    }));

    const written = await fs.readFile(result.config.models.path, "utf8");
    // The anchor is mutated in place rather than expanded, so `*common` keeps meaning what the user
    // wrote: mirror follows shared. Expanding it would silently duplicate the config instead.
    expect(written).toContain("&common");
    expect(written).toContain("mirror: *common");
    expect(result.config.models.value.providers.mirror.baseUrl).toBe("https://changed.example/v1");
  });

  it("refuses to delete an anchored provider or rewrite an alias", async () => {
    const { root, adapter } = await makeAdapter();
    const agentDir = path.join(root, ".omp", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    const original = [
      "providers:",
      "  shared: &common",
      "    baseUrl: https://api.example.test/v1",
      "    api: openai-completions",
      "    auth: none",
      "  mirror: *common",
      "",
    ].join("\n");
    await fs.writeFile(path.join(agentDir, "models.yml"), original);
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);

    // Removing the anchor target would leave `mirror: *common` dangling and unparseable.
    await expect(adapter.commitPatch(current, adapter.planPatch(current, { removeProviderId: "shared" }))).rejects.toThrow(/anchor or alias/);
    // Replacing the alias node would expand it and lose the sharing the user asked for.
    await expect(adapter.commitPatch(current, adapter.planPatch(current, {
      provider: { id: "mirror", baseUrl: "https://other.example/v1", api: "openai-completions", auth: "none", models: [{ id: "m" }] },
    }))).rejects.toThrow(/anchor or alias/);

    await expect(fs.readFile(path.join(agentDir, "models.yml"), "utf8")).resolves.toBe(original);
  });

  it("still patches an unrelated provider in a file that uses anchors elsewhere", async () => {
    const { root, adapter } = await makeAdapter();
    const agentDir = path.join(root, ".omp", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentDir, "models.yml"),
      [
        "providers:",
        "  shared: &common",
        "    baseUrl: https://api.example.test/v1",
        "    api: openai-completions",
        "    auth: none",
        "  mirror: *common",
        "",
      ].join("\n"),
    );
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    const result = await adapter.commitPatch(current, adapter.planPatch(current, {
      provider: { id: "fresh", baseUrl: "https://fresh.example/v1", api: "openai-completions", auth: "none", models: [{ id: "fresh-1" }] },
    }));
    const written = await fs.readFile(result.config.models.path, "utf8");
    expect(written).toContain("mirror: *common");
    expect(written).toContain("fresh:");
  });

  it("prunes snapshot directories beyond the retention limit", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-switch-test-"));
    tempRoots.push(root);
    const adapter = new OmpFilesystemAdapter({ homeDir: root, snapshotDir: path.join(root, "snapshots"), snapshotRetention: 3 });
    const profile = (await adapter.listProfiles())[0];
    for (let index = 0; index < 5; index += 1) {
      const current = await adapter.loadProfile(profile);
      await adapter.commitPatch(current, adapter.planPatch(current, {
        provider: { id: `demo${index}`, baseUrl: "https://api.example.test/v1", api: "openai-completions", auth: "none", models: [{ id: "m" }] },
      }));
    }
    const remaining = await fs.readdir(path.join(root, "snapshots", "default"));
    expect(remaining.length).toBe(3);
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

  it("writes OMP settings fields without replacing unrelated config", async () => {
    const { root, adapter } = await makeAdapter();
    const agentDir = path.join(root, ".omp", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(path.join(agentDir, "models.yml"), "providers:\n  demo:\n    baseUrl: https://demo.example/v1\n    api: openai-completions\n    auth: none\n    models:\n      - id: demo-model\n");
    await fs.writeFile(path.join(agentDir, "config.yml"), "# keep this note\nmodelRoles:\n  default: demo/demo-model\ncustomSetting: keep\n");
    const profile = (await adapter.listProfiles())[0];
    const current = await adapter.loadProfile(profile);
    const result = await adapter.commitPatch(current, adapter.planPatch(current, {
      settings: {
        modelProviderOrder: ["demo"],
        enabledModels: ["demo/*"],
        defaultThinkingLevel: "xhigh",
      },
    }));
    const updated = await fs.readFile(result.config.settings.path, "utf8");
    expect(updated).toContain("# keep this note");
    expect(updated).toContain("customSetting: keep");
    expect(updated).toContain("modelProviderOrder:");
    expect(updated).toContain("defaultThinkingLevel: xhigh");
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
