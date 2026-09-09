# Tracking OMP upstream schema changes

OMP Switch declares which OMP major versions it can safely **write** in
`packages/core/src/schema.ts` (`WRITABLE_OMP_SCHEMA_MAJORS`, currently 16/17/18). An OMP outside
that set gets a read-only app — deliberate, because writing a schema we have not validated risks
corrupting a user-owned file.

## Automated watch

`.github/workflows/omp-schema-watch.yml` runs weekly (Monday 08:00 UTC, plus manual dispatch):

1. `scripts/check-omp-version.mjs` fetches OMP upstream's latest release (GitHub API with
   `GITHUB_TOKEN`; `git ls-remote` tags as the rate-limit-proof fallback), parses the major, and
   compares it against `WRITABLE_OMP_SCHEMA_MAJORS` (parsed from source — no import coupling).
2. On a mismatch it exits 1 with the maintainer checklist, and the workflow opens a tracking
   issue labeled `maintenance`.

Run it locally any time:

```bash
node scripts/check-omp-version.mjs
# GITHUB_TOKEN=ghp_… node scripts/check-omp-version.mjs   # authenticated, higher rate limit
```

## Manual half: adding a new major

When the watch fires (or proactively after browsing upstream's
`packages/coding-agent/CHANGELOG.md`):

1. **Read the upstream schema sources** — the definition of truth is:
   - `packages/coding-agent/src/config/models-config-schema-bundle.ts` (providers, models,
     thinking levels, tokenizers, codeMode, discovery, auth)
   - `packages/coding-agent/src/config/settings-schema.ts` (config.yml)
   - `packages/coding-agent/src/config/config-file.ts` (loading semantics, JSON→YAML migration)
   Fetch them at the new tag:
   ```bash
   curl -s https://raw.githubusercontent.com/can1357/oh-my-pi/v<NEW>/packages/coding-agent/src/config/models-config-schema-bundle.ts
   ```
2. **Add the major** to `WRITABLE_OMP_SCHEMA_MAJORS` (`packages/core/src/schema.ts`).
3. **Diff against our validator** — `packages/core/src/validation.ts` must accept everything the
   upstream schema accepts and reject what it rejects: root keys, provider fields
   (`provider.empty` carriers), thinking levels (`ROLE_THINKING_LEVELS` /
   `SETTINGS_THINKING_LEVELS`), `KNOWN_PROVIDER_APIS`, `KNOWN_TOKENIZER_FAMILIES`,
   `CODE_MODE_VALUES`, `DISCOVERY_TYPES`.
4. **Update presets** — `packages/core/src/catalog.ts` for new or changed providers.
5. **Extend tests** — fixtures under `packages/core/src/*.test.ts` for the new fields; a fixture
   written by real OMP `<NEW>.x` is the best oracle.
6. **Release note** — `docs/releases/vX.Y.Z.md` records the newly supported major.

Note on rate limits: the GitHub API is anonymous-rate-limited per IP (60/h) and shared proxies
burn it fast; `git ls-remote` and `raw.githubusercontent.com` are the reliable fallbacks — the
checker and this doc both prefer them when the API refuses.
