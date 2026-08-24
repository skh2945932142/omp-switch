# Windows Packaging & PowerShell Invariants

- **Zero-Dependency SHA256**: Always compute file hashes using .NET [System.Security.Cryptography.SHA256]::Create() rather than shell cmdlets to ensure compatibility across all PowerShell versions.
- **Native JSON Serialization**: Use ConvertTo-Json / ConvertFrom-Json for manifest modifications. Avoid executing inline 
ode -e scripts with interpolated arguments in PowerShell.
- **GitHub Release Safe Invocation**: Always write multi-line Markdown release notes to a temporary file and pass --notes-file <path> to gh release create.
