import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { safeStorage } from "electron";
import { CredentialRef, CredentialStatus } from "@omp-switch/core";

interface VaultEntry {
  label: string;
  ciphertext: string;
}

interface VaultFile {
  version: 1;
  entries: Record<string, VaultEntry>;
}

export class SecretStoreService {
  private readonly filePath: string;

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, "secrets.v1.json");
  }

  async put(id: string, label: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS-backed encryption is unavailable on this machine");
    }
    const vault = await this.readVault();
    vault.entries[id] = {
      label,
      ciphertext: safeStorage.encryptString(value).toString("base64"),
    };
    await this.writeVault(vault);
  }

  async get(id: string): Promise<string> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("OS-backed encryption is unavailable");
    const vault = await this.readVault();
    const entry = vault.entries[id];
    if (!entry) throw new Error(`Credential not found: ${id}`);
    return safeStorage.decryptString(Buffer.from(entry.ciphertext, "base64"));
  }

  async remove(id: string): Promise<void> {
    const vault = await this.readVault();
    delete vault.entries[id];
    await this.writeVault(vault);
  }

  async status(id: string): Promise<CredentialStatus> {
    const vault = await this.readVault();
    const entry = vault.entries[id];
    return {
      exists: Boolean(entry),
      label: entry?.label ?? id,
      masked: entry ? "••••••••" : "Not configured",
    };
  }

  /** Ids and labels only — never ciphertext — so callers can find entries no config references. */
  async list(): Promise<CredentialRef[]> {
    const vault = await this.readVault();
    return Object.entries(vault.entries).map(([id, entry]) => ({ id, label: entry.label }));
  }

  private async readVault(): Promise<VaultFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<VaultFile>;
      if (parsed.version === 1 && parsed.entries && typeof parsed.entries === "object") {
        return { version: 1, entries: parsed.entries as Record<string, VaultEntry> };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return { version: 1, entries: {} };
  }

  private async writeVault(vault: VaultFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(vault, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(tempPath, this.filePath);
  }
}
