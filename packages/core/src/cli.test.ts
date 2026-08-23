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
});
