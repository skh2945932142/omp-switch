import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  MANIFEST_URL,
  MANIFEST_SIG_URL,
  VERIFY_PUBLIC_KEY,
  buildUpdateStatus,
  compareVersions,
  parseUpdateManifest,
  verifyManifestSignature,
  type UpdateManifest,
} from "./update";

const VALID_MANIFEST: UpdateManifest = {
  version: 1,
  name: "OMP Switch",
  release: "0.4.4",
  url: "https://github.com/skh2945932142/omp-switch/releases/tag/v0.4.4",
  summary: "Fixes cost.longContext",
  publishedAt: "2026-09-01T00:00:00Z",
};

/** Raw 32-byte Ed25519 public key as base64, from a KeyObject. */
function rawPublicKeyBase64(publicKey: crypto.KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return der.subarray(der.length - 32).toString("base64");
}

describe("compareVersions", () => {
  it("orders numeric major.minor.patch", () => {
    expect(compareVersions("0.4.3", "0.4.4")).toBe(-1);
    expect(compareVersions("0.4.4", "0.4.3")).toBe(1);
    expect(compareVersions("0.4.3", "0.4.3")).toBe(0);
  });

  it("treats a missing patch as 0", () => {
    expect(compareVersions("0.4", "0.4.0")).toBe(0);
    expect(compareVersions("0.4", "0.4.1")).toBe(-1);
  });

  it("compares numerically, not lexically — 0.4.10 beats 0.4.3", () => {
    expect(compareVersions("0.4.10", "0.4.3")).toBe(1);
    expect(compareVersions("0.4.3", "0.4.10")).toBe(-1);
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });

  it("strips a leading v and ignores pre-release tags", () => {
    expect(compareVersions("v0.4.3", "0.4.3-rc1")).toBe(0);
    expect(compareVersions("v0.4.4", "v0.4.3")).toBe(1);
  });

  it("returns 0 (never claims newer) for unparseable input", () => {
    expect(compareVersions("not-a-version", "0.4.3")).toBe(0);
    expect(compareVersions("", "0.4.3")).toBe(0);
  });
});

describe("parseUpdateManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(parseUpdateManifest(VALID_MANIFEST)).toEqual(VALID_MANIFEST);
  });

  it("accepts a manifest without the optional fields", () => {
    const minimal = { version: 1, name: "OMP Switch", release: "0.4.4", url: "https://github.com/x/y" };
    expect(parseUpdateManifest(minimal)).toEqual({ ...minimal, summary: undefined, publishedAt: undefined });
  });

  it("rejects a manifest whose url is not github.com", () => {
    expect(parseUpdateManifest({ ...VALID_MANIFEST, url: "https://evil.example/download" })).toBeNull();
  });

  it("rejects the wrong manifest schema version", () => {
    expect(parseUpdateManifest({ ...VALID_MANIFEST, version: 2 })).toBeNull();
  });

  it("rejects missing or mistyped required fields", () => {
    expect(parseUpdateManifest(null)).toBeNull();
    expect(parseUpdateManifest("string")).toBeNull();
    expect(parseUpdateManifest({ ...VALID_MANIFEST, release: 42 })).toBeNull();
    expect(parseUpdateManifest({ ...VALID_MANIFEST, name: "" })).toBeNull();
    expect(parseUpdateManifest({ ...VALID_MANIFEST, url: "" })).toBeNull();
    expect(parseUpdateManifest({ version: 1, name: "x", release: "1.0.0" })).toBeNull(); // no url
  });

  it("rejects a non-string summary or publishedAt", () => {
    expect(parseUpdateManifest({ ...VALID_MANIFEST, summary: 5 })).toBeNull();
    expect(parseUpdateManifest({ ...VALID_MANIFEST, publishedAt: false })).toBeNull();
  });
});

describe("verifyManifestSignature", () => {
  // The production private key never leaves CI, so these tests sign with a throwaway keypair and
  // pass its public key into the verifier — exercising the exact crypto path the app runs, just
  // with a test key instead of the hardcoded one.
  const keypair = crypto.generateKeyPairSync("ed25519");
  const publicKeyB64 = rawPublicKeyBase64(keypair.publicKey);

  it("accepts a signature from the matching private key over the exact bytes", () => {
    const data = Buffer.from(JSON.stringify(VALID_MANIFEST), "utf8");
    const sig = crypto.sign(null, data, keypair.privateKey).toString("base64");
    expect(verifyManifestSignature(data, sig, publicKeyB64)).toBe(true);
  });

  it("rejects a signature over tampered manifest bytes", () => {
    const data = Buffer.from(JSON.stringify(VALID_MANIFEST), "utf8");
    const sig = crypto.sign(null, data, keypair.privateKey).toString("base64");
    const tampered = Buffer.from(JSON.stringify({ ...VALID_MANIFEST, release: "99.0.0" }), "utf8");
    expect(verifyManifestSignature(tampered, sig, publicKeyB64)).toBe(false);
  });

  it("rejects a signature from a foreign key (wrong signer)", () => {
    const foreign = crypto.generateKeyPairSync("ed25519");
    const data = Buffer.from(JSON.stringify(VALID_MANIFEST), "utf8");
    const sig = crypto.sign(null, data, foreign.privateKey).toString("base64");
    expect(verifyManifestSignature(data, sig, publicKeyB64)).toBe(false);
  });

  it("rejects malformed signature input without throwing", () => {
    const data = Buffer.from("{}", "utf8");
    expect(verifyManifestSignature(data, "not-valid-base64!!", publicKeyB64)).toBe(false);
    expect(verifyManifestSignature(data, "", publicKeyB64)).toBe(false);
  });
});

describe("buildUpdateStatus", () => {
  it("marks a higher release available", () => {
    const status = buildUpdateStatus({ ...VALID_MANIFEST, release: "0.4.4" }, "0.4.3", "2026-09-01T00:00:00Z");
    expect(status).toMatchObject({ available: true, currentVersion: "0.4.3" });
    expect(status?.manifest.release).toBe("0.4.4");
  });

  it("returns null when the manifest is not newer (equal or lower)", () => {
    expect(buildUpdateStatus({ ...VALID_MANIFEST, release: "0.4.3" }, "0.4.3", "now")).toBeNull();
    expect(buildUpdateStatus({ ...VALID_MANIFEST, release: "0.4.2" }, "0.4.3", "now")).toBeNull();
  });
});

it("exposes fixed manifest URLs on github.com", () => {
  expect(MANIFEST_URL).toMatch(/^https:\/\/github\.com\//);
  expect(MANIFEST_SIG_URL).toMatch(/^https:\/\/github\.com\//);
  expect(VERIFY_PUBLIC_KEY).toMatch(/^[A-Za-z0-9+/]{43}=$/);
});
