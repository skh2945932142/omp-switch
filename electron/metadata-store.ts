import fs from "node:fs/promises";
import path from "node:path";
import type { Snapshot } from "@omp-switch/core";

interface MetadataState {
  providerLabels: Record<string, string>;
  snapshots: Array<Record<string, unknown>>;
}

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): void; all(...args: unknown[]): unknown[] };
};

export class MetadataStore {
  private readonly filePath: string;
  private sqlite: SqliteDb | null = null;
  private fallback: MetadataState = { providerLabels: {}, snapshots: [] };

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, "metadata.sqlite");
  }

  async init(): Promise<void> {
    try {
      const sqlite = await import("node:sqlite");
      this.sqlite = new sqlite.DatabaseSync(this.filePath) as unknown as SqliteDb;
      this.sqlite.exec(
        "CREATE TABLE IF NOT EXISTS provider_meta (provider_id TEXT PRIMARY KEY, label TEXT NOT NULL); CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, profile TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);",
      );
    } catch {
      this.sqlite = null;
      try {
        this.fallback = JSON.parse(await fs.readFile(`${this.filePath}.json`, "utf8")) as MetadataState;
      } catch {
        this.fallback = { providerLabels: {}, snapshots: [] };
      }
    }
  }

  async setProviderLabel(providerId: string, label: string): Promise<void> {
    if (this.sqlite) {
      this.sqlite.prepare("INSERT INTO provider_meta(provider_id, label) VALUES(?, ?) ON CONFLICT(provider_id) DO UPDATE SET label=excluded.label").run(providerId, label);
      return;
    }
    this.fallback.providerLabels[providerId] = label;
    await this.persistFallback();
  }

  getProviderLabels(): Record<string, string> {
    if (this.sqlite) {
      const rows = this.sqlite.prepare("SELECT provider_id, label FROM provider_meta").all() as Array<{ provider_id: string; label: string }>;
      return Object.fromEntries(rows.map((row) => [row.provider_id, row.label]));
    }
    return { ...this.fallback.providerLabels };
  }

  async addSnapshot(snapshot: Record<string, unknown>): Promise<void> {
    if (this.sqlite) {
      this.sqlite.prepare("INSERT OR REPLACE INTO snapshots(id, profile, created_at, payload) VALUES(?, ?, ?, ?)").run(snapshot.id, snapshot.profile, snapshot.createdAt, JSON.stringify(snapshot));
      return;
    }
    this.fallback.snapshots = [snapshot, ...this.fallback.snapshots.filter((item) => item.id !== snapshot.id)].slice(0, 30);
    await this.persistFallback();
  }

  getLatestSnapshot(profile: string): Snapshot | null {
    if (this.sqlite) {
      const rows = this.sqlite.prepare("SELECT payload FROM snapshots WHERE profile = ? ORDER BY created_at DESC LIMIT 1").all(profile) as Array<{ payload: string }>;
      return rows[0] ? JSON.parse(rows[0].payload) as Snapshot : null;
    }
    const item = this.fallback.snapshots.find((snapshot) => snapshot.profile === profile);
    return item ? item as unknown as Snapshot : null;
  }

  private async persistFallback(): Promise<void> {
    await fs.mkdir(path.dirname(`${this.filePath}.json`), { recursive: true });
    await fs.writeFile(`${this.filePath}.json`, JSON.stringify(this.fallback, null, 2), "utf8");
  }
}
