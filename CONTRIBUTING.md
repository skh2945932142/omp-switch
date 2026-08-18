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

Windows packaging also requires .NET SDK 10.0 because the secret bridge is a self-contained console executable.

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
