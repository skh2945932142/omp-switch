import crypto from "node:crypto";

/**
 * The signed update manifest published alongside each release. `version` is the manifest schema
 * version (not the app version); `release` is the OMP Switch release tag without the leading `v`.
 * `publishedAt` is an ISO 8601 timestamp set by the CI. `summary` is a short human note shown in the
 * "关于/About" drawer.
 */
export interface UpdateManifest {
  version: number;
  name: string;
  release: string;
  url: string;
  summary?: string;
  publishedAt?: string;
}

/**
 * The result of an update check, resolved after signature verification and version comparison.
 * `available` is true only when a newer release than `currentVersion` was found. `manifest` carries
 * the verified manifest; `checkedAt` is when the check completed (ISO), so the renderer can show
 * "checked N minutes ago" without re-querying.
 */
export interface UpdateStatus {
  available: boolean;
  currentVersion: string;
  manifest: UpdateManifest;
  checkedAt: string;
}

/**
 * Ed25519 public key (32 raw bytes, base64) whose private counterpart signs the release manifest in
 * CI (secret `OMP_UPDATE_ED25519`). Hardcoded here so a forged manifest on a compromised CDN cannot
 * be presented as a genuine update: the app verifies every `latest.json` against this key before it
 * is ever trusted. Rotating the key requires shipping a new app build.
 *
 * The matching private key is held only as a GitHub Actions secret and never enters the repo, so it
 * cannot be unit-tested end-to-end here — `verifyManifestSignature` takes an optional public key so
 * tests can sign with their own throwaway keypair and exercise the full crypto path.
 */
export const VERIFY_PUBLIC_KEY = "6BinnnFiq6WYtVR2LXd6XWUIQHUgIiFvcGUyIlyXFcc=";

/** The fixed, signed-manifest URLs. Both are GET; neither accepts any query. */
export const MANIFEST_URL = "https://github.com/skh2945932142/omp-switch/releases/download/latest/latest.json";
export const MANIFEST_SIG_URL = "https://github.com/skh2945932142/omp-switch/releases/download/latest/latest.json.sig";

/** How often an automatic (non-forced) check may run. */
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Minimum gap before an automatic retry after a failure, to avoid hammering on a persistent outage. */
export const AUTO_CHECK_FAILURE_RETRY_MS = 60 * 60 * 1000;

/**
 * Compares two semver-ish version strings by numeric major.minor.patch. Pre-release tags are
 * ignored — OMP Switch ships no pre-releases, so `0.4.3-rc1` compares as `0.4.3`. A missing patch
 * segment is treated as 0. Returns -1 if `a` < `b`, 0 if equal, 1 if `a` > `b`. Unparseable inputs
 * compare as equal (0) so a malformed manifest can never claim to be "newer".
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

function parseSemver(value: string): [number, number, number] | null {
  if (typeof value !== "string") return null;
  // Strip a leading `v` and any pre-release/build suffix; we only compare the numeric core. A
  // missing minor or patch segment is treated as 0 (so `0.4` == `0.4.0`).
  const match = value.trim().replace(/^v/i, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), match[2] !== undefined ? Number(match[2]) : 0, match[3] !== undefined ? Number(match[3]) : 0];
}

/**
 * Validates and narrows an untrusted JSON value into an `UpdateManifest`, or returns null if it is
 * structurally wrong. Only the `version`/`name`/`release`/`url` fields are required; `summary` and
 * `publishedAt` are optional. The `url` must point at github.com so a compromised manifest cannot
 * redirect the "前往下载" button to an attacker host.
 */
export function parseUpdateManifest(json: unknown): UpdateManifest | null {
  if (!json || typeof json !== "object") return null;
  const record = json as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (typeof record.name !== "string" || record.name.length === 0) return null;
  if (typeof record.release !== "string" || record.release.length === 0) return null;
  if (typeof record.url !== "string" || !/^https:\/\/github\.com\//i.test(record.url)) return null;
  const summary = record.summary;
  if (summary !== undefined && typeof summary !== "string") return null;
  const publishedAt = record.publishedAt;
  if (publishedAt !== undefined && typeof publishedAt !== "string") return null;
  return { version: 1, name: record.name, release: record.release, url: record.url, summary, publishedAt };
}

/**
 * Verifies a detached Ed25519 signature over the manifest bytes. `data` is the exact UTF-8 bytes of
 * `latest.json` (the file the CDN served); `signatureB64` is the base64 `.sig` asset. Returns true
 * only when the signature is valid. Any error (bad base64, wrong key, tampered data) resolves to
 * false — the caller treats that as "no update" and stays silent.
 *
 * `publicKeyB64` defaults to the hardcoded production key; tests pass a throwaway key whose matching
 * private key they sign with. The production private key never leaves CI, so it cannot be tested
 * here — only the verification logic can.
 */
export function verifyManifestSignature(data: Uint8Array, signatureB64: string, publicKeyB64: string = VERIFY_PUBLIC_KEY): boolean {
  try {
    const signature = Buffer.from(signatureB64, "base64");
    if (signature.length !== 64) return false; // Ed25519 signatures are 64 bytes
    const key = crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyB64, "base64")]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, data, key, signature);
  } catch {
    return false;
  }
}

/** Builds a successful `UpdateStatus` for a verified manifest, or null if there is no newer release. */
export function buildUpdateStatus(manifest: UpdateManifest, currentVersion: string, checkedAt: string): UpdateStatus | null {
  if (compareVersions(manifest.release, currentVersion) !== 1) return null;
  return { available: true, currentVersion, manifest, checkedAt };
}

// Ed25519 SPKI DER prefix (24 bytes) wrapping a 32-byte raw public key. Prepending this to the raw
// key lets us build a KeyObject from the 32 raw bytes without an extra dependency.
const SPKI_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);
