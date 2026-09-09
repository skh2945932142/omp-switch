import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { CredentialRef, CredentialStatus } from "@omp-switch/core";
import type { CredentialStore, LinuxCredentialBackend } from "./credential-store";

const execFileAsync = promisify(execFile);

/**
 * Run a command with the secret on stdin. spawn with an argument array (no shell), so neither
 * the secret nor any argument is ever interpolated into a command string.
 */
function runWithStdin(command: string, args: string[], input: string, timeoutMs = 10_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { timeout: timeoutMs });
    child.stdout.resume(); // drain so a chatty tool cannot deadlock on a full pipe
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) return resolve({ stdout: "", stderr: "" });
      reject(new Error(`${command} exited with ${code ?? signal}`));
    });
    child.stdin.on("error", () => undefined); // EPIPE if the tool exits early having read nothing
    child.stdin.end(input);
  });
}

/**
 * Linux credential store: each credential is a **direct libsecret keyring entry** (service
 * `omp-switch`, attribute `credential=<id>`), resolved for OMP by `secret-tool lookup …` — no
 * bridge binary, no Electron boot, cold-start is single-digit milliseconds against OMP's 10s
 * budget. When no Secret Service is reachable (headless, no keyring daemon), fall back to an
 * age X25519 keyfile identity: the secret is encrypted to `<userData>/secrets/<id>.age` and
 * decrypted by `age -d -i <identity>`. The fallback is honestly weaker — the identity sits
 * beside the ciphertext, protecting against casual copy, not a user-level attacker — so the
 * backend is reported to the UI and warned about there.
 */

interface CredentialIndex {
  version: 1;
  backend: LinuxCredentialBackend;
  entries: Record<string, { label: string }>;
}

/** Injectable execution seam so tests run without libsecret/age on PATH. */
export interface LinuxCredentialStoreOptions {
  execFileImpl?: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  execInputImpl?: (command: string, args: string[], input: string) => Promise<{ stdout: string; stderr: string }>;
  whichImpl?: (command: string) => string | null;
  envBackendOverride?: string | undefined;
}

/** secret-tool / age read the secret from stdin; the injected seam mirrors that shape. */
type ExecWithInput = (command: string, args: string[], input: string) => Promise<{ stdout: string; stderr: string }>;

const SCHEMA_ARGS = ["service", "omp-switch", "credential"] as const;

export class LinuxCredentialStore implements CredentialStore {
  private readonly userDataDir: string;
  private readonly indexPath: string;
  private readonly exec: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  private readonly execInput: ExecWithInput;
  private readonly which: (command: string) => string | null;
  private readonly envBackendOverride?: string;
  private backendPromise: Promise<LinuxCredentialBackend> | null = null;

  constructor(userDataDir: string, options: LinuxCredentialStoreOptions = {}) {
    this.userDataDir = userDataDir;
    this.indexPath = path.join(userDataDir, "credentials.v1.json");
    this.exec = options.execFileImpl ?? ((command, args) => execFileAsync(command, args, { timeout: 10_000 }) as Promise<{ stdout: string; stderr: string }>);
    this.execInput = options.execInputImpl ?? ((command, args, input) => runWithStdin(command, args, input));
    this.which = options.whichImpl ?? defaultWhich;
    this.envBackendOverride = options.envBackendOverride ?? process.env.OMP_SWITCH_SECRET_BACKEND;
  }

  /**
   * The resolver command OMP executes (without the leading `!`). Contract frozen against real
   * OMP 18.x on Linux: unquoted absolute secret-tool path for libsecret; double-quoted age paths
   * (userData contains a space: `~/.config/OMP Switch`).
   */
  async describe(id: string): Promise<{ backend: LinuxCredentialBackend; command: string }> {
    const backend = await this.resolveBackend();
    if (backend === "libsecret") {
      const secretTool = this.which("secret-tool") ?? "secret-tool";
      return { backend, command: `${secretTool} lookup service omp-switch credential ${id}` };
    }
    return {
      backend,
      command: `age -d -i ${quote(this.identityPath())} ${quote(this.cipherPath(id))}`,
    };
  }

  async put(id: string, label: string, value: string): Promise<void> {
    const backend = await this.resolveBackend();
    if (backend === "libsecret") {
      await this.execInput("secret-tool", ["store", `--label=OMP Switch: ${label}`, ...SCHEMA_ARGS, id], value);
    } else {
      await this.ensureAgeIdentity();
      await fsp.mkdir(path.dirname(this.cipherPath(id)), { recursive: true, mode: 0o700 });
      await this.execInput("age", ["-r", await this.agePublicKey(), "-o", this.cipherPath(id)], value);
    }
    await this.updateIndex((index) => {
      index.entries[id] = { label };
    });
  }

  async get(id: string): Promise<string> {
    const backend = await this.resolveBackend();
    if (backend === "libsecret") {
      const { stdout } = await this.exec("secret-tool", ["lookup", ...SCHEMA_ARGS, id]);
      const value = stdout.trimEnd();
      if (!value) throw new Error(`Credential not found: ${id}`);
      return value;
    }
    const { stdout } = await this.exec("age", ["-d", "-i", this.identityPath(), this.cipherPath(id)]);
    return stdout;
  }

  async remove(id: string): Promise<void> {
    const backend = await this.resolveBackend();
    if (backend === "libsecret") {
      await this.exec("secret-tool", ["clear", ...SCHEMA_ARGS, id]);
    } else {
      await fsp.rm(this.cipherPath(id), { force: true });
    }
    await this.updateIndex((index) => {
      delete index.entries[id];
    });
  }

  async status(id: string): Promise<CredentialStatus> {
    const index = await this.readIndex();
    const entry = index.entries[id];
    if (index.backend === "age") {
      const exists = await fsp.stat(this.cipherPath(id)).then(() => true, () => false);
      return { exists, label: entry?.label ?? id, masked: exists ? "••••••••" : "Not configured" };
    }
    // libsecret: a live lookup is the only truthful existence check (entries can be removed
    // outside the app); the index gates whether it is worth a keyring round-trip.
    if (!entry) return { exists: false, label: id, masked: "Not configured" };
    try {
      const value = await this.get(id);
      return { exists: Boolean(value), label: entry.label, masked: value ? "••••••••" : "Not configured" };
    } catch {
      return { exists: false, label: entry.label, masked: "Not configured" };
    }
  }

  async list(): Promise<CredentialRef[]> {
    const index = await this.readIndex();
    return Object.entries(index.entries).map(([id, entry]) => ({ id, label: entry.label }));
  }

  /** Current backend, probing once per process: Secret Service reachable → libsecret, else age. */
  async resolveBackend(): Promise<LinuxCredentialBackend> {
    if (this.backendPromise) return this.backendPromise;
    this.backendPromise = (async () => {
      const override = this.envBackendOverride?.trim();
      if (override === "libsecret" || override === "age") return override;
      const secretTool = this.which("secret-tool");
      if (secretTool) {
        // A lookup that exits non-zero with "Service not available" (or similar) means no Secret
        // Service on D-Bus; any other outcome (empty success, not-found) means the service answers.
        try {
          await this.exec(secretTool, ["lookup", ...SCHEMA_ARGS, "omp-switch-backend-probe"]);
          return "libsecret";
        } catch (error) {
          const message = String(error);
          if (/service|daemon|dbus|not available/i.test(message)) return "age";
          return "libsecret";
        }
      }
      return "age";
    })();
    return this.backendPromise;
  }

  private identityPath(): string {
    return path.join(this.userDataDir, "age", "identity");
  }

  private cipherPath(id: string): string {
    return path.join(this.userDataDir, "secrets", `${id}.age`);
  }

  private async ensureAgeIdentity(): Promise<void> {
    const identity = this.identityPath();
    if (await fsp.stat(identity).then(() => true, () => false)) return;
    await fsp.mkdir(path.dirname(identity), { recursive: true, mode: 0o700 });
    await this.exec("age-keygen", ["-o", identity]);
    await fsp.chmod(identity, 0o600);
  }

  private async agePublicKey(): Promise<string> {
    const raw = await fsp.readFile(this.identityPath(), "utf8");
    const match = raw.match(/^# public key: (age1\S+)$/m);
    if (!match) throw new Error("age identity file is malformed (missing public key comment)");
    return match[1];
  }

  private async readIndex(): Promise<CredentialIndex> {
    try {
      const raw = await fsp.readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<CredentialIndex>;
      if (parsed.version === 1 && parsed.entries && typeof parsed.entries === "object") {
        return { version: 1, backend: parsed.backend === "age" ? "age" : "libsecret", entries: parsed.entries as CredentialIndex["entries"] };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return { version: 1, backend: await this.resolveBackend(), entries: {} };
  }

  private async updateIndex(mutate: (index: CredentialIndex) => void): Promise<void> {
    const index = await this.readIndex();
    index.backend = await this.resolveBackend();
    mutate(index);
    await fsp.mkdir(path.dirname(this.indexPath), { recursive: true });
    const tempPath = `${this.indexPath}.${process.pid}.tmp`;
    await fsp.writeFile(tempPath, JSON.stringify(index, null, 2), { encoding: "utf8", mode: 0o600 });
    await fsp.rename(tempPath, this.indexPath);
  }
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function defaultWhich(command: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep probing
    }
  }
  return null;
}
