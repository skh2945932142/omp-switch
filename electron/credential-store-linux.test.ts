import { mkdtemp, writeFile, mkdir, readFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { LinuxCredentialStore } from "./credential-store-linux";

const execFileAsync = promisify(execFile);

/**
 * Fake backends as tiny node scripts on a prepended PATH. secret-tool emulates a keyring by
 * storing items in a JSON file; age emulates encryption by base64 (the *commands and grammar*
 * are the contract under test, not the crypto).
 */
async function fakeBackendDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "omp-cred-"));
  await writeFile(path.join(dir, "secret-tool"), `#!/usr/bin/env node
const args = process.argv.slice(2);
const fs = require("node:fs");
const storePath = process.env.OMP_FAKE_KEYRING;
const read = () => fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, "utf8")) : {};
const write = (s) => fs.writeFileSync(storePath, JSON.stringify(s));
if (args[0] === "store") {
  const label = args.find((a) => a.startsWith("--label=")).slice(8);
  const id = args[args.length - 1];
  let input = "";
  process.stdin.on("data", (d) => (input += d));
  process.stdin.on("end", () => {
    const store = read();
    store[id] = { label, value: input.trim() };
    write(store);
  });
} else if (args[0] === "lookup") {
  const id = args[args.length - 1];
  const store = read();
  if (store[id]) process.stdout.write(store[id].value);
} else if (args[0] === "clear") {
  const id = args[args.length - 1];
  const store = read();
  delete store[id];
  write(store);
}
`, "utf8");
  await writeFile(path.join(dir, "age"), `#!/usr/bin/env node
const args = process.argv.slice(2);
const fs = require("node:fs");
if (args[0] === "-d") {
  const cipher = fs.readFileSync(args[3]);
  process.stdout.write(Buffer.from(cipher.toString(), "base64").toString());
} else {
  // encrypt: -r <pubkey> -o <out>
  const out = args[3];
  let input = "";
  process.stdin.on("data", (d) => (input += d));
  process.stdin.on("end", () => fs.writeFileSync(out, Buffer.from(input.trim()).toString("base64")));
}
`, "utf8");
  await writeFile(path.join(dir, "age-keygen"), `#!/usr/bin/env node
const fs = require("node:fs");
const out = process.argv[process.argv.indexOf("-o") + 1];
fs.writeFileSync(out, "# created: test\\n# public key: age1fakepublickey\\nAGE-SECRET-KEY-FAKE\\n");
`, "utf8");
  for (const name of ["secret-tool", "age", "age-keygen"]) {
    await chmod(path.join(dir, name), 0o755);
  }
  return dir;
}

/**
 * Route a tool invocation to the fake script: run it with the node interpreter (the shebang is
 * present too, but explicit is simpler), with the keyring file location injected via env.
 */
function routeFake(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const tool = path.basename(command);
  return execFileAsync(process.execPath, [path.join(fakeBinDir!, tool), ...args], {
    env: { ...process.env, OMP_FAKE_KEYRING: fakeKeyringPath },
    timeout: 10_000,
  }) as Promise<{ stdout: string; stderr: string }>;
}

function makeStore(userDataDir: string, backend: "libsecret" | "age", secretToolOnPath: string | null): LinuxCredentialStore {
  return new LinuxCredentialStore(userDataDir, {
    whichImpl: (command) => (command === "secret-tool" ? secretToolOnPath : null),
    envBackendOverride: backend,
    execFileImpl: routeFake,
    execInputImpl: (command, args, input) =>
      // Mirror the production helper: spawn with an argument array, secret on stdin. (execFile's
      // `input` option deadlocks against these stdin-driven fake tools; spawn does not.)
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(fakeBinDir!, path.basename(command)), ...args], {
          env: { ...process.env, OMP_FAKE_KEYRING: fakeKeyringPath },
          timeout: 10_000,
        });
        let stdout = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.on("error", reject);
        child.on("close", (code, signal) => {
          if (code === 0) return resolve({ stdout, stderr: "" });
          reject(new Error(`fake ${path.basename(command)} exited with ${code ?? signal}`));
        });
        child.stdin.on("error", () => undefined);
        child.stdin.end(input);
      }),
  });
}

let fakeKeyringPath: string;

let fakeBinDir: string | null = null;

describe("LinuxCredentialStore", () => {
  it("round-trips a credential through libsecret and freezes the resolver command", async () => {
    fakeBinDir = await fakeBackendDir();
    const userData = await mkdtemp(path.join(tmpdir(), "omp-user-"));
    fakeKeyringPath = path.join(userData, "fake-keyring.json");
    const store = makeStore(userData, "libsecret", "/usr/bin/secret-tool");

    await store.put("anthropic-key", "Anthropic API key", "sk-ant-test-123");
    expect(await store.get("anthropic-key")).toBe("sk-ant-test-123");

    // THE cross-process contract: the exact command string written into models.yml.
    const described = await store.describe("anthropic-key");
    expect(described.backend).toBe("libsecret");
    // Absolute secret-tool path + unquoted tokens: the frozen libsecret contract.
    expect(described.command).toBe("/usr/bin/secret-tool lookup service omp-switch credential anthropic-key");

    // No secrets in the index — labels only.
    const index = JSON.parse(await readFile(path.join(userData, "credentials.v1.json"), "utf8"));
    expect(index.entries["anthropic-key"]).toEqual({ label: "Anthropic API key" });
    expect(JSON.stringify(index)).not.toContain("sk-ant-test-123");

    expect(await store.list()).toEqual([{ id: "anthropic-key", label: "Anthropic API key" }]);
    expect((await store.status("anthropic-key")).exists).toBe(true);
    expect((await store.status("missing-key")).exists).toBe(false);

    await store.remove("anthropic-key");
    expect(await store.list()).toEqual([]);
    await expect(store.get("anthropic-key")).rejects.toThrow(/not found/i);
  });

  it("falls back to age when no secret-tool exists, and the command quotes spaced paths", async () => {
    fakeBinDir = await fakeBackendDir();
    const userData = await mkdtemp(path.join(tmpdir(), "omp user space-")); // space in the path
    fakeKeyringPath = path.join(userData, "fake-keyring.json");
    const store = makeStore(userData, "age", null); // no secret-tool anywhere

    expect(await store.resolveBackend()).toBe("age");
    await store.put("openai-key", "OpenAI API key", "sk-openai-test");
    expect(await store.get("openai-key")).toBe("sk-openai-test");

    // Identity was keygen'd with tight permissions; cipher exists; index records backend.
    const identity = path.join(userData, "age", "identity");
    const identityRaw = await readFile(identity, "utf8");
    expect(identityRaw).toContain("age1fakepublickey");
    const identityStat = await import("node:fs").then((m) => m.statSync(identity));
    expect(identityStat.mode & 0o777).toBe(0o600);

    const described = await store.describe("openai-key");
    expect(described.backend).toBe("age");
    // Paths contain a space (userData "omp user space-XXXX") — double quotes are the contract.
    expect(described.command).toBe(`age -d -i "${path.join(userData, "age", "identity")}" "${path.join(userData, "secrets", "openai-key.age")}"`);
  });

  it("the age resolver command actually executes under POSIX sh and returns the secret", async () => {
    fakeBinDir = await fakeBackendDir();
    const userData = await mkdtemp(path.join(tmpdir(), "omp exec check-"));
    fakeKeyringPath = path.join(userData, "fake-keyring.json");
    const store = makeStore(userData, "age", null);
    await store.put("exec-check", "Exec check", "sk-exec-ok");
    const { command } = await store.describe("exec-check");
    // OMP runs exactly: execSync(command) — do the same here, PATH pointing at the fake tools.
    const { execSync } = await import("node:child_process");
    const out = execSync(command, {
      encoding: "utf8",
      timeout: 10_000,
      // Keep the real PATH (node itself) and prepend the fake tools.
      env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` },
    });
    expect(out.trim()).toBe("sk-exec-ok");
  });
});
