# Security Policy

## Supported Versions

The first supported public release will be `v0.2.0`. The current `0.1.0` source snapshot is not a supported distribution.

## Reporting a Vulnerability

Please use GitHub's private vulnerability-reporting flow for this repository:

<https://github.com/skh2945932142/omp-switch/security/advisories/new>

If private reporting is temporarily unavailable, open a minimal public issue requesting a secure contact channel. Do not disclose the vulnerability details there.

## Sensitive Information

Never include any of the following in reports, screenshots, logs, or reproduction repositories:

- API keys, command-resolved secret values, OAuth tokens, cookies, or credentials.
- Full OMP configuration files when they contain credentials or personal paths.
- Session JSONL content, prompt text, tool arguments, or other private project data.
- The OMP Switch app-data directory, secret vault, or DPAPI-protected files.

Include redacted reproduction steps, affected OMP Switch and OMP versions, impact, and any relevant non-sensitive diagnostics instead.
