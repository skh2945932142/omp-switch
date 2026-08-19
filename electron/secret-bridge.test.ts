import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSecretCommand, provisionSecretBridge } from "./secret-bridge";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe("secret bridge provisioning", () => {
  it("copies the bundled bridge into versioned app data before creating its command reference", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-switch-secret-bridge-"));
    roots.push(root);
    const source = path.join(root, "bundle", "omp-switch-secret.exe");
    const userDataDir = path.join(root, "app-data");
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, "bridge-binary");

    const bridgePath = await provisionSecretBridge(source, userDataDir, "0.2.0");
    await fs.rm(source);

    expect(await fs.readFile(bridgePath, "utf8")).toBe("bridge-binary");
    expect(createSecretCommand(bridgePath, "credential-123", userDataDir)).toBe(
      `"${bridgePath}" --secret-get "credential-123" --data-dir "${userDataDir}"`,
    );
  });
});
