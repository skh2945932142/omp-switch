# Security

This document describes what OMP Switch protects, what it deliberately does not, and where the
trust boundaries are. For reporting a vulnerability see [SECURITY.md](../SECURITY.md).

## Threat model

OMP Switch runs as an unprivileged desktop app on a single-user Windows machine and edits
configuration owned by the user. The assets worth protecting, in order:

1. **API keys.** Paid credentials that a local process, a malicious web page, or a synced file could
   otherwise exfiltrate.
2. **Oh My Pi configuration.** A user-owned file the app does not own and must never corrupt or
   silently overwrite.
3. **Session content.** Transcripts that may contain source code and secrets.

Out of scope: a compromised Windows account (DPAPI is scoped to it by design), physical access, and
malicious Oh My Pi builds.

## Credentials

API keys never enter Oh My Pi configuration. They are encrypted with Electron `safeStorage` — the
Windows user's DPAPI key — into `secrets.v1.json` under the app's `userData`. The configuration
receives only a command reference:

```yaml
apiKey: '!"…\omp-switch-secret.exe" --secret-get "credential-id" --data-dir "…"'
```

Consequences worth stating plainly:

- A key is readable only by the **same Windows account on the same machine**. Copying `userData` to
  another machine or account yields ciphertext nobody can open. This is intended, and it is why the
  installers are per-user.
- `native/secret-bridge` re-implements the decryption independently so Oh My Pi can resolve keys with
  the GUI closed. It writes the secret to stdout and nothing else, errors to stderr, and never logs
  the value.
- Oh My Pi runs that command with a **hard 10 second timeout and silently omits the key on failure**.
  The bridge is published as Native AOT for that reason (measured 29 ms median cold start).
- **The rule is enforced in `packages/core`, not in the UI.** `ConfigPatch.provider.apiKey` is a free
  string, so the JSON CLI could otherwise write a plaintext key. `validation.ts` reports a
  `provider.apiKey-plaintext` warning for any value that is neither a `!command` reference nor an
  environment variable name. That check also catches plaintext keys a user wrote by hand.

## Config integrity

- **Hash-guarded writes.** `loadProfile` records a sha256 of each file; `commitPatch` re-hashes before
  writing and raises `ConfigConflictError` if anything changed. External edits are never overwritten
  silently.
- **Atomic writes.** Temp file, `fsync`, rename.
- **Snapshot before every commit**, pruned to 30 per profile so the directory cannot grow unbounded.
- **Restore is guarded too.** `restoreSnapshot` accepts a file only if it still matches the snapshot
  or the commit that snapshot guarded, so a restore cannot discard someone else's edit. `force`
  overrides explicitly.
- **YAML anchors.** Deleting an anchored node or rewriting an alias is refused (`YamlAnchorError`)
  because it would leave dangling aliases and an unparseable file. Editing an anchored node in place
  is allowed and preserves the anchor.
- **Version gating.** Only Oh My Pi schema majors 16, 17, and 18 are writable; anything else opens
  read-only rather than being migrated on a guess.

## Renderer security & Desktop sandbox

- **Content Security Policy (CSP).** The main process injects strict CSP headers on all renderer loads.
  In production builds (`connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`),
  network requests from the renderer are completely disabled since all IPC flows through `contextIsolation`.
  Development mode safely isolates Vite's local HMR WebSocket while keeping strict origin boundaries.
- **Single-instance locking.** `app.requestSingleInstanceLock()` prevents concurrent GUI instances from
  corrupting shared SQLite metadata handles or conflicting on the loopback gateway port.
- **Renderer navigation lockdown.** `will-navigate` and `setWindowOpenHandler` strictly block unexpected
  renderer navigation and child windows.

## Loopback gateway

The gateway relays paid credentials, so **binding to `127.0.0.1` is not treated as access control**.
It mirrors Oh My Pi's own auth-gateway posture:

- A **bearer token is mandatory**. `GatewayServer.start()` refuses to bind without one unless
  `allowAnonymous` is passed deliberately. The token is generated into
  `userData/gateway/gateway.token` with mode `0600` in a `0700` directory, and compared with
  `crypto.timingSafeEqual`.
- A **non-loopback `Host` header is rejected with 421.** A browser can reach `127.0.0.1`, so this is
  what defeats DNS rebinding.
- Any request carrying an **`Origin` header is rejected with 403**, and no `Access-Control-Allow-*`
  header is ever emitted, so a web page cannot spend the user's credits.
- `/healthz` is intentionally unauthenticated and exposes no pool identifiers.
- Only an allowlist of response headers is relayed. `set-cookie` would hand an upstream session to
  the local caller; `transfer-encoding`/`content-length` would corrupt Node's framing.
- Upstream requests time out after 255 s and failover happens **before** any bytes are relayed, and
  only on retryable statuses — a rejected credential (401/403) must not cascade to the next upstream.
- Credentials resolve lazily per request through an injected callback and are never held in the pool.

## Input validation

- Every identifier that reaches disk, a URL, or a spawned process is checked against an anchored regex
  before use: profile names, credential ids, gateway pool/upstream ids, surface names, snapshot ids.
- `restoreSnapshot` verifies that target paths are strictly contained within the profile's agent directory
  and retrieves snapshot records from the trusted `MetadataStore` rather than untrusted renderer objects.
- Surface and project overlay upward searches are bounded by the user's `homeDir` to prevent root escape.
- Model discovery (`discoverModels`) enforces http/https schemes on `baseUrl`.
- Secret vault creation (`secret:put`) validates input types and enforces string length limits.
- The JSON CLI (`--json get`) masks plaintext API keys by default to prevent accidental disclosure.

## Sessions and exports

Session JSONL files are only **indexed** (`filePath` + `offset` + `length`). Raw content is read on
demand and never copied into the metadata store or into a default export, so a shared export does not
carry transcripts.

## Supply chain

- Runtime dependencies are focused: `react`, `react-dom`, `@radix-ui/*`, `motion`, `cmdk`, `sonner`, `i18next`, `react-i18next`, `lucide-react`, `yaml`, `zod`.
- The headless CLI bundle inlines its dependencies and has **zero** runtime dependencies.
- CI and release workflows pin every GitHub Action to a commit SHA.
- Releases carry GitHub build-provenance attestations and a `SHA256SUMS.txt`; verify both before
  installing (see [docs/install.md](install.md)).
- Package-manager manifests are rendered from real release hashes by `scripts/render-packaging.ps1`;
  the committed templates carry placeholders so the repository never claims a hash it cannot back.

## Known gaps

Stated rather than hidden:

- **No code signing.** Installers are unsigned, so SmartScreen will warn. Provenance attestations are
  the current substitute.
- **No active gateway health probing or circuit breaker.** Latency and failure counts are recorded
  passively from real traffic only.
- **The GUI trusts the local machine.** Any process running as the same user can read `userData` and
  invoke the secret bridge — that is the same trust level Oh My Pi itself operates at.
- **`omp update` runs an external updater.** The app snapshots configuration first, but the update
  itself is Oh My Pi's code, not ours.
