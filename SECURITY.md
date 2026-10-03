# Security Policy

## Supported Versions

Security fixes go into the latest release (currently `v0.8.0`). Older releases don't get patches; please upgrade first and check whether the problem is still there.

## Reporting a Vulnerability

Please use GitHub's private vulnerability-reporting flow for this repository:

<https://github.com/skh2945932142/omp-switch/security/advisories/new>

If private reporting is temporarily unavailable, open a minimal public issue requesting a secure contact channel. Do not disclose the vulnerability details there.

## Sensitive Information

Never include any of the following in reports, screenshots, logs, or reproduction repositories:

- API keys, command-resolved secret values, OAuth tokens, cookies, or credentials.
- Full OMP configuration files when they contain credentials or personal paths.
- Session JSONL content, prompt text, tool arguments, or other private project data.
- The OMP Switch app-data directory, secret vault (DPAPI-protected files on Windows; keyring entries or age files on Linux), or anything copied out of them.

Include redacted reproduction steps, affected OMP Switch and OMP versions, impact, and any relevant non-sensitive diagnostics instead.
