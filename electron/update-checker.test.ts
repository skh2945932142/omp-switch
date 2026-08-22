import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { UpdateChecker, isAllowedExternalUrl, type UpdateCheckerOptions } from "./update-checker";
import { MANIFEST_URL, MANIFEST_SIG_URL, type UpdateManifest } from "@omp-switch/core";

/** A tiny in-memory preference store for tests, mirroring MetadataStore's get/set shape. */
function fakePreferences() {
  const store = new Map<string, unknown>();
  return {
    getPreference<T>(key: string): T | undefined { return store.get(key) as T | undefined; },
    async setPreference(key: string, value: unknown): Promise<void> { store.set(key, value); },
    _raw: store,
  };
}

const MANIFEST: UpdateManifest = {
  version: 1,
  name: "OMP Switch",
  release: "0.4.4",
  url: "https://github.com/skh2945932142/omp-switch/releases/tag/v0.4.4",
  summary: "Fixes cost.longContext",
  publishedAt: "2026-09-01T00:00:00Z",
};

/** Builds a fetch stub that serves a signed manifest and signature over the given payload. */
function signedFetch(payload: UpdateManifest) {
  const keypair = crypto.generateKeyPairSync("ed25519");
  const der = keypair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const publicKeyB64 = der.subarray(der.length - 32).toString("base64");
  const data = Buffer.from(JSON.stringify(payload), "utf8");
  const sig = crypto.sign(null, data, keypair.privateKey).toString("base64");
  const responses: Record<string, () => Response> = {
    [MANIFEST_URL]: () => new Response(data as unknown as BodyInit, { status: 200 }),
    [MANIFEST_SIG_URL]: () => new Response(sig, { status: 200 }),
  };
  const fetchImpl = ((url: string | URL) => {
    const handler = responses[String(url)];
    if (!handler) return Promise.resolve(new Response("", { status: 404 }));
    return Promise.resolve(handler());
  }) as unknown as typeof fetch;
  return { fetchImpl, publicKeyB64, data, sig };
}

function buildChecker(opts: Partial<UpdateCheckerOptions> & { fetchImpl: typeof fetch; now: () => Date; publicKeyB64: string }) {
  const preferences = opts.preferences ?? fakePreferences();
  return new UpdateChecker({
    currentVersion: opts.currentVersion ?? "0.4.3",
    preferences,
    fetchImpl: opts.fetchImpl,
    now: opts.now,
    publicKeyB64: opts.publicKeyB64,
  });
}

describe("UpdateChecker throttle and behavior", () => {
  it("auto-checks when enabled and past the 24h interval", async () => {
    const { fetchImpl, publicKeyB64 } = signedFetch(MANIFEST);
    let now = new Date("2026-09-02T00:00:00Z");
    const checker = buildChecker({ fetchImpl, now: () => now, publicKeyB64 });
    // Pretend a successful check happened 25h ago — auto-check should fire.
    await checker["preferences"].setPreference("update.lastCheckAt", "2026-09-01T00:00:00Z");
    const result = await checker.check(false);
    expect(result?.available).toBe(true);
    expect(result?.manifest.release).toBe("0.4.4");
  });

  it("does NOT auto-check when within the throttle window", async () => {
    const { fetchImpl, publicKeyB64 } = signedFetch(MANIFEST);
    let calls = 0;
    const counting = ((url: string | URL) => { calls++; return fetchImpl(url); }) as unknown as typeof fetch;
    let now = new Date("2026-09-02T00:00:00Z");
    const checker = buildChecker({ fetchImpl: counting, now: () => now, publicKeyB64 });
    // A successful check 1h ago — well within 24h, so no network call.
    await checker["preferences"].setPreference("update.lastCheckAt", "2026-09-01T23:00:00Z");
    const result = await checker.check(false);
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });

  it("does NOT check when disabled, regardless of time", async () => {
    const { fetchImpl, publicKeyB64 } = signedFetch(MANIFEST);
    let calls = 0;
    const counting = ((url: string | URL) => { calls++; return fetchImpl(url); }) as unknown as typeof fetch;
    const checker = buildChecker({ fetchImpl: counting, now: () => new Date("2026-09-02T00:00:00Z"), publicKeyB64 });
    await checker.setEnabled(false);
    // No lastCheckAt at all, but disabled — auto-check returns null without touching the network.
    const result = await checker.check(false);
    expect(result).toBeNull();
    expect(calls).toBe(0);
    expect(checker.isEnabled()).toBe(false);
  });

  it("force bypasses both the throttle and the enabled flag", async () => {
    const { fetchImpl, publicKeyB64 } = signedFetch(MANIFEST);
    const checker = buildChecker({ fetchImpl, now: () => new Date("2026-09-02T00:00:00Z"), publicKeyB64 });
    await checker.setEnabled(false);
    // Recent successful check + disabled, but force=true → the "立即检查" button still works.
    await checker["preferences"].setPreference("update.lastCheckAt", "2026-09-01T23:59:00Z");
    const result = await checker.check(true);
    expect(result?.available).toBe(true);
  });

  it("stays silent and returns null on a network failure without updating lastCheckAt", async () => {
    const failing = (() => Promise.resolve(new Response("", { status: 503 }))) as unknown as typeof fetch;
    const checker = buildChecker({ fetchImpl: failing, now: () => new Date("2026-09-02T00:00:00Z"), publicKeyB64: "d".repeat(43) + "=" });
    const before = checker.getSnapshot().lastCheckAt;
    const result = await checker.check(false);
    expect(result).toBeNull();
    // lastCheckAt is only advanced on success; a failure records a failure marker instead.
    expect(checker.getSnapshot().lastCheckAt).toBe(before);
  });

  it("stays silent and returns null on a tampered manifest (signature mismatch)", async () => {
    const { fetchImpl, publicKeyB64 } = signedFetch(MANIFEST);
    // Swap the manifest response for tampered bytes while keeping the original signature.
    const tampered = Buffer.from(JSON.stringify({ ...MANIFEST, release: "99.0.0" }), "utf8");
    const wrapped = ((url: string | URL) => {
      if (String(url) === MANIFEST_URL) return Promise.resolve(new Response(tampered as unknown as BodyInit, { status: 200 }));
      return fetchImpl(url);
    }) as unknown as typeof fetch;
    const checker = buildChecker({ fetchImpl: wrapped, now: () => new Date("2026-09-02T00:00:00Z"), publicKeyB64 });
    const result = await checker.check(true);
    expect(result).toBeNull();
    expect(checker.getSnapshot().lastResult).toBeNull();
  });

  it("returns null (not 'older') when the manifest release is not newer", async () => {
    const { fetchImpl, publicKeyB64 } = signedFetch({ ...MANIFEST, release: "0.4.3" });
    const checker = buildChecker({ fetchImpl, now: () => new Date("2026-09-02T00:00:00Z"), publicKeyB64 });
    const result = await checker.check(true);
    // Equal version: a successful check, but no available update.
    expect(result).toBeNull();
  });

  it("caches the last result so update:status does not need a network call", async () => {
    const { fetchImpl, publicKeyB64 } = signedFetch(MANIFEST);
    const checker = buildChecker({ fetchImpl, now: () => new Date("2026-09-02T00:00:00Z"), publicKeyB64 });
    await checker.check(true);
    const snapshot = checker.getSnapshot();
    expect(snapshot.lastResult?.available).toBe(true);
    expect(snapshot.lastCheckAt).not.toBeNull();
  });

  it("retries after the shorter failure window, not the full 24h", async () => {
    let ok = false;
    const { fetchImpl, publicKeyB64 } = signedFetch(MANIFEST);
    const toggling = ((url: string | URL) => ok ? fetchImpl(url) : Promise.resolve(new Response("", { status: 503 }))) as unknown as typeof fetch;
    let now = new Date("2026-09-02T00:00:00Z");
    const checker = buildChecker({ fetchImpl: toggling, now: () => now, publicKeyB64 });
    // First auto-check fails (network down).
    expect(await checker.check(false)).toBeNull();
    // Advance 30 min — still under the 1h failure-retry window, so still throttled.
    now = new Date("2026-09-02T00:30:00Z");
    expect(await checker.check(false)).toBeNull();
    // Advance to 1h01m — past the failure-retry window; now the network is back.
    now = new Date("2026-09-02T01:01:00Z");
    ok = true;
    const result = await checker.check(false);
    expect(result?.available).toBe(true);
  });
});

describe("isAllowedExternalUrl", () => {
  it("allows https github.com URLs only", () => {
    expect(isAllowedExternalUrl("https://github.com/skh2945932142/omp-switch/releases/tag/v0.4.4")).toBe(true);
    expect(isAllowedExternalUrl("http://github.com/x")).toBe(false); // not https
    expect(isAllowedExternalUrl("https://evil.example/x")).toBe(false); // wrong host
    expect(isAllowedExternalUrl("not-a-url")).toBe(false);
  });
});
