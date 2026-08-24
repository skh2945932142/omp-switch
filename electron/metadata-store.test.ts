import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MetadataStore } from "./metadata-store";
import type { GatewayPool, SessionFileCache } from "@omp-switch/core";

const tempRoots: string[] = [];
const openStores: MetadataStore[] = [];

async function makeStore(backend: "auto" | "json") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-metadata-test-"));
  tempRoots.push(root);
  const store = new MetadataStore(root, { backend });
  await store.init();
  openStores.push(store);
  return { root, store };
}

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function pool(id: string, profile = "default"): GatewayPool {
  return {
    id,
    profile,
    virtualModel: "omp-switch/" + id,
    port: 46831,
    enabled: true,
    upstreams: [{ id: "one", providerId: "openai", modelId: "gpt-5", kind: "secret", credentialId: "cred", enabled: true }],
  };
}

function sessionCache(id: string, profile = "default", hour = 0): SessionFileCache {
  return {
    id,
    profile,
    relativePath: "project/2026-08-19T0" + hour + "-00-00-000Z_019f428b-2bca-7000-8c4f-b21fd95671f4.jsonl",
    fileSize: 100 + hour,
    mtimeMs: hour,
    headHash: "head-" + hour,
    completeBytes: 100 + hour,
    invalidLines: 0,
    summary: {
      id,
      profile,
      title: "Session " + id,
      lastActiveAt: "2026-08-19T0" + hour + ":00:00Z",
      messageCount: 2,
      requestCount: 1,
      failures: 0,
      tokens: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 5 },
      cost: 0.001,
      fileSize: 100 + hour,
    },
    usage: [{
      id: "usage-" + id,
      sessionId: id,
      profile,
      startedAt: "2026-08-19T0" + hour + ":00:00Z",
      model: "gpt-5",
      provider: "openai",
      tokens: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 5 },
      cost: 0.001,
      requestCount: 1,
      failures: 0,
      sourceKey: id + ":0",
    }],
  };
}

describe.each(["auto", "json"] as const)("MetadataStore (%s backend)", (backend) => {
  it("round-trips provider labels", async () => {
    const { store } = await makeStore(backend);
    expect(store.getProviderLabels()).toEqual({});
    await store.setProviderLabel("openai", "Work OpenAI");
    await store.setProviderLabel("openai", "Renamed");
    await store.setProviderLabel("groq", "Groq");
    expect(store.getProviderLabels()).toEqual({ openai: "Renamed", groq: "Groq" });
  });

  it("returns the newest snapshot per profile and keeps profiles apart", async () => {
    const { store } = await makeStore(backend);
    expect(store.getLatestSnapshot("default")).toBeNull();
    await store.addSnapshot({ id: "a", profile: "default", createdAt: "2026-08-19T01:00:00Z" });
    await store.addSnapshot({ id: "b", profile: "default", createdAt: "2026-08-19T03:00:00Z" });
    await store.addSnapshot({ id: "c", profile: "work", createdAt: "2026-08-19T02:00:00Z" });
    expect(store.getLatestSnapshot("default")).toMatchObject({ id: "b" });
    expect(store.getLatestSnapshot("work")).toMatchObject({ id: "c" });
  });

  it("caps stored snapshots so the metadata never grows without bound", async () => {
    const { store } = await makeStore(backend);
    for (let index = 0; index < 35; index += 1) {
      await store.addSnapshot({
        id: "snap-" + String(index).padStart(2, "0"),
        profile: "default",
        createdAt: "2026-08-19T" + String(index % 24).padStart(2, "0") + ":" + String(index).padStart(2, "0") + ":00Z",
      });
    }
    expect(store.listSnapshots("default").length).toBe(30);
  }, 30_000);

  it("upserts gateway pools and filters them by profile", async () => {
    const { store } = await makeStore(backend);
    await store.saveGatewayPool(pool("fast"));
    await store.saveGatewayPool(pool("fast"));
    await store.saveGatewayPool(pool("slow", "work"));
    expect(store.listGatewayPools("default").map((item) => item.id)).toEqual(["fast"]);
    expect(store.listGatewayPools("work").map((item) => item.id)).toEqual(["slow"]);
    expect(store.listGatewayPools().length).toBe(2);
  });

  it("persists summaries, private cache state and usage by profile", async () => {
    const { store } = await makeStore(backend);
    await store.replaceSessionCaches("default", [sessionCache("one", "default", 1), sessionCache("two", "default", 2)]);
    await store.replaceSessionCaches("work", [sessionCache("three", "work", 3)]);
    expect(store.listSessionSummaries("default").map((summary) => summary.id)).toEqual(["two", "one"]);
    expect(store.listSessionUsage("default").map((usage) => usage.id).sort()).toEqual(["usage-one", "usage-two"]);
    expect(store.getSessionCache("default", "one")?.relativePath).toContain("project/");

    await store.replaceSessionCaches("default", [sessionCache("four", "default", 4)]);
    expect(store.listSessionSummaries("default").map((summary) => summary.id)).toEqual(["four"]);
    expect(store.listSessionSummaries("work").map((summary) => summary.id)).toEqual(["three"]);
  });

  it("stores preferences of every JSON shape", async () => {
    const { store } = await makeStore(backend);
    expect(store.getPreference("missing")).toBeUndefined();
    await store.setPreference("gateway.port", 46999);
    await store.setPreference("catalog.entries", [{ id: "custom" }]);
    await store.setPreference("gateway.port", 47000);
    expect(store.getPreference<number>("gateway.port")).toBe(47000);
    expect(store.getPreference<Array<{ id: string }>>("catalog.entries")).toEqual([{ id: "custom" }]);
  });

  it("survives a reopen of the same directory", async () => {
    const { root, store } = await makeStore(backend);
    await store.setPreference("gateway.port", 46123);
    await store.replaceSessionCaches("default", [sessionCache("one")]);

    const reopened = new MetadataStore(root, { backend });
    await reopened.init();
    openStores.push(reopened);
    expect(reopened.getPreference<number>("gateway.port")).toBe(46123);
    expect(reopened.listSessionSummaries("default").map((summary) => summary.id)).toEqual(["one"]);
  });
});

describe("MetadataStore migration", () => {
  it("upgrades a legacy JSON cache without retaining event paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-metadata-legacy-"));
    tempRoots.push(root);
    await fs.writeFile(path.join(root, "metadata.sqlite.json"), JSON.stringify({
      version: 2,
      providerLabels: { openai: "OpenAI" },
      preferences: { "gateway.port": 46831 },
      sessionIndex: [{ filePath: "C:/sensitive/session.jsonl", offset: 0 }],
    }), "utf8");
    const store = new MetadataStore(root, { backend: "json" });
    await store.init();
    openStores.push(store);
    expect(store.getProviderLabels()).toEqual({ openai: "OpenAI" });
    expect(store.getPreference<number>("gateway.port")).toBe(46831);
    expect(store.listSessionCaches("default")).toEqual([]);
    await expect(fs.readFile(path.join(root, "metadata.sqlite.json"), "utf8")).resolves.not.toContain("C:/sensitive");
  });

  it("uses the JSON file when the fallback is forced", async () => {
    const { root, store } = await makeStore("json");
    expect(store.activeBackend).toBe("json");
    await store.setPreference("gateway.port", 46001);
    await expect(fs.readFile(path.join(root, "metadata.sqlite.json"), "utf8")).resolves.toContain("46001");
  });

  it("removes obsolete message offsets from a current JSON cache", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-metadata-offset-json-"));
    tempRoots.push(root);
    const legacy = { ...sessionCache("one"), messageOffsets: [{ id: "message-one", offset: 0, length: 100 }] };
    await fs.writeFile(path.join(root, "metadata.sqlite.json"), JSON.stringify({
      version: 3,
      providerLabels: {},
      snapshots: [],
      gatewayPools: [],
      sessionCaches: [legacy],
      preferences: {},
    }), "utf8");
    const store = new MetadataStore(root, { backend: "json" });
    await store.init();
    openStores.push(store);

    expect(store.getSessionCache("default", "one")).toBeDefined();
    await expect(fs.readFile(path.join(root, "metadata.sqlite.json"), "utf8")).resolves.not.toContain("messageOffsets");
  });

  it("removes obsolete message offsets and event tables from SQLite", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-metadata-offset-sqlite-"));
    tempRoots.push(root);
    const { DatabaseSync } = await import("node:sqlite");
    const databasePath = path.join(root, "metadata.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec("CREATE TABLE session_cache (id TEXT PRIMARY KEY, profile TEXT NOT NULL, relative_path TEXT NOT NULL, payload TEXT NOT NULL); CREATE TABLE session_index (id TEXT PRIMARY KEY);");
    const { usage: _usage, ...payload } = sessionCache("one");
    database.prepare("INSERT INTO session_cache(id, profile, relative_path, payload) VALUES(?, ?, ?, ?)").run(
      payload.id,
      payload.profile,
      payload.relativePath,
      JSON.stringify({ ...payload, messageOffsets: [{ id: "message-one", offset: 0, length: 100 }] }),
    );
    database.close();

    const store = new MetadataStore(root, { backend: "auto" });
    await store.init();
    expect(store.activeBackend).toBe("sqlite");
    expect(store.getSessionCache("default", "one")).toBeDefined();
    store.close();

    const verify = new DatabaseSync(databasePath);
    const row = verify.prepare("SELECT payload FROM session_cache WHERE id = ?").get("one") as { payload: string };
    expect(JSON.parse(row.payload)).not.toHaveProperty("messageOffsets");
    expect(verify.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_index'").get()).toBeUndefined();
    verify.close();
  });

  it("persists gateway probe history and computes health state across backends", async () => {
    for (const backend of ["auto", "json"] as const) {
      const { store } = await makeStore(backend);
      await store.recordGatewayProbe({
        poolId: "pool-1",
        upstreamId: "up-1",
        timestamp: "2026-08-24T08:00:00.000Z",
        ok: true,
        status: 200,
        latencyMs: 150,
      });
      await store.recordGatewayProbe({
        poolId: "pool-1",
        upstreamId: "up-1",
        timestamp: "2026-08-24T08:01:00.000Z",
        ok: true,
        status: 200,
        latencyMs: 120,
      });
      await store.recordGatewayProbe({
        poolId: "pool-1",
        upstreamId: "up-2",
        timestamp: "2026-08-24T08:02:00.000Z",
        ok: false,
        status: 500,
        latencyMs: 3200,
        error: "HTTP 500",
      });

      const history = store.listGatewayProbeHistory("pool-1");
      expect(history).toHaveLength(3);

      const health = store.getGatewayHealth("pool-1");
      expect(health["pool-1:up-1"]).toBeDefined();
      expect(health["pool-1:up-1"].healthState).toBe("healthy");
      expect(health["pool-1:up-1"].lastLatencyMs).toBe(120);

      expect(health["pool-1:up-2"]).toBeDefined();
      expect(health["pool-1:up-2"].healthState).toBe("unhealthy");
      expect(health["pool-1:up-2"].consecutiveFailures).toBe(1);
    }
  });
});
