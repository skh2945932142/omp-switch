# OMP Switch

[中文文档](README.md) · [Install and downloads](docs/install.md) · [Architecture](CLAUDE.md)

A desktop companion for safely managing [Oh My Pi](https://github.com/can1357/oh-my-pi) (OMP)
model-provider configuration.

It edits **files you own and it does not**: `~/.omp/agent/models.yml` and `config.yml`. Everything
about the architecture follows from that — hash-guarded writes, preserved YAML comments and unknown
fields, a snapshot before every commit, and read-only mode for unknown OMP schema versions.

> `v0.2.0` is released — see [Releases](https://github.com/skh2945932142/omp-switch/releases). The
> binaries are **not code-signed**, so SmartScreen will warn; verify `SHA256SUMS.txt` and the
> build-provenance attestation. A clean-Windows install/upgrade/uninstall regression is still pending.

![OMP Switch provider workspace](docs/images/provider-workspace.png)

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
winget install skh2945932142.OMPSwitch     # or scoop / choco, see docs/install.md
```

```bash
docker build -t omp-switch-cli . && \
docker run --rm -v "$HOME/.omp:/home/node/.omp" omp-switch-cli validate --profile default
```

Every method, including checksum and provenance verification, is in
**[docs/install.md](docs/install.md)**.

## Implemented

- OMP `16.x` / `17.x` writable; unknown future majors read-only.
- Default and named profiles, `models.yml` / `config.yml`, legacy `models.json` migration guard, and
  OMP's own path overrides (`PI_CONFIG_DIR`, `OMP_PROFILE`, `PI_PROFILE`, `PI_CODING_AGENT_DIR`).
- Provider / model / roles / `modelProviderOrder` / `enabledModels` / `disabledProviders` / thinking
  settings.
- YAML AST patching, external-edit protection, atomic writes, snapshots and guarded restore.
- 54 versioned presets; OpenAI, Ollama, llama.cpp, LM Studio, proxy and LiteLLM discovery.
- Prompts, skills and session indexing with on-demand raw reads.
- Loopback gateway: `/healthz`, `/v1/models`, chat, responses, pre-stream failover, mandatory bearer
  token, `Host` validation and cross-origin refusal.
- Windows DPAPI secret bridge, OMP OAuth status/login entry points, stable JSON CLI.

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
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution workflow

## License

[MIT License](LICENSE)
