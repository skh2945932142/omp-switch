# OMP Switch

[中文文档](README.md)

A Windows-first desktop companion for safely managing [Oh My Pi](https://github.com/can1357/oh-my-pi) model-provider configuration.

> This repository is a `0.1.0` development snapshot. There is no supported public download yet, and no `v0.1.0` release will be published. The first supported release is planned for `v0.2.0`.

![OMP Switch provider workspace](docs/images/provider-workspace.png)

## What It Does Today

- Reads default and named OMP profiles.
- Manages provider definitions in `models.yml` / `models.yaml` and detects legacy `models.json`.
- Writes `modelRoles` separately to the matching `config.yml`.
- Uses YAML AST patches to preserve unknown fields, ordering, and comments where possible.
- Detects external changes, writes atomically, and creates local snapshots before every save.
- Discovers models through OpenAI-compatible `GET /models` endpoints and includes common provider presets.
- Stores API keys in Windows user-scoped secure storage and writes OMP command-resolved secret references.
- Exposes OMP CLI status and login controls for OpenAI Codex and Anthropic OAuth.

## Explicit Boundaries

- It does not read or modify OMP `agent.db`, OAuth refresh tokens, or account-rotation state.
- It does not automatically edit project-level `.omp` overrides.
- It does not upload API keys, snapshots, diagnostics, or default exports.
- It does not currently provide a local proxy, failover, cost analytics, or tray switching.

## Run From Source

### Requirements

- Windows 10/11
- Node.js 24+
- pnpm 11+
- .NET SDK 10.0 for the Windows console secret bridge

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

## Verify and Package

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm package:win
```

`pnpm package:win` creates an NSIS installer and a portable executable in `dist/`. Those files are local build outputs and are never committed to Git.

## Credential Safety

API keys are protected by Electron `safeStorage`, which uses user-scoped DPAPI on Windows. OMP Switch stores ciphertext only in its own app-data directory and writes an OMP command reference such as:

```yaml
apiKey: '!"...\\omp-switch-secret.exe" --secret-get "credential-id" --data-dir "..."'
```

The bundled `omp-switch-secret.exe` is a Windows console executable. It writes only the secret to stdout on success, writes errors only to stderr, returns a non-zero exit code on failure, and does not log secret values. It remains available after the GUI exits.

Never commit API keys, OAuth tokens, full session content, personal paths, or real configuration files in issues, screenshots, or logs.

## Profiles and Recovery

OMP Switch manages these user-level locations:

- Default profile: `~/.omp/agent/`
- Named profile: `~/.omp/profiles/<name>/agent/`

A local snapshot is created before every write. If a file changes after it was loaded, OMP Switch stops and requires a reload rather than overwriting external edits.

## v0.2 Direction

- OMP-catalog-first model discovery, audited presets, and broader discovery adapters.
- A stable JSON CLI, redacted/encrypted exports, diagnostics, and stricter migrations.
- An optional loopback gateway with health checks, API-key failover, and local usage summaries.
- GitHub Release checksums, build provenance, and signed update checks.

These items are not supported features until they are implemented and verified.

## Contributing and Security

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance. Report vulnerabilities privately through [SECURITY.md](SECURITY.md); do not post credentials or complete configuration files in public issues.

## License

Licensed under the [MIT License](LICENSE).
