import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OmpFilesystemAdapter } from "./adapter";
import { parseJsonCliArguments, runJsonCli } from "./cli";
import { toProfileRef } from "./paths";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe("JSON CLI", () => {
  it("parses and executes plan command without committing changes", async () => {
    expect(parseJsonCliArguments(["plan", "--profile", "work", "--patch", '{"roleAssignments":{"default":"demo/model"}}'])).toMatchObject({ command: "plan", profile: "work" });
    expect(() => parseJsonCliArguments(["plan"])).toThrow();

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-switch-cli-"));
    roots.push(root);
    const adapter = new OmpFilesystemAdapter({ homeDir: root, snapshotDir: path.join(root, "snapshots") });
    const result = await runJsonCli(
      parseJsonCliArguments(["plan", "--profile", "default", "--patch", '{"roleAssignments":{"default":"demo/model"}}']),
      { adapter, profile: (id) => toProfileRef(root, id) }
    );
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
  });

  it("parses and executes snapshots command", async () => {
    expect(parseJsonCliArguments(["snapshots", "--profile", "work"])).toMatchObject({ command: "snapshots", profile: "work" });

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-switch-cli-"));
    roots.push(root);
    const adapter = new OmpFilesystemAdapter({ homeDir: root, snapshotDir: path.join(root, "snapshots") });
    const result = await runJsonCli(
      parseJsonCliArguments(["snapshots", "--profile", "default"]),
      { adapter, profile: (id) => toProfileRef(root, id) }
    );
    expect(result).toMatchObject({ version: 1, ok: true, data: [] });
  });

  it("masks plaintext API keys on get unless --reveal-secrets is passed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-switch-cli-get-"));
    roots.push(root);
    const agentDir = path.join(root, ".omp", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentDir, "models.yml"),
      [
        "providers:",
        "  demo:",
        "    baseUrl: https://api.example.test/v1",
        "    api: openai-completions",
        "    apiKey: sk-plaintext-secret-key-1234567890",
        "    models:",
        "      - id: demo-1",
      ].join("\n"),
    );

    const adapter = new OmpFilesystemAdapter({ homeDir: root, snapshotDir: path.join(root, "snapshots") });
    const maskedResult = await runJsonCli(
      parseJsonCliArguments(["get", "--profile", "default"]),
      { adapter, profile: (id) => toProfileRef(root, id) }
    );
    expect(maskedResult.ok).toBe(true);
    const maskedConfig = maskedResult.data as any;
    expect(maskedConfig.models.raw).toContain('apiKey: "••••••••"');
    expect(maskedConfig.models.raw).not.toContain("sk-plaintext-secret-key-1234567890");
    expect(maskedConfig.models.value.providers.demo.apiKey).toBe("••••••••");

    const revealedResult = await runJsonCli(
      parseJsonCliArguments(["get", "--profile", "default", "--reveal-secrets"]),
      { adapter, profile: (id) => toProfileRef(root, id) }
    );
    expect(revealedResult.ok).toBe(true);
    const revealedConfig = revealedResult.data as any;
    expect(revealedConfig.models.raw).toContain("sk-plaintext-secret-key-1234567890");
    expect(revealedConfig.models.value.providers.demo.apiKey).toBe("sk-plaintext-secret-key-1234567890");
  });
});
