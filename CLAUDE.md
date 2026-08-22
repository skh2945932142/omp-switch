# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

OMP Switch is a Windows-first Electron desktop app that manages [Oh My Pi](https://github.com/can1357/oh-my-pi) (OMP) model-provider configuration. It edits **user-owned files it does not own**: `~/.omp/agent/models.yml` and `config.yml`. Everything about the architecture follows from that: hash-guarded writes, YAML comment preservation, snapshots before every commit, and read-only mode for unknown OMP schema versions.

## Commands

Requires Windows, Node 24+, pnpm 11 (`corepack enable`), **.NET SDK 10.0**, and the Visual Studio **"Desktop development with C++"** workload — `native/secret-bridge` publishes as Native AOT, which links with MSVC. `scripts/build-secret-bridge.ps1` prepends the fixed `vswhere.exe` location to PATH because the ILCompiler shells out to it and Visual Studio does not put it on PATH; without that a machine with the C++ workload still fails to link with a confusing `MSB3073`.

```powershell
pnpm install --frozen-lockfile
pnpm dev                 # predev runs build:native first, so dotnet is required even for dev
pnpm typecheck           # tsc --noEmit over electron/, src/, packages/
pnpm test                # vitest run
pnpm test:watch
pnpm build               # build:native + electron-vite build -> out/
pnpm package:win         # -> dist/ NSIS installer + portable ZIP
pnpm verify:package-cli  # runs the packaged JSON CLI in a temp HOME; needs dist/ from package:win
pnpm build:native        # build:secret-bridge + build:cli-proxy (dotnet publish)
```

Single test file / single case:

```powershell
pnpm vitest run packages/core/src/gateway.test.ts
pnpm vitest run packages/core/src/gateway.test.ts -t "fails over"
```

CI (`.github/workflows/ci.yml`) runs typecheck → test → build on `windows-latest`, then **fails if the build left any tracked or unignored file**. New build artifacts must be added to `.gitignore`.

### Running against a throwaway HOME

The adapter takes its profile root from `os.homedir()` with no override, so `pnpm dev`, `--json`, and `--gateway` all read and write the **developer's real `~/.omp/agent/models.yml`**. Before exercising a write path manually, redirect both the profile root and the app data dir — this is exactly what `scripts/verify-packaged-cli.ps1` does:

```powershell
$env:USERPROFILE = "D:\tmp\omp-home"; $env:HOME = $env:USERPROFILE  # moves ~/.omp (os.homedir())
$env:OMP_SWITCH_DATA_DIR = "D:\tmp\omp-data"                        # moves userData: vault, snapshots, metadata
```

`OMP_SWITCH_DATA_DIR` is honored by `electron/main.ts` (`app.setPath("userData", …)`) *and* independently by the C# secret bridge, which otherwise defaults to `%APPDATA%\omp-switch` — keep the two in agreement or key lookups break. Other env inputs: `ELECTRON_RENDERER_URL` (set by electron-vite in dev; absent means load the built `index.html`) and `OMP_AUTH_GATEWAY_URL` (gateway upstreams of kind `omp-auth-gateway`, default `http://127.0.0.1:4000`).

## Architecture

Three layers with a strict dependency direction: `packages/core` → `electron/` → `src/renderer`.

**`packages/core/src` — all domain logic, zero Electron imports.** Pure Node + TypeScript so it is directly unit-testable. Imported everywhere as `@omp-switch/core`, an alias (not a built package) declared in three places that must stay in sync: `tsconfig.json` paths, `electron.vite.config.ts` (main + renderer), and `vitest.config.ts`. New modules must be re-exported from `packages/core/src/index.ts`.

**`electron/` — main process.** Owns the OS: `ipcMain.handle` surface in `main.ts`, `safeStorage` credential vault (`secret-store.ts`), and `metadata-store.ts`. Holds no domain logic of its own. `createWindow` enables the Mica material on Windows 11 22H2+ (`backgroundMaterial: "mica"`, mutually exclusive with an opaque `backgroundColor`) and injects the `mica` class on `<html>` via `executeJavaScript` after load; `tokens.css` makes only the chrome transparent under that class, panels stay opaque, and every other environment falls back to solid surfaces. On Windows 10+ it also hides the OS title bar (`titleBarStyle: "hidden"` + `titleBarOverlay`) so the web topbar is the drag region — `.topbar` carries `-webkit-app-region: drag` with buttons opted back out, `.topbar-actions` reserves right padding for the overlay buttons, and a `nativeTheme.on("updated")` listener re-tints the overlay glyphs. `app:set-theme` forwards the renderer's manual theme choice into `nativeTheme.themeSource` so those glyphs follow it.

**`src/renderer` — React 19 UI**, sandboxed with `contextIsolation`. It reaches the filesystem only through `window.ompSwitch`. `App.tsx` falls back to `createMockApi()` when that global is absent, so the UI can be previewed in a plain browser (`pnpm preview:renderer`; the config mirrors the electron-vite alias) — meaning **every new IPC method needs five coordinated edits**: core function → `ipcMain.handle` in `electron/main.ts` → method in `electron/preload.ts` → signature in `src/renderer/global.d.ts` (`OmpSwitchApi`) → stub in `createMockApi()`. The renderer is otherwise split by feature: `App.tsx` (shell, profile state, two-step save orchestration with dirty tracking, global shortcuts), `theme.ts` (light/dark/system controller — sets `color-scheme` on `:root`, which is what resolves every `light-dark()` token in `tokens.css`; no `[data-theme]` selector duplication), `locale.ts` + `locale-detect.ts` + `i18n/` (i18next, statically inlined zh/en; `lng` is resolved from `omp.locale` / `navigator` before React mounts so the first paint is not always Chinese), `roles-module.tsx` (role sheet), `workbench-modules.tsx` (surfaces/sessions/gateway), `usage-module.tsx`, and shared `components/` (`model-picker.tsx` — the searchable selector used by roles *and* gateway upstreams, `quick-assign.tsx`, `save-flow.tsx` — diff preview/conflict/confirm dialogs and the LCS diff, `command-palette.tsx` — cmdk `Ctrl+K`, `snapshot-timeline.tsx`, `theme-switch.tsx`, `locale-switch.tsx`, `ui-primitives.tsx` — Radix Select/Tooltip wrappers). Every save goes through `requestSave`: preview via `omp:preview`, then the diff dialog, then commit; `Ctrl+K`, `Ctrl+1…7`, `?`, and `Ctrl+S` are bound in the App keydown effect. `window.confirm` is banned — use `ConfirmDialog`. Styles live in `styles/{tokens,base,components,modules}.css` imported in that order; **every color resolves through a token in `tokens.css` — a hex value anywhere else is a bug**.

**Interaction model of the provider cards** (the class of bug this wording prevents): the card header's only job is expand/collapse — a `.provider-card-toggle` button animating `.model-list-wrap` between `grid-template-rows: 0fr/1fr`; the drawer-opening edit pencil is a *sibling* button, not the same click target. Do not merge expand/collapse and select/open-drawer back into one onClick; that was a real bug (collapsing opened the drawer). Model rows are display-only. The detail/editor drawer is a floating sheet (`position: fixed`, motion spring) overlaying the workspace — it must never return to being a grid column that squeezes content on open.

The emitted bundles are `out/main/main.js` and `out/preload/preload.cjs`, despite the `fileName` values in `electron.vite.config.ts` (`"index"` / `"index.cjs"`) — those do not end up naming the output. Two places hardcode the real names: `package.json`'s `main` field and the `path.join(currentDir, "../preload/preload.cjs")` in `createWindow`. Renaming an entry means updating both.

### The config write path (load → plan → commit)

`OmpFilesystemAdapter` in `packages/core/src/adapter.ts` is the only sanctioned way to change OMP config. Do not add write paths around it.

1. `loadProfile` resolves the first existing candidate (`models.yml` → `.yaml` → legacy `.json`; `config.yml` → `.yaml`), keeps the **raw text plus its sha256**, and collects diagnostics.
2. `planPatch` is pure and synchronous: clone, apply a `ConfigPatch`, re-validate, return a `PatchPreview` carrying the expected hashes.
3. `commitPatch` re-hashes the files on disk and throws `ConfigConflictError` if anything changed since load (external-edit protection — never silently overwrite), then snapshots, then writes atomically via temp file + `fsync` + rename. If the settings write fails after the models write succeeded, the models file is rolled back from the snapshot. After a successful write it records `committedModelsHash`/`committedSettingsHash` on the snapshot.

`ConfigPatch` is the whole write vocabulary: `provider`, `removeProviderId`, `roleAssignments`, `settings` (`modelProviderOrder`, `enabledModels`, `disabledProviders`, `defaultThinkingLevel`), `confirmLegacyMigration`. In `planPatch`, `undefined` means "leave alone" and `null` means "delete the key" (see `applyOptionalField`). A new writable settings key must be added in four places: `SettingsDocument`, the `ConfigPatch.settings` `Pick`, the key list in `patchSettingsYaml`, and the renderer form — miss the third and the value is validated but never written.

`restoreSnapshot` applies the same never-silently-overwrite rule in reverse. It accepts a file whose current hash matches **either** the pre-write hash or the `committed*Hash` the guarded commit wrote — that pair is what distinguishes "only this app wrote here" from an external edit, and without it undoing your own commit would look like a conflict. Pass `{ force: true }` to override; a snapshot predating the hash fields cannot be verified and is restored as-is.

`previewPatch` runs the same plan→YAML pipeline with **no filesystem effects** and returns the exact text both files would receive (verified byte-identical to what `commitPatch` writes, and refusing the same invalid patches). The GUI's save is two-step: it renders that preview as a diff dialog and `commitPatch` re-guards on confirmation, so an edit landing between preview and confirm still fails safely. Two read-only IPC channels expose it (`omp:preview`) and the snapshot history (`omp:list-snapshots`; `MetadataStore.listSnapshots` already existed).

> `ConfigPatch.provider.apiKey` is a free string, so the "keys never enter OMP config" rule is enforced by `validation.ts` (`provider.apiKey-plaintext`), not by the UI. The renderer happens to always vault the key first, but `--json apply --patch` does not go through the renderer. A command reference into `node_modules` or with a relative `"."` app argument also warns (`provider.apiKey-fragile-command`): it only resolves inside the dev checkout that wrote it, and OMP silently drops the key — and the provider — when spawned from any other directory.

### YAML is patched as an AST, never re-serialized

`patchModelsYaml` / `patchSettingsYaml` in `yaml-config.ts` deep-diff the before/after plain objects and mutate only the changed nodes of the parsed `yaml` `Document`. This is what preserves user comments, key order, and OMP fields this app knows nothing about. Whole-document `stringify` is the fallback only when the file is empty or unparseable. Any new writable field must be threaded through the diff, not bolted on with a rewrite.

**Anchors and aliases.** `planPatch` deep-clones through JSON, which flattens the shared references `&anchor`/`*alias` create, so the diff alone cannot be trusted around them. The rule the writer enforces:

- Editing an anchored node **in place is allowed and correct** — `&common` survives and `*common` keeps meaning "follows that node", which is what the user wrote. Expanding it instead would silently duplicate config.
- **Deleting** an anchored node, or **replacing** an alias node, throws `YamlAnchorError`. The first leaves every `*alias` dangling and makes the file unparseable; the second discards the sharing on purpose. Refusing beats corrupting a file this app does not own.
- `loadStructuredConfig` adds a `yaml.anchors` warning up front so the refusal is not a surprise at save time.

Because the preview is built from the flattened clone, an in-place edit to an anchored node also changes every aliasing node in the *written file* while the preview shows them unchanged. That divergence is expected; the file is the authority.

### Version gating and validation

`schema.ts` holds `WRITABLE_OMP_SCHEMA_MAJORS = {16, 17}`. `classifyOmpInstallation` marks anything else — or an unparseable version — unsupported, which surfaces as read-only UI and makes `commitPatch` throw. A missing `omp` executable is still writable (file-only mode).

`validation.ts` *returns* `Diagnostic[]`; it never throws. Only `severity: "error"` blocks a commit; warnings and info flow to the UI. Adding an OMP schema field means touching four places: the type in `domain.ts`, the check in `validation.ts`, the writer in `adapter.ts` (`planPatch`/`applyOptionalField`), and the renderer form.

**OMP's validation is all-or-nothing, which sets the bar for this app's.** A models.yml that fails OMP's schema does not degrade gracefully: OMP keeps its built-in catalog, exposes the failure only through `ModelRegistry.getError()`, and every custom provider disappears. Writing a file this app considers valid but OMP does not is therefore the worst outcome available, so validation mirrors OMP exactly:

- Unknown **root keys** really are errors — OMP fails the document on them.
- A provider with **no models** must still carry one of `baseUrl`/`apiKey`/`headers`/`compat`/`disableStrictTools`/`modelOverrides`/`discovery`/`remoteCompaction`, or `auth: none` (`provider.empty`).
- `api` is checked against `KNOWN_PROVIDER_APIS` as a **warning**, not an error, because extensions register further ids at runtime via `pi.registerProvider`.

### Three different thinking-level sets

OMP accepts three non-interchangeable sets, and conflating them is how you write a config OMP rejects:

| Where | Accepted | Type |
|---|---|---|
| `defaultThinkingLevel` in config.yml | `minimal low medium high xhigh max auto` (**no `off`**) | `SettingsThinkingLevel` |
| `provider/model:<level>` role suffix | `minimal low medium high xhigh max` (**no `off`, no `auto`**) | `RoleThinkingLevel` |
| OMP's `--model` CLI patterns | `off minimal low medium high xhigh max` | not written by this app |

`parseRoleSelector` strips **only** documented level names as a suffix. That is deliberate: Ollama model ids carry colons (`ollama/llama3.1:8b`), so a trailing `:something` unknown cannot be rejected — it has to stay part of the model id. A role ending in `:off`/`:auto` is therefore reported by `findMisusedRoleThinkingSuffix` as a warning rather than silently "fixed".

### Paths follow OMP's environment, not just `~/.omp`

`resolveOmpPaths` in `paths.ts` reproduces OMP's own resolution; skipping it means editing a file OMP never reads while reporting success:

- `PI_CONFIG_DIR` relocates the OMP root (absolute honored as-is, relative resolved under home — OMP documents it both ways).
- `OMP_PROFILE` beats `PI_PROFILE`, and **an explicitly empty `OMP_PROFILE` still counts as set** and selects the default profile.
- `PI_CODING_AGENT_DIR` moves the agent dir of the **default profile only**; named profiles ignore it.

Every override is echoed back as an `omp.path-override` info diagnostic so the UI can explain unexpected paths. `discoverProfileNames` also lists an active `OMP_PROFILE` that has no directory yet, or the app would edit the default profile while OMP reads the named one.

Role selectors (`provider/model:high`, `@default`, `*`) are parsed by `parseRoleSelector`, which resolves the provider prefix against known provider IDs longest-first because model IDs themselves contain slashes (`openrouter/openai/gpt-4.1`).

### Credentials: the secret-bridge contract

API keys never enter OMP config. `SecretStoreService` encrypts them with Electron `safeStorage` (user-level DPAPI) into `secrets.v1.json` under `userData`, and the config file receives only a command reference:

```yaml
apiKey: '!"...\omp-switch-secret.exe" --secret-get "credential-id" --data-dir "..."'
```

`native/secret-bridge` (C#) independently re-implements that decryption — AES-GCM with the `v10`/`v11` key unwrapped from Electron's `Local State`, falling back to raw DPAPI — so OMP can resolve keys with the GUI closed. **The vault JSON shape and the `userData` layout are a cross-language contract; changing one side requires changing the other.** The bridge is copied to `userData/secret-bridge/v<app-version>/` at first use so an app upgrade cannot invalidate references already written into config.

**OMP runs an `!command` reference with a hard 10s timeout and silently omits the key when the command is slower or fails** — the user just sees an unavailable provider, with no explanation anywhere. That makes bridge cold start a correctness constraint, which is why it publishes as Native AOT: measured here at 29 ms median / 464 ms worst, against 148 ms / 2153 ms for the previous `PublishSingleFile` + self-contained build, which unpacks itself to a temp directory on first run. Keep that budget in mind when touching the bridge or its publish settings.

### One binary, four entry modes

`app.whenReady()` in `electron/main.ts` dispatches on argv *before* opening a window: `--secret-get <id>` (prints the secret to stdout, exits), `--json <cmd>` (the versioned JSON CLI, `packages/core/src/cli.ts`), `--gateway [profile]` (headless gateway), otherwise the GUI.

`native/cli-proxy` builds `omp-switch-cli.exe`, a console shim that spawns `OMP Switch.exe --json …` and relays stdout/stderr/exit code — necessary because a GUI-subsystem Electron binary cannot write to an attached console. CLI stdout must stay **pure JSON** in the `{version: 1, ok, data | error}` envelope (exit 0 ok, 1 command failure, 2 usage error); `verify:package-cli` asserts nothing leaks to stderr.

### Loopback gateway

`gateway.ts` serves `127.0.0.1` only: `/healthz`, `/v1/models`, `/v1/chat/completions`, `/v1/responses`. A request's `model` selects a pool by `virtualModel`; upstreams are tried in order with failover **before** any bytes are relayed, and only on retryable statuses (timeout/429/5xx) — a rejected credential (401/403) must not cascade. Upstream credentials resolve lazily through the injected `resolve` callback, so keys are read per-request and never held in the pool. The gateway deliberately outlives the GUI (`window-all-closed` keeps the process alive while it runs).

**Binding to loopback is not access control** — this gateway relays paid credentials, so it copies OMP's own auth-gateway posture:

- A bearer token is **mandatory**: `start()` throws unless `options.token` is set or `allowAnonymous` is passed deliberately. `electron/main.ts` generates it once into `userData/gateway/gateway.token` (file `0600`, parent `0700`) and the GUI shows it, because callers cannot use the gateway without it.
- `/healthz` stays unauthenticated (liveness only, no pool identifiers); everything else needs the token, compared with `crypto.timingSafeEqual`.
- A non-loopback `Host` header is rejected with **421**, which is what stops DNS rebinding — a browser can reach `127.0.0.1`, so the port alone protects nothing.
- Any request carrying an `Origin` header is rejected with **403** and no `Access-Control-Allow-*` is ever emitted, so a web page cannot spend the user's credits.
- Only `RELAYED_RESPONSE_HEADERS` are copied back: `transfer-encoding`/`content-length` would fight Node's framing, and `set-cookie` would hand an upstream session to whatever local process called in.
- Upstream requests abort after `DEFAULT_GATEWAY_UPSTREAM_TIMEOUT_MS` (255 s, matching OMP's idle allowance for long thinking budgets).

Per-attempt latency, last status and consecutive-failure counts are recorded in `GatewayServer.getStats()` and returned by `gateway:status`. This is passive observation only — there is no active health probe or circuit breaker yet.


### Usage accounting reads what OMP actually writes

The session indexer once looked for `usage`, `cost`, `model` and `provider` at the top level of a
session JSONL line. None of those live there. Verified against real files, an assistant turn looks
like this, and everything interesting is on `message`:

```jsonc
{ "type": "message", "id": "…", "timestamp": "…", "parentId": "…",
  "message": { "role": "assistant", "provider": "…", "model": "…", "api": "…",
    "stopReason": "toolUse" | "stop" | "error" | "aborted",
    "usage": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0,
               "reasoningTokens": 0,
               "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } } } }
```

Consequences that shape `usage.ts`:

- **OMP already computes cost per turn**, broken down and totalled, so `recordedCost` is
  authoritative. Local pricing from `models.yml` is a cross-check, not the primary source — on a real
  machine `models.yml` frequently carries no `cost:` at all, and a dashboard that trusted only local
  pricing reported **$0.00 against $407.78 of actual spend**. `UsageBucket` therefore carries
  `recordedCost`, `computedCost` and `pricedRequests` so the UI can state which number it is showing,
  and `UsageReport.unpriced` names what could not be priced.
- Token counter names (`input`, `output`, `cacheRead`, `cacheWrite`) are **identical to the price keys
  in `models.yml`**, so usage and pricing line up key for key. Prices are per `PRICE_UNIT_TOKENS`
  (1,000,000) — confirmed arithmetically against a real turn.
- Failures come from `message.stopReason`, not `type`, which is always `"message"`.
- Only entries carrying tokens count as requests, so tool results and mode changes do not inflate
  counts. On this machine 22,683 indexed events yield 5,528 requests.

### Metadata store has two backends

`MetadataStore` prefers `node:sqlite` and silently degrades to a JSON file (`metadata.sqlite.json`) when the builtin is unavailable. Every method implements both branches — new persistence needs both, or it will vanish on machines using the fallback. `new MetadataStore(dir, { backend: "json" })` forces the fallback, which is how `metadata-store.test.ts` runs the whole suite against both; without that seam the JSON branch would never execute in CI. `close()` releases the sqlite handle, and must be called before deleting the file on Windows (the app calls it on `will-quit`).

Both branches cap snapshots at 30 rows per profile, matching `OmpFilesystemAdapter.pruneSnapshots`, which deletes the corresponding directories after each commit. Snapshot ids begin with an ISO timestamp so lexical order is chronological.

Session JSONL files are only **indexed** (`filePath` + `offset` + `length`); raw content is read on demand and stays out of metadata and exports. Surface (prompt/skill) paths are validated against root escape in `entryPath`.

### Project overlays are read-only, bounded, and explicitly rooted

`findProjectOverlay` walks upward from a chosen root but **stops before `homeDir`**. Without that boundary the walk escapes the project and finds `~/.omp` — the user-level config this app already edits — and reports it as a project overlay. OMP bounds its own ancestor walks the same way.

The root itself is a persisted user choice (`project.root` preference), not `process.cwd()`: a packaged GUI launched from the Start Menu has an arbitrary cwd. Until the user picks a directory, `ProjectContext.explicit` is false and the UI labels the root as a guess.

`describeOverlayPrecedence` reports two things that are invisible in the files themselves, so an edit would otherwise appear to save and then do nothing:

- OMP **replaces** `enabledModels` / `disabledProviders` / `modelProviderOrder` wholesale between layers instead of merging, so a project array hides every user-level entry.
- `modelRoleStorage: "project"` makes OMP write role changes into the project `.omp/config.yml`, shadowing the user-level roles this app edits.

### Credentials are reference-counted before deletion

`collectReferencedCredentialIds` parses `--secret-get "<id>"` out of `!command` values (apiKey *and* headers) across every profile. `secret:delete` reports those references and refuses unless `force` is passed; `secret:orphans` lists vault entries nothing references any more, which is what a removed provider leaves behind. Gateway pool `credentialId`s count as references too.

## Conventions

- Every identifier that reaches disk, a URL, or a spawned process is validated with an anchored regex before use — profile names, credential IDs, gateway pool/upstream IDs, surface names. Follow that pattern for anything new.
- Tests are colocated `*.test.ts` beside the source, run in vitest's `node` environment with `globals: true`. They favor real `fs.mkdtemp` directories over fs mocks, and inject `fetchImpl` / `resolve` for network and secret boundaries.
- Renderer UI strings go through i18next (`src/renderer/i18n/locales/{zh,en}.json`); Chinese is the source language (`fallbackLng: "zh"`). Code, identifiers, and diagnostics stay English. zh/en key sets and interpolation variables must stay identical (`locales.test.ts` enforces this). New chrome must not hardcode a language.
- Runtime dependencies are intentionally minimal (`react`, `react-dom`, `lucide-react`, `yaml`, `i18next`, `react-i18next`) — prefer Node builtins over a new dependency. `zod` is declared but currently unused.
- `.gitattributes` normalizes every text file to `eol=lf` in the working tree, including the PowerShell scripts. Do not reintroduce CRLF.
- Do not commit `dist/`, `out/`, app data, snapshots, or generated native binaries. Never commit API keys, OAuth tokens, full session content, or personal paths.
- The visual language is **"Quiet Instrument"**: untinted zinc neutrals; `--signal` teal marks *only* selection, focus, menu highlight, and switch state — primary buttons use the `--invert-*` ink/paper inversion, never teal; status is a colored dot plus quiet text; separation comes from tone and `--shadow-*`, borders only as hairlines inside lists. Theming is dual-track: tokens are defined once with `light-dark()`, and `theme.ts` pins `color-scheme` for a manual light/dark choice (persisted in localStorage, mirrored to `nativeTheme.themeSource`) or leaves it as `light dark` to follow the OS; mono is Cascadia Mono. Shadows are composed from `--shadow-tint*` color tokens because `light-dark()` accepts colors only — never put a shadow expression inside it.
- Checkbox inputs render as switches via CSS (`appearance: none` on `.check-line input[type="checkbox"]`) — a new boolean control should reuse `.check-line` rather than introducing another checkbox style.

## Boundaries this app must not cross

Documented product limits, not incidental gaps: never read or modify OMP's `agent.db`, OAuth refresh tokens, or account-rotation state; never write project-local `.omp` overrides automatically (they are read-only overlays via `findProjectOverlay`); never upload keys, snapshots, diagnostics, or exports anywhere; no cloud sync, no auto account rotation, no downloading unknown binaries.

## Releasing

Tag-driven and gated (`docs/releasing.md`). `.github/workflows/release.yml` rejects a `vX.Y.Z` tag that does not match `package.json` or lacks `docs/releases/vX.Y.Z.md`, then publishes a **draft** with three distribution assets (NSIS installer, portable ZIP, `SHA256SUMS.txt`) plus build-provenance attestations and, when the `OMP_UPDATE_ED25519` secret is set, two signed update-manifest assets (`latest.json` + `latest.json.sig`) uploaded to the same release. A maintainer publishes manually.

Release notes follow `docs/releases/README.md`: headings from Added / Changed / Security / Fixed / Known Limitations, and the feature-flag status of gateway, OAuth integration, session indexing, and update checking must be stated explicitly. The workflow also asserts `dist/` holds exactly one `.exe` and one `.zip` before hashing, so any extra packaging artifact breaks the release.

### Update checking

This is the first non-user-initiated outbound network request in the app (gateway/discovery/oauth are all user-clicked). It is deliberately minimal and verifiable:

- `packages/core/src/update.ts` holds the pure functions and the hardcoded Ed25519 `VERIFY_PUBLIC_KEY`. `compareVersions`/`parseUpdateManifest`/`verifyManifestSignature`/`buildUpdateStatus` are all unit-tested; none of them touches the network or Electron.
- `electron/update-checker.ts` is the `UpdateChecker` service: fetches the two fixed GitHub URLs (`releases/download/latest/latest.json` and `.sig`) with an 8s timeout, verifies the signature over the **exact bytes served**, and returns `null` (silent) on any failure. It throttles automatic checks to once per 24h (1h retry-after-failure), reads/writes preferences `update.checkEnabled` (default true) / `update.lastCheckAt` / `update.lastResult` / `update.lastFailureAt`, and is bound to the GUI lifecycle only — the `--json`/`--gateway`/`--secret` paths return before `createWindow` and never start it. Started after the window is created so a slow fetch cannot delay startup; stopped on `will-quit`.
- Four IPC channels: `update:check(force?)`, `update:status` (no network), `update:set-enabled`, and `app:open-external(url)`. The last uses `shell.openExternal` behind a `github.com`-only host allowlist (`isAllowedExternalUrl`) so the renderer cannot be coaxed into opening an arbitrary URL.
- The renderer shows a top-bar badge dot when an update is available and an "关于/About" tab in the Profile drawer with current/latest version, summary, a `[立即检查]` button (force, bypasses throttle + enabled flag), `[前往下载]` (opens the release page), and the auto-check toggle.

Zero new dependencies: Ed25519 signing/verification uses Node's built-in `crypto`; the manifest is fetched with the built-in `fetch`. The CI signs with `crypto.sign` from Node 24 and re-verifies against the app's public key before uploading, so a key mismatch fails the release rather than shipping an unverifiable manifest. Never auto-download or auto-install binaries — only notify and link to GitHub Releases.
