# Contributing to OMP Switch

Thanks for helping improve OMP Switch.

## Before You Start

- Search existing issues before opening a new one.
- Do not include API keys, OAuth tokens, complete personal configuration files, session content, or user-data directories in issues or pull requests.
- Keep changes focused. Provider configuration files remain authoritative OMP data, so avoid broad rewrites or unrelated formatting changes.

## Development Setup

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Windows packaging also requires .NET SDK 10.0 and the Visual Studio "Desktop development with C++" workload, because the secret bridge is published as a Native AOT console executable. Cold start matters there: OMP resolves an `!command` API key reference with a hard 10-second timeout and silently omits the key when the command is slower, so do not trade bridge startup time away.

## Pull Requests

1. Create a focused branch from `main`.
2. Add or update focused tests for behavior changes.
3. Run `pnpm typecheck`, `pnpm test`, and `pnpm build`.
4. Explain user-visible behavior, configuration compatibility, and validation performed.
5. Do not commit `dist/`, `out/`, `node_modules/`, app data, snapshots, or generated secret-bridge binaries.

## Configuration Compatibility

- Preserve unknown YAML fields and comments whenever possible.
- Treat unknown OMP schema versions as read-only until support is explicitly added.
- Require user confirmation for legacy `models.json` migration.
- Never silently overwrite a file that changed after it was loaded.

## Reporting Bugs

Use the issue templates and include redacted steps, expected behavior, actual behavior, OMP version, and OMP Switch version. For security-sensitive reports, follow [SECURITY.md](SECURITY.md) instead.

## Maintenance workflows

- **OMP schema watch**: `.github/workflows/omp-schema-watch.yml` runs weekly and opens an issue
  when upstream OMP ships an unsupported major. The manual half (validation + catalog + tests) is
  documented in [docs/omp-schema-tracking.md](docs/omp-schema-tracking.md).
- **Package-manager submissions**: `pnpm render:packaging` (node, cross-platform) renders the
  winget/Chocolatey/Scoop manifests from a built release; `scripts/publish-winget.mjs` and
  `scripts/publish-choco.mjs` validate and stage the submission commands. The actual pushes stay
  human-gated (upstream review + API keys).
- **Windows install regression**: `.github/workflows/windows-install-regression.yml` (nightly,
  tags, dispatch) installs the previous release, upgrades over it, exercises the installed CLI,
  and asserts a clean silent uninstall.
