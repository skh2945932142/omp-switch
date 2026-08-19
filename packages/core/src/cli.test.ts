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
  it("parses a validated apply command", () => {
    expect(parseJsonCliArguments(["apply", "--profile", "work", "--patch", '{"roleAssignments":{"default":"demo/model"}}'])).toMatchObject({ command: "apply", profile: "work" });
    expect(() => parseJsonCliArguments(["apply"])).toThrow();
  });

  it("returns one JSON-compatible response envelope", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-switch-cli-"));
    roots.push(root);
    const adapter = new OmpFilesystemAdapter({ homeDir: root, snapshotDir: path.join(root, "snapshots") });
    const result = await runJsonCli(parseJsonCliArguments(["list"]), { adapter, profile: (id) => toProfileRef(root, id) });
    expect(result).toMatchObject({ version: 1, ok: true });
  });
});
