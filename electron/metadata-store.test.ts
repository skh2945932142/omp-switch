import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MetadataStore } from "./metadata-store";
import type { GatewayPool, SessionIndexEntry } from "@omp-switch/core";

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
  // The sqlite handle keeps the file locked on Windows, so close before removing the directory.
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function pool(id: string, profile = "default"): GatewayPool {
  return {
    id,
    profile,
    virtualModel: `omp-switch/${id}`,
    port: 46831,
    enabled: true,
    upstreams: [{ id: "one", providerId: "openai", modelId: "gpt-5", kind: "secret", credentialId: "cred", enabled: true }],
  };
}

function sessionEntry(id: string, profile = "default", offset = 0): SessionIndexEntry {
  return { id, profile, filePath: `C:/sessions/${profile}.jsonl`, offset, length: 10, startedAt: `2026-08-19T0${offset}:00:00Z` };
}

// Every method has a sqlite branch and a JSON branch. Running the same expectations against both is
// the only thing that keeps them from drifting, which would make data vanish on machines that fall
// back to JSON.
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

  // 35 sequential awaited writes, and the JSON backend rewrites the whole file each time, so this is
  // I/O-bound by construction. It finishes in well under a second locally but exceeded vitest's 5s
  // default on a Windows CI runner and failed a release build, so the budget is explicit.
  it("caps stored snapshots so the metadata never grows without bound", async () => {
    const { store } = await makeStore(backend);
    for (let index = 0; index < 35; index += 1) {
      await store.addSnapshot({ id: `snap-${String(index).padStart(2, "0")}`, profile: "default", createdAt: `2026-08-19T${String(index % 24).padStart(2, "0")}:${String(index).padStart(2, "0")}:00Z` });
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
    expect(store.listGatewayPools("default")[0].upstreams[0].credentialId).toBe("cred");
  });

  it("replaces the session index for one profile only, newest first", async () => {
    const { store } = await makeStore(backend);
    await store.replaceSessionIndex("default", [sessionEntry("one", "default", 1), sessionEntry("two", "default", 2)]);
    await store.replaceSessionIndex("work", [sessionEntry("three", "work", 3)]);
    expect(store.listSessionIndex("default").map((entry) => entry.id)).toEqual(["two", "one"]);

    await store.replaceSessionIndex("default", [sessionEntry("four", "default", 4)]);
    expect(store.listSessionIndex("default").map((entry) => entry.id)).toEqual(["four"]);
    expect(store.listSessionIndex("work").map((entry) => entry.id)).toEqual(["three"]);
  });

  it("keeps duplicate event ids from different offsets distinct", async () => {
    const { store } = await makeStore(backend);
    await store.replaceSessionIndex("default", [sessionEntry("dup", "default", 1), sessionEntry("dup", "default", 2)]);
    expect(store.listSessionIndex("default").length).toBe(2);
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
    await store.saveGatewayPool(pool("fast"));

    const reopened = new MetadataStore(root, { backend });
    await reopened.init();
    openStores.push(reopened);
    expect(reopened.getPreference<number>("gateway.port")).toBe(46123);
    expect(reopened.listGatewayPools("default").map((item) => item.id)).toEqual(["fast"]);
  });
});

describe("MetadataStore backend selection", () => {
  it("uses the JSON file when the fallback is forced", async () => {
    const { root, store } = await makeStore("json");
    expect(store.activeBackend).toBe("json");
    await store.setPreference("gateway.port", 46001);
    await expect(fs.readFile(path.join(root, "metadata.sqlite.json"), "utf8")).resolves.toContain("46001");
  });

  it("tolerates an unreadable fallback file instead of failing startup", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-metadata-test-"));
    tempRoots.push(root);
    await fs.writeFile(path.join(root, "metadata.sqlite.json"), "{ not json", "utf8");
    const store = new MetadataStore(root, { backend: "json" });
    await store.init();
    expect(store.getPreference("anything")).toBeUndefined();
  });
});
