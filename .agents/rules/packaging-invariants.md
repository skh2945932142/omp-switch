# Windows Packaging & PowerShell Invariants

- **Zero-Dependency SHA256**: Always compute file hashes using .NET [System.Security.Cryptography.SHA256]::Create() rather than shell cmdlets to ensure compatibility across all PowerShell versions.
- **PowerShell Script & String Safety**: Never pass raw double-quoted strings containing `$()` inside inline PowerShell commands (as pwsh interpolates subexpressions and breaks syntax). Always write multi-line text via `.cjs` scratch scripts or `.NET [System.IO.File]::WriteAllText()`.
- **GitHub Release Safe Invocation**: Always write multi-line Markdown release notes to a dedicated file (`docs/releases/vX.Y.Z.md`) and pass `--notes-file <path>` to `gh release create`.
- **Release Version Triad Invariant**: Bumping a release version requires 1:1 synchronization across `package.json`, `CHANGELOG.md`, `docs/releases/vX.Y.Z.md`, `origin/main` branch, and the git tag `vX.Y.Z`.
