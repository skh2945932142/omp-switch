import fs from "node:fs/promises";
import path from "node:path";
import type { GatewayPool, SessionIndexEntry, Snapshot } from "@omp-switch/core";

interface MetadataState {
  version: 2;
  providerLabels: Record<string, string>;
  snapshots: Array<Record<string, unknown>>;
  gatewayPools: GatewayPool[];
  sessionIndex: SessionIndexEntry[];
  preferences: Record<string, unknown>;
}

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): void; all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown };
  close(): void;
};

export interface MetadataStoreOptions {
  /**
   * `auto` prefers `node:sqlite` and silently degrades to JSON when the builtin is unavailable.
   * `json` forces the fallback, which is how the fallback branch gets exercised in tests — it is a
   * whole second implementation of every method and would otherwise never run in CI.
   */
  backend?: "auto" | "json";
}

/** Snapshot rows kept per profile, matching the adapter's on-disk retention. */
const SNAPSHOT_RETENTION = 30;

export class MetadataStore {
  private readonly filePath: string;
  private readonly backend: "auto" | "json";
  private sqlite: SqliteDb | null = null;
  private fallback: MetadataState = { version: 2, providerLabels: {}, snapshots: [], gatewayPools: [], sessionIndex: [], preferences: {} };

  constructor(userDataDir: string, options: MetadataStoreOptions = {}) {
    this.filePath = path.join(userDataDir, "metadata.sqlite");
    this.backend = options.backend ?? "auto";
  }

  /** Which implementation actually loaded; tests and diagnostics need to know. */
  get activeBackend(): "sqlite" | "json" {
    return this.sqlite ? "sqlite" : "json";
  }

  async init(): Promise<void> {
    if (this.backend === "json") {
      await this.loadFallback();
      return;
    }
    try {
      const sqlite = await import("node:sqlite");
      this.sqlite = new sqlite.DatabaseSync(this.filePath) as unknown as SqliteDb;
      this.sqlite.exec(
        "CREATE TABLE IF NOT EXISTS provider_meta (provider_id TEXT PRIMARY KEY, label TEXT NOT NULL); CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, profile TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS gateway_pools (id TEXT PRIMARY KEY, profile TEXT NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS session_index (id TEXT PRIMARY KEY, profile TEXT NOT NULL, file_path TEXT NOT NULL, offset INTEGER NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, payload TEXT NOT NULL);",
      );
    } catch {
      this.sqlite = null;
      await this.loadFallback();
    }
  }

  /** Releases the sqlite handle. On Windows the database file stays locked until this runs. */
  close(): void {
    if (!this.sqlite) return;
    try {
      this.sqlite.close();
    } finally {
      this.sqlite = null;
    }
  }

  private async loadFallback(): Promise<void> {
    const empty: MetadataState = { version: 2, providerLabels: {}, snapshots: [], gatewayPools: [], sessionIndex: [], preferences: {} };
    try {
      this.fallback = { ...empty, ...JSON.parse(await fs.readFile(`${this.filePath}.json`, "utf8")) as Partial<MetadataState> };
    } catch {
      this.fallback = empty;
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
      // The sqlite branch previously kept every row forever while the JSON branch capped at 30.
      this.sqlite.prepare(
        "DELETE FROM snapshots WHERE profile = ? AND id NOT IN (SELECT id FROM snapshots WHERE profile = ? ORDER BY created_at DESC LIMIT ?)",
      ).run(snapshot.profile, snapshot.profile, SNAPSHOT_RETENTION);
      return;
    }
    this.fallback.snapshots = [snapshot, ...this.fallback.snapshots.filter((item) => item.id !== snapshot.id)].slice(0, SNAPSHOT_RETENTION);
    await this.persistFallback();
  }

  listSnapshots(profile: string): Array<Record<string, unknown>> {
    if (this.sqlite) {
      const rows = this.sqlite.prepare("SELECT payload FROM snapshots WHERE profile = ? ORDER BY created_at DESC").all(profile) as Array<{ payload: string }>;
      return rows.map((row) => JSON.parse(row.payload) as Record<string, unknown>);
    }
    return this.fallback.snapshots.filter((snapshot) => snapshot.profile === profile);
  }

  getLatestSnapshot(profile: string): Snapshot | null {
    if (this.sqlite) {
      const rows = this.sqlite.prepare("SELECT payload FROM snapshots WHERE profile = ? ORDER BY created_at DESC LIMIT 1").all(profile) as Array<{ payload: string }>;
      return rows[0] ? JSON.parse(rows[0].payload) as Snapshot : null;
    }
    const item = this.fallback.snapshots.find((snapshot) => snapshot.profile === profile);
    return item ? item as unknown as Snapshot : null;
  }

  async saveGatewayPool(pool: GatewayPool): Promise<void> {
    if (this.sqlite) {
      this.sqlite.prepare("INSERT INTO gateway_pools(id, profile, payload) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile, payload=excluded.payload").run(pool.id, pool.profile, JSON.stringify(pool));
      return;
    }
    this.fallback.gatewayPools = [pool, ...this.fallback.gatewayPools.filter((item) => item.id !== pool.id)];
    await this.persistFallback();
  }

  listGatewayPools(profile?: string): GatewayPool[] {
    if (this.sqlite) {
      const query = profile ? "SELECT payload FROM gateway_pools WHERE profile = ?" : "SELECT payload FROM gateway_pools";
      const rows = this.sqlite.prepare(query).all(...(profile ? [profile] : [])) as Array<{ payload: string }>;
      return rows.map((row) => JSON.parse(row.payload) as GatewayPool);
    }
    return this.fallback.gatewayPools.filter((pool) => !profile || pool.profile === profile);
  }

  async replaceSessionIndex(profile: string, entries: SessionIndexEntry[]): Promise<void> {
    if (this.sqlite) {
      this.sqlite.prepare("DELETE FROM session_index WHERE profile = ?").run(profile);
      const insert = this.sqlite.prepare("INSERT INTO session_index(id, profile, file_path, offset, payload) VALUES(?, ?, ?, ?, ?)");
      for (const entry of entries) {
        const sourceKey = entry.sourceKey ?? `${entry.filePath}:${entry.offset}`;
        insert.run(sourceKey, entry.profile, entry.filePath, entry.offset, JSON.stringify({ ...entry, sourceKey }));
      }
      return;
    }
    this.fallback.sessionIndex = [...this.fallback.sessionIndex.filter((entry) => entry.profile !== profile), ...entries.map((entry) => ({ ...entry, sourceKey: entry.sourceKey ?? `${entry.filePath}:${entry.offset}` }))];
    await this.persistFallback();
  }

  listSessionIndex(profile: string): SessionIndexEntry[] {
    if (this.sqlite) {
      const rows = this.sqlite.prepare("SELECT payload FROM session_index WHERE profile = ?").all(profile) as Array<{ payload: string }>;
      return rows
        .map((row) => JSON.parse(row.payload) as SessionIndexEntry)
        .sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? ""));
    }
    return this.fallback.sessionIndex
      .filter((entry) => entry.profile === profile)
      .sort((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? ""));
  }

  async setPreference(key: string, value: unknown): Promise<void> {
    if (this.sqlite) {
      this.sqlite.prepare("INSERT INTO preferences(key, payload) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload").run(key, JSON.stringify(value));
      return;
    }
    this.fallback.preferences[key] = value;
    await this.persistFallback();
  }

  getPreference<T>(key: string): T | undefined {
    if (this.sqlite) {
      const row = this.sqlite.prepare("SELECT payload FROM preferences WHERE key = ?").get(key) as { payload: string } | undefined;
      return row ? JSON.parse(row.payload) as T : undefined;
    }
    return this.fallback.preferences[key] as T | undefined;
  }

  private async persistFallback(): Promise<void> {
    await fs.mkdir(path.dirname(`${this.filePath}.json`), { recursive: true });
    await fs.writeFile(`${this.filePath}.json`, JSON.stringify(this.fallback, null, 2), "utf8");
  }
}
