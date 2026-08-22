import { app, shell } from "electron";
import {
  AUTO_CHECK_FAILURE_RETRY_MS,
  AUTO_CHECK_INTERVAL_MS,
  MANIFEST_SIG_URL,
  MANIFEST_URL,
  VERIFY_PUBLIC_KEY,
  buildUpdateStatus,
  parseUpdateManifest,
  verifyManifestSignature,
  type UpdateStatus,
} from "@omp-switch/core";

/**
 * Minimum TypeScript surface of MetadataStore the checker needs. Declared here (not imported) so
 * the unit test can inject a fake without pulling Electron into core.
 */
interface Preferences {
  getPreference<T>(key: string): T | undefined;
  setPreference(key: string, value: unknown): Promise<void>;
}

export interface UpdateCheckerOptions {
  /** The current app version, compared against the manifest's `release`. */
  currentVersion: string;
  /** Reads/writes the persisted checker state. Defaults to the main-process MetadataStore. */
  preferences?: Preferences;
  /** Injectable so tests can stub the network without Electron's fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable clock so tests can advance time deterministically. */
  now?: () => Date;
  /**
   * The Ed25519 public key used to verify the manifest. Defaults to the hardcoded production key
   * (`VERIFY_PUBLIC_KEY`); tests inject a throwaway key whose private counterpart they sign with,
   * since the production private key never leaves CI and cannot be used in a unit test.
   */
  publicKeyB64?: string;
}

/** What the renderer can read without triggering a network call. */
export interface UpdateCheckerSnapshot {
  enabled: boolean;
  lastCheckAt: string | null;
  lastResult: UpdateStatus | null;
}

const PREF_ENABLED = "update.checkEnabled";
const PREF_LAST_CHECK_AT = "update.lastCheckAt";
const PREF_LAST_RESULT = "update.lastResult";
const PREF_LAST_FAILURE_AT = "update.lastFailureAt";

/** Hosts the renderer may open via `app:open-external`. Anything else is refused. */
const EXTERNAL_HOST_ALLOWLIST = new Set(["github.com"]);

export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && EXTERNAL_HOST_ALLOWLIST.has(url.hostname);
  } catch {
    return false;
  }
}

export class UpdateChecker {
  private readonly currentVersion: string;
  private readonly preferences: Preferences;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly publicKeyB64: string;
  private cached: UpdateStatus | null;
  /** Guards concurrent in-flight checks so a manual "check now" cannot race the auto timer. */
  private inflight: Promise<UpdateStatus | null> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: UpdateCheckerOptions) {
    this.currentVersion = options.currentVersion;
    this.preferences = options.preferences ?? (globalThis as { __metadata?: Preferences }).__metadata!;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.publicKeyB64 = options.publicKeyB64 ?? VERIFY_PUBLIC_KEY;
    this.cached = this.preferences.getPreference<UpdateStatus | null>(PREF_LAST_RESULT) ?? null;
  }

  /** Whether automatic (non-forced) checks may run. */
  isEnabled(): boolean {
    // Defaults to enabled: the feature's value is being told about a new release, and a user who
    // wants it off opts out explicitly in the Profile drawer.
    return this.preferences.getPreference<boolean>(PREF_ENABLED) ?? true;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.preferences.setPreference(PREF_ENABLED, enabled);
    // Re-arm the timer so a disable takes effect immediately rather than after the next tick.
    if (!enabled) this.stop();
    else this.start();
  }

  /** Returns the cached state without any network activity. */
  getSnapshot(): UpdateCheckerSnapshot {
    return {
      enabled: this.isEnabled(),
      lastCheckAt: this.preferences.getPreference<string>(PREF_LAST_CHECK_AT) ?? null,
      lastResult: this.cached,
    };
  }

  /**
   * Performs a check. `force` bypasses the throttle and the enabled flag — the renderer's
   * "立即检查" button always works, even when auto-check is off. Returns null (and stays silent)
   * on any failure: network, signature, parse, or "not newer". Never throws.
   */
  async check(force: boolean): Promise<UpdateStatus | null> {
    if (this.inflight) return this.inflight;
    this.inflight = this.runCheck(force).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async runCheck(force: boolean): Promise<UpdateStatus | null> {
    if (!force) {
      if (!this.isEnabled()) return null;
      const lastCheck = this.preferences.getPreference<string>(PREF_LAST_CHECK_AT);
      const lastFailure = this.preferences.getPreference<string>(PREF_LAST_FAILURE_AT);
      const since = lastFailure ?? lastCheck;
      if (since) {
        const elapsed = this.now().getTime() - new Date(since).getTime();
        // A successful check throttles for the full interval; a failed one backs off for the
        // shorter failure-retry window so a transient outage is retried without hammering.
        const gap = lastFailure ? AUTO_CHECK_FAILURE_RETRY_MS : AUTO_CHECK_INTERVAL_MS;
        if (elapsed < gap) return null;
      }
    }

    try {
      const manifestBytes = await this.fetchBytes(MANIFEST_URL);
      const sigText = await this.fetchText(MANIFEST_SIG_URL);
      // The signature is over the exact bytes the CDN served for latest.json — not a re-serialized
      // copy — so a CDN that rewrites whitespace is caught as a signature mismatch.
      if (!verifyManifestSignature(manifestBytes, sigText.trim(), this.publicKeyB64)) {
        this.recordFailure();
        return null;
      }
      const manifest = parseUpdateManifest(JSON.parse(Buffer.from(manifestBytes).toString("utf8")));
      if (!manifest) {
        this.recordFailure();
        return null;
      }
      const status = buildUpdateStatus(manifest, this.currentVersion, this.now().toISOString());
      // Even "no newer release" is a successful check: persist a checkedAt and clear the failure
      // marker, but only persist lastResult when there is something to tell the user (so a stale
      // "v0.4.4 available" notice does not linger after the user upgrades past it).
      const checkedAt = this.now().toISOString();
      await this.preferences.setPreference(PREF_LAST_CHECK_AT, checkedAt);
      await this.preferences.setPreference(PREF_LAST_FAILURE_AT, null);
      this.cached = status;
      await this.preferences.setPreference(PREF_LAST_RESULT, status);
      return status;
    } catch (error) {
      // Network outage, non-200, malformed JSON, or a verify throw — every failure is silent.
      console.warn("update check failed:", error instanceof Error ? error.message : String(error));
      this.recordFailure();
      return null;
    }
  }

  private async fetchBytes(url: string): Promise<Uint8Array> {
    const response = await this.fetchImpl(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`update manifest fetch failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async fetchText(url: string): Promise<string> {
    const response = await this.fetchImpl(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`update signature fetch failed: ${response.status}`);
    return await response.text();
  }

  private async recordFailure(): Promise<void> {
    await this.preferences.setPreference(PREF_LAST_FAILURE_AT, this.now().toISOString());
  }

  /** Begins the automatic-check schedule: a one-shot after STARTUP_DELAY_MS, then every interval. */
  start(): void {
    if (this.timer || !this.isEnabled()) return;
    this.timer = setTimeout(() => {
      void this.check(false);
      // After the first fire, switch to the recurring interval. Using setTimeout chains (rather
      // than setInterval) keeps the drift tied to wall-clock checks, not to how long a check took.
      this.timer = setInterval(() => { void this.check(false); }, AUTO_CHECK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  /** Stops the automatic schedule (kept alive only while the app runs). */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** First automatic check happens after this delay so it does not race app startup. */
export const STARTUP_DELAY_MS = 30_000;

/** Convenience wrapper bound to the running app, created in main.ts. */
let activeChecker: UpdateChecker | null = null;

export function initUpdateChecker(preferences: Preferences, fetchImpl?: typeof fetch): UpdateChecker {
  activeChecker = new UpdateChecker({ currentVersion: app.getVersion(), preferences, fetchImpl });
  activeChecker.start();
  app.on("will-quit", () => activeChecker?.stop());
  return activeChecker;
}

export function activeUpdateChecker(): UpdateChecker | null {
  return activeChecker;
}

/** Opens an external URL only when it is on the github.com allowlist. */
export async function openExternalAllowed(url: string): Promise<void> {
  if (!isAllowedExternalUrl(url)) throw new Error("Refused to open a URL outside the github.com allowlist");
  await shell.openExternal(url);
}
