# OMP Switch

[中文文档](README.md) · [Install and downloads](docs/install.md) · [Architecture](CLAUDE.md)

A desktop companion for safely managing [Oh My Pi](https://github.com/can1357/oh-my-pi) (OMP)
model-provider configuration.

It edits **files you own and it does not**: `~/.omp/agent/models.yml` and `config.yml`. Everything
about the architecture follows from that — hash-guarded writes, preserved YAML comments and unknown
fields, a snapshot before every commit, and read-only mode for unknown OMP schema versions.

> `v0.5.8` is released — see [Releases](https://github.com/skh2945932142/omp-switch/releases). The
> binaries are **not code-signed**, so SmartScreen will warn; verify `SHA256SUMS.txt` and the
> build-provenance attestation. A clean-Windows install/upgrade/uninstall regression is still pending.

![OMP Switch provider workspace](docs/images/provider-workspace.png)

![Roles page, dark theme](docs/images/roles-dark.png)

## Two artifacts

| Artifact | Windows | Linux / macOS | Contains |
| --- | --- | --- | --- |
| **Desktop app** (GUI, credential vault, gateway, prompts/skills/sessions) | Supported | **Not yet** | Everything |
| **Headless CLI** (`omp-switch-cli`) | Supported | Supported | Config read/write, validation, snapshots |

The desktop app is Windows-only for an **architectural** reason, not a packaging gap: API keys are
sealed with Electron `safeStorage` (the Windows user's DPAPI key) and OMP resolves them with the GUI
closed by running `native/secret-bridge`, a `net10.0-windows` binary calling `crypt32.dll`. A Linux
port means designing a different credential backend; the blockers are enumerated in
[docs/install.md](docs/install.md#linux-support).

The headless CLI has no Electron dependency (`packages/core` is pure Node), so it runs anywhere Node
24 does. It cannot open the credential vault — only the machine that sealed a key can.

## Install

```powershell
scoop bucket add omp-switch https://github.com/skh2945932142/omp-switch
scoop install omp-switch
```

Or download the installer / portable build from
[Releases](https://github.com/skh2945932142/omp-switch/releases/latest). The winget and Chocolatey
manifests are prepared but **not yet submitted** — see [docs/install.md](docs/install.md).

```bash
docker run --rm -v "$HOME/.omp:/home/node/.omp" \
  ghcr.io/skh2945932142/omp-switch-cli:0.5.4 validate --profile default
```

> The image is pushed to GHCR, but GitHub creates container packages as private and visibility is a
> repository setting. If the pull reports `unauthorized`, see
> [docs/install.md](docs/install.md#docker) — a local `docker build` always works.

Every method, including checksum and provenance verification, is in
**[docs/install.md](docs/install.md)**.

## Implemented

**Configuration editing**

- OMP `16.x` / `17.x` / `18.x` writable; unknown future majors read-only.
- Default and named profiles, `models.yml` / `config.yml`, legacy `models.json` migration guard, and
  OMP's own path overrides (`PI_CONFIG_DIR`, `OMP_PROFILE`, `PI_PROFILE`, `PI_CODING_AGENT_DIR`).
- Provider / model / `modelProviderOrder` / `enabledModels` / `disabledProviders` / thinking
  settings.
- YAML AST patching, external-edit protection, atomic writes, snapshots and guarded restore.
- 54 versioned presets; OpenAI, Ollama, llama.cpp, LM Studio, proxy and LiteLLM discovery.

**Model roles**

- A dedicated Roles page: each role shows a one-line gloss, its resolved selector chain
  (`@default → provider/model`), capability chips, and in-place warnings for `@role` cycles,
  unparseable selectors, and `:off`/`:auto` misuse. Custom roles from `config.yml` are listed and
  editable instead of invisible.
- A searchable model picker: provider-grouped results with instant filtering, pinned
  `@default`/`*`/clear values, a segmented thinking-level control (only the six levels OMP accepts
  as a role suffix), full keyboard navigation — shared with gateway upstream rows.
- Quick-assign from any model row: one click assigns a provider/model to a role, preserving that
  role's thinking suffix.

**Other modules**

- Prompts, skills, and session indexing with on-demand raw reads; a usage dashboard (spend,
  requests, tokens, per-day trend, per-model/per-provider breakdowns, cost labelled by provenance).
- Loopback gateway: `/healthz`, `/v1/models`, chat, responses, pre-stream failover, mandatory bearer
  token, `Host` validation and cross-origin refusal.
- Windows DPAPI secret bridge, OMP OAuth status/login entry points, stable JSON CLI.

**Interface**

- A "Quiet Instrument" visual language: untinted zinc neutrals, teal reserved as a signal color for
  selection and focus, ink/paper inversion for primary actions, status as a dot plus quiet text;
  selected rows use a soft fill rather than a 3px rail, and eyebrows are sentence case.
- A manual light / dark / system theme switch (persisted, mirrored by the native title-bar
  buttons), plus a 中文 / English / System language switch (persisted; first paint already
  matches the stored locale, no Chinese flash); plus a Mica window material on Windows 11
  22H2+ (everything else falls back to solid surfaces automatically).
- A custom title bar: the web topbar is the drag region with native overlay window buttons (Snap
  Layouts kept), and Mica reaches the top edge.
- Provider cards: clicking the header only expands/collapses the model list (animated); an edit
  pencil appears on hover. The detail/editor drawer springs in as a floating sheet instead of
  squeezing the workspace.
- Context-scoped saves (roles and settings commit independently) with pending-change dots and
  `Ctrl+S`; switching profiles confirms before discarding unsaved edits.
- **Preview-before-write**: every commit shows a line-level diff of what `models.yml` /
  `config.yml` will receive before anything touches disk; a snapshot timeline browses and restores
  history; external-edit conflicts surface as a dialog with one-click reload.
- **Command palette** (`Ctrl+K`) over sections, profiles, providers, and actions; `Ctrl+1…7`
  section switching; `?` for the shortcut reference.
- Provider cards and the role picker flag `enabledModels` coverage, warning when a picked model
  would be filtered out of OMP's catalog.

## Security boundaries

- Never reads or modifies OMP's `agent.db`, OAuth refresh tokens, or account-rotation state.
- Never writes project-local `.omp` overrides automatically (read-only overlays).
- Never uploads keys, snapshots, diagnostics, or exports anywhere.
- No cloud sync, no automatic account rotation, no downloading unknown binaries.
- API keys never enter OMP configuration; only a command reference does. That rule is enforced in
  `packages/core`, so the CLI path is bound by it too.

See [SECURITY.md](SECURITY.md) and [docs/security.md](docs/security.md).

## Running from source

Requires Windows 10/11, Node.js 24+, pnpm 11+, .NET SDK 10.0, and the Visual Studio "Desktop
development with C++" workload (the secret bridge publishes as Native AOT and links with MSVC).

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Building only the cross-platform CLI needs neither .NET nor MSVC:

```bash
pnpm install --frozen-lockfile
pnpm build:cli
node packages/cli/dist/main.js --help
```

## Verifying and packaging

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm package:win        # -> dist/ NSIS installer + portable ZIP
pnpm verify:package-cli # runs the packaged JSON CLI in a temp HOME
pnpm render:packaging   # renders winget / Scoop / Chocolatey manifests from real release hashes
```

Build output is local and never committed.

## Profiles and recovery

- Default profile: `~/.omp/agent/`
- Named profiles: `~/.omp/profiles/<name>/agent/`

A local snapshot is created before every write. If another tool or a manual edit changed a file after
it was loaded, the app stops and asks for a reload instead of overwriting it.

## Developer documentation

- [CLAUDE.md](CLAUDE.md) — architecture, write-path contract, per-module invariants
- [docs/install.md](docs/install.md) — every install method and the platform limits
- [docs/security.md](docs/security.md) — threat model and credential handling
- [docs/releasing.md](docs/releasing.md) — release process
- [CHANGELOG.md](CHANGELOG.md) — version history
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution workflow

## License

[MIT License](LICENSE)
