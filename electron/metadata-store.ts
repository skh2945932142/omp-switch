import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  evaluateUpstreamHealth,
  type GatewayPool,
  type GatewayProbeRecord,
  type GatewayUpstreamHealth,
  type SessionFileCache,
  type SessionSearchResult,
  type SessionSummary,
  type SessionUsageRecord,
  type Snapshot,
} from "@omp-switch/core";

interface MetadataState {
  version: 3;
  providerLabels: Record<string, string>;
  snapshots: Array<Record<string, unknown>>;
  gatewayPools: GatewayPool[];
  gatewayProbeHistory: GatewayProbeRecord[];
  sessionCaches: SessionFileCache[];
  preferences: Record<string, unknown>;
}

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): void; all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown };
  close(): void;
};

export interface MetadataStoreOptions {
  backend?: "auto" | "json";
}

const SNAPSHOT_RETENTION = 30;
const PROBE_HISTORY_RETENTION = 50;

function emptyState(): MetadataState {
  return { version: 3, providerLabels: {}, snapshots: [], gatewayPools: [], gatewayProbeHistory: [], sessionCaches: [], preferences: {} };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asObject(value);
  if (!record) return {};
  return Object.fromEntries(Object.entries(record).filter((item): item is [string, string] => typeof item[1] === "string"));
}

type LegacySessionCache = SessionFileCache & { messageOffsets?: unknown };

function stripLegacyCacheFields(cache: SessionFileCache): Omit<LegacySessionCache, "usage" | "messageOffsets"> & { usage: SessionUsageRecord[] } {
  const { messageOffsets: _messageOffsets, ...clean } = cache as LegacySessionCache;
  return clean;
}

function cachePayload(cache: SessionFileCache): Omit<SessionFileCache, "usage"> {
  const { usage: _usage, ...payload } = stripLegacyCacheFields(cache);
  return payload;
}

function cloneUsage(usage: SessionUsageRecord[]): SessionUsageRecord[] {
  return usage.map((item) => ({ ...item, tokens: { ...item.tokens } }));
}

function cloneCache(cache: SessionFileCache): SessionFileCache {
  const clean = stripLegacyCacheFields(cache);
  return {
    ...clean,
    summary: { ...clean.summary, tokens: { ...clean.summary.tokens } },
    usage: cloneUsage(clean.usage),
  };
}

function sortCaches(caches: SessionFileCache[]): SessionFileCache[] {
  return caches.sort((left, right) =>
    (right.summary.lastActiveAt ?? right.summary.startedAt ?? "").localeCompare(left.summary.lastActiveAt ?? left.summary.startedAt ?? ""));
}

export class MetadataStore {
  private readonly filePath: string;
  private readonly backend: "auto" | "json";
  private sqlite: SqliteDb | null = null;
  private fallback: MetadataState = emptyState();
  private hasFts = false;

  constructor(userDataDir: string, options: MetadataStoreOptions = {}) {
    this.filePath = path.join(userDataDir, "metadata.sqlite");
    this.backend = options.backend ?? "auto";
  }

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
        "CREATE TABLE IF NOT EXISTS provider_meta (provider_id TEXT PRIMARY KEY, label TEXT NOT NULL);"
        + "CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, profile TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);"
        + "CREATE TABLE IF NOT EXISTS gateway_pools (id TEXT PRIMARY KEY, profile TEXT NOT NULL, payload TEXT NOT NULL);"
        + "CREATE TABLE IF NOT EXISTS gateway_probe_history (id TEXT PRIMARY KEY, pool_id TEXT NOT NULL, upstream_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);"
        + "CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, payload TEXT NOT NULL);"
        + "CREATE TABLE IF NOT EXISTS session_cache (id TEXT PRIMARY KEY, profile TEXT NOT NULL, relative_path TEXT NOT NULL, payload TEXT NOT NULL);"
        + "CREATE TABLE IF NOT EXISTS session_usage (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, profile TEXT NOT NULL, payload TEXT NOT NULL);"
        + "DROP TABLE IF EXISTS session_index;",
      );
      try {
        this.sqlite.exec("CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(session_id UNINDEXED, profile UNINDEXED, role, text);");
        this.hasFts = true;
      } catch {
        this.hasFts = false;
      }
      this.removeLegacySessionOffsets();
    } catch {
      this.sqlite?.close();
      this.sqlite = null;
      await this.loadFallback();
    }
  }

  close(): void {
    if (!this.sqlite) return;
    try {
      this.sqlite.close();
    } finally {
      this.sqlite = null;
    }
  }

  private removeLegacySessionOffsets(): void {
    if (!this.sqlite) return;
    const rows = this.sqlite.prepare("SELECT id, payload FROM session_cache").all() as Array<{ id: string; payload: string }>;
    const updates: Array<{ id: string; payload: string }> = [];
    for (const row of rows) {
      try {
        const payload = asObject(JSON.parse(row.payload));
        if (!payload || !("messageOffsets" in payload)) continue;
        delete payload.messageOffsets;
        updates.push({ id: row.id, payload: JSON.stringify(payload) });
      } catch {
        // Leave malformed legacy rows untouched; a later refresh can replace them safely.
      }
    }
    if (updates.length === 0) return;
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const update = this.sqlite.prepare("UPDATE session_cache SET payload = ? WHERE id = ?");
      for (const item of updates) update.run(item.payload, item.id);
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  private async loadFallback(): Promise<void> {
    const empty = emptyState();
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath + ".json", "utf8")) as Record<string, unknown>;
      const isCurrent = parsed.version === 3 && Array.isArray(parsed.sessionCaches);
      const rawCaches = Array.isArray(parsed.sessionCaches) ? parsed.sessionCaches : [];
      const hasLegacyCacheFields = rawCaches.some((cache) => Boolean(asObject(cache)?.messageOffsets));
      this.fallback = {
        version: 3,
        providerLabels: asStringRecord(parsed.providerLabels),
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots.filter(asObject) : [],
        gatewayPools: Array.isArray(parsed.gatewayPools) ? parsed.gatewayPools as GatewayPool[] : [],
        gatewayProbeHistory: Array.isArray(parsed.gatewayProbeHistory) ? parsed.gatewayProbeHistory as GatewayProbeRecord[] : [],
        sessionCaches: isCurrent ? (rawCaches as SessionFileCache[]).map(cloneCache) : [],
        preferences: asObject(parsed.preferences) ?? {},
      };
      if (!isCurrent || "sessionIndex" in parsed || hasLegacyCacheFields) await this.persistFallback();
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
      const row = this.sqlite.prepare("SELECT payload FROM snapshots WHERE profile = ? ORDER BY created_at DESC LIMIT 1").get(profile) as { payload: string } | undefined;
      return row ? JSON.parse(row.payload) as Snapshot : null;
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

  async recordGatewayProbe(record: GatewayProbeRecord): Promise<void> {
    const id = record.id || randomUUID();
    const item: GatewayProbeRecord = { ...record, id };
    if (this.sqlite) {
      this.sqlite.prepare(
        "INSERT INTO gateway_probe_history(id, pool_id, upstream_id, created_at, payload) VALUES(?, ?, ?, ?, ?)"
      ).run(id, item.poolId, item.upstreamId, item.timestamp, JSON.stringify(item));
      this.sqlite.prepare(
        "DELETE FROM gateway_probe_history WHERE pool_id = ? AND upstream_id = ? AND id NOT IN (SELECT id FROM gateway_probe_history WHERE pool_id = ? AND upstream_id = ? ORDER BY created_at DESC LIMIT ?)"
      ).run(item.poolId, item.upstreamId, item.poolId, item.upstreamId, PROBE_HISTORY_RETENTION);
      return;
    }
    const current = this.fallback.gatewayProbeHistory ?? [];
    const updated = [item, ...current.filter((entry) => entry.id !== id)];
    const matching = updated.filter((entry) => entry.poolId === item.poolId && entry.upstreamId === item.upstreamId).slice(0, PROBE_HISTORY_RETENTION);
    const others = updated.filter((entry) => !(entry.poolId === item.poolId && entry.upstreamId === item.upstreamId));
    this.fallback.gatewayProbeHistory = [...matching, ...others];
    await this.persistFallback();
  }

  listGatewayProbeHistory(poolId?: string, upstreamId?: string): GatewayProbeRecord[] {
    if (this.sqlite) {
      let query = "SELECT payload FROM gateway_probe_history";
      const params: string[] = [];
      if (poolId && upstreamId) {
        query += " WHERE pool_id = ? AND upstream_id = ? ORDER BY created_at DESC";
        params.push(poolId, upstreamId);
      } else if (poolId) {
        query += " WHERE pool_id = ? ORDER BY created_at DESC";
        params.push(poolId);
      } else {
        query += " ORDER BY created_at DESC";
      }
      const rows = this.sqlite.prepare(query).all(...params) as Array<{ payload: string }>;
      return rows.map((row) => JSON.parse(row.payload) as GatewayProbeRecord);
    }
    return (this.fallback.gatewayProbeHistory ?? []).filter((entry) => {
      if (poolId && entry.poolId !== poolId) return false;
      if (upstreamId && entry.upstreamId !== upstreamId) return false;
      return true;
    }).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  getGatewayHealth(poolId?: string): Record<string, GatewayUpstreamHealth> {
    const history = this.listGatewayProbeHistory(poolId);
    const byUpstream: Record<string, GatewayProbeRecord[]> = {};
    for (const record of history) {
      const key = `${record.poolId}:${record.upstreamId}`;
      if (!byUpstream[key]) byUpstream[key] = [];
      byUpstream[key].push(record);
    }
    const result: Record<string, GatewayUpstreamHealth> = {};
    for (const [key, records] of Object.entries(byUpstream)) {
      const [pId, uId] = key.split(":");
      result[key] = evaluateUpstreamHealth(pId, uId, records);
    }
    return result;
  }

  async replaceSessionCaches(profile: string, caches: SessionFileCache[]): Promise<void> {
    const next = caches.filter((cache) => cache.profile === profile).map(cloneCache);
    if (!this.sqlite) {
      this.fallback.sessionCaches = [
        ...this.fallback.sessionCaches.filter((cache) => cache.profile !== profile),
        ...next,
      ];
      await this.persistFallback();
      return;
    }

    const current = this.listSessionCaches(profile);
    const currentById = new Map(current.map((cache) => [cache.id, cache]));
    const nextById = new Map(next.map((cache) => [cache.id, cache]));
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const upsertCache = this.sqlite.prepare("INSERT INTO session_cache(id, profile, relative_path, payload) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile, relative_path=excluded.relative_path, payload=excluded.payload");
      const deleteUsage = this.sqlite.prepare("DELETE FROM session_usage WHERE session_id = ?");
      const insertUsage = this.sqlite.prepare("INSERT INTO session_usage(id, session_id, profile, payload) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id, profile=excluded.profile, payload=excluded.payload");
      const deleteCache = this.sqlite.prepare("DELETE FROM session_cache WHERE id = ?");
      for (const cache of next) {
        const before = currentById.get(cache.id);
        const changed = !before || JSON.stringify(cachePayload(before)) !== JSON.stringify(cachePayload(cache)) || JSON.stringify(before.usage) !== JSON.stringify(cache.usage);
        if (!changed) continue;
        upsertCache.run(cache.id, profile, cache.relativePath, JSON.stringify(cachePayload(cache)));
        deleteUsage.run(cache.id);
        for (const usage of cache.usage) insertUsage.run(usage.id, cache.id, profile, JSON.stringify(usage));
      }
      for (const cache of current) {
        if (!nextById.has(cache.id)) {
          deleteUsage.run(cache.id);
          deleteCache.run(cache.id);
        }
      }
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  listSessionCaches(profile: string): SessionFileCache[] {
    if (!this.sqlite) {
      return sortCaches(this.fallback.sessionCaches.filter((cache) => cache.profile === profile).map(cloneCache));
    }
    const cacheRows = this.sqlite.prepare("SELECT payload FROM session_cache WHERE profile = ?").all(profile) as Array<{ payload: string }>;
    const usages = this.sqlite.prepare("SELECT session_id, payload FROM session_usage WHERE profile = ?").all(profile) as Array<{ session_id: string; payload: string }>;
    const usageBySession = new Map<string, SessionUsageRecord[]>();
    for (const row of usages) {
      const list = usageBySession.get(row.session_id) ?? [];
      list.push(JSON.parse(row.payload) as SessionUsageRecord);
      usageBySession.set(row.session_id, list);
    }
    return sortCaches(cacheRows.map((row) => {
      const payload = JSON.parse(row.payload) as Omit<SessionFileCache, "usage">;
      return cloneCache({ ...payload, usage: cloneUsage(usageBySession.get(payload.id) ?? []) });
    }));
  }

  getSessionCache(profile: string, id: string): SessionFileCache | undefined {
    return this.listSessionCaches(profile).find((cache) => cache.id === id);
  }

  listSessionSummaries(profile: string): SessionSummary[] {
    return this.listSessionCaches(profile).map((cache) => ({ ...cache.summary, tokens: { ...cache.summary.tokens } }));
  }

  listSessionUsage(profile: string): SessionUsageRecord[] {
    return this.listSessionCaches(profile).flatMap((cache) => cloneUsage(cache.usage));
  }

  indexSessionMessagesForFts(profile: string, sessionId: string, messages: Array<{ role?: string; text?: string }>): void {
    if (!this.sqlite || !this.hasFts) return;
    try {
      this.sqlite.prepare("DELETE FROM session_fts WHERE session_id = ? AND profile = ?").run(sessionId, profile);
      const insert = this.sqlite.prepare("INSERT INTO session_fts(session_id, profile, role, text) VALUES(?, ?, ?, ?)");
      for (const msg of messages) {
        if (msg.text && typeof msg.text === "string" && msg.text.trim()) {
          insert.run(sessionId, profile, msg.role || "message", msg.text);
        }
      }
    } catch {
      // Gracefully ignore FTS indexing errors
    }
  }

  searchSessionFts(profile: string, query: string, limit = 50): SessionSearchResult[] {
    if (!query.trim() || !this.sqlite || !this.hasFts) return [];
    try {
      const clean = query.replace(/['"*]/g, " ").trim();
      if (!clean) return [];
      const matchExpr = clean.split(/\s+/).filter(Boolean).map((w) => `"${w}"*`).join(" ");
      const rows = this.sqlite.prepare(
        "SELECT session_id, role, snippet(session_fts, 3, '<mark>', '</mark>', '...', 15) AS snippet FROM session_fts WHERE profile = ? AND session_fts MATCH ? LIMIT ?"
      ).all(profile, matchExpr, limit) as Array<{ session_id: string; role: string; snippet: string }>;
      return rows.map((r) => ({
        sessionId: r.session_id,
        role: r.role,
        snippet: r.snippet,
      }));
    } catch {
      return [];
    }
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
    const target = this.filePath + ".json";
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = target + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(temporary, JSON.stringify(this.fallback, null, 2), "utf8");
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
