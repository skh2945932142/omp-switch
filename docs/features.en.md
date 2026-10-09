# Features

This page goes through what OMP Switch can do, section by section. For installing, see [install.md](install.md); for security details, see [security.md](security.md).

## Editing configuration

- **OMP versions:** `16.x`, `17.x`, and `18.x` open read-write. A higher major version it hasn't verified opens read-only, and the files are left alone.
- **Profiles:** default and named profiles, plus OMP's own `PI_CONFIG_DIR`, `OMP_PROFILE`, `PI_PROFILE`, and `PI_CODING_AGENT_DIR`. A legacy `models.json` is protected rather than migrated in place.
- **What you can edit:** providers, models, `modelProviderOrder`, `enabledModels`, `disabledProviders`, thinking settings, and fallback chains. OMP v18.8 model compaction thresholds and usage-aware retry fields are now typed/validated and preserved, but are not all editable in the UI yet.
- **How it writes:** it changes only the YAML nodes involved, so comments and unknown fields stay as they were. The file hash is checked before writing, writes are atomic, and a snapshot is taken first. Restoring a snapshot also refuses to overwrite outside changes.
- **Presets:** 81 built-in provider presets. Some models carry context length, output limit, and a `thinkingLevelMap`. The presets were put together with CC Switch's catalog as a reference.
- **Model discovery:** OpenAI-compatible endpoints, Ollama, llama.cpp, LM Studio, Proxy, LiteLLM, and Apple Foundation Models.

What `thinkingLevelMap` means in a preset is explained in [pi-thinking-profiles.md](pi-thinking-profiles.md). The current OMP sync baseline is v18.8.7; weekly schema-source drift checks require manual review.

## Model roles

- The Roles page has one row per role: a short description, what the role actually resolves to (`@default → provider/model = actual model`), and capability chips. Custom roles from `config.yml` can be viewed and edited.
- `@role` cycles, bad selectors, and misuse of `:off` / `:auto` are flagged on the row they affect.
- The model picker is searchable and grouped by provider, with `@default`, `*`, and "clear" pinned at the top. Thinking levels use a segmented control (a role suffix accepts only the six levels OMP accepts), and everything works from the keyboard. The gateway's upstream rows use the same picker.
- Hover a model row to assign it to any role in one click; the role's existing thinking suffix is kept.
- Provider cards and the role picker show `enabledModels` coverage, and warn you in place if a chosen model would be filtered out by OMP.

## Other pages

- **Prompts / Skills / Sessions:** browse the index and read the raw content on demand. The Prompts page also has a local prompt library: add dedicated Markdown folders explicitly, search file names or text, favorite/tag/copy entries, and keep external sources read-only. A selected material can be previewed and adopted as a one-time copy into the current Profile; the source is never edited or synced, and adoption keeps a guarded recovery snapshot.
- **Usage:** spend, requests, tokens, and a per-day trend, grouped by model or provider. Costs say where the numbers came from.
- **Local gateway:** listens on loopback only and serves `/healthz`, `/v1/models`, chat, and responses, with failover before streaming starts. A Bearer token is required, the `Host` header is checked, and cross-origin requests are refused.
- **Credentials and login:** the Windows DPAPI helper, the Linux libsecret / age vault (since v0.6.0), and OMP OAuth status and login entry points. Orphaned credentials and reference tracking behave the same on both systems.
- **CLI:** stable JSON output; commands are `list`, `get`, `validate`, `plan`, `apply`, `snapshot`, `snapshots`, and `restore`. Restore checks snapshot hashes by default; `--force` is required to overwrite external edits. `get --reveal-secrets` prints plaintext credentials and should only be used in a trusted local terminal.
- **TUI:** `omp-switch-tui` has four screens (providers, roles, snapshots, diagnostics) and a two-step save (diff first, then confirm). The `list` and `validate` subcommands can go straight into scripts. It's built from source; see [install.md](install.md).

## Interface details

- **Look** (internally called "Quiet Instrument"): mostly neutral grays, with teal reserved for selection and focus; primary buttons are dark with white text; status is a dot plus quiet text.
- **Theme and language:** light, dark, or follow the system, with the native title-bar buttons following along; Chinese, English, or follow the system, and the first paint already uses the saved language. Windows 11 22H2 and later get a Mica window material; everything else uses solid surfaces.
- **Title bar:** the top bar drags the window, and the window buttons are the native ones (Snap Layouts are kept).
- **Provider cards:** clicking the card header only expands or collapses the model list; an edit button appears on hover; the detail and editor drawers slide in as a floating sheet instead of squeezing the workspace.
- **Saving:** roles and settings save independently; a dot appears in the navigation when something is unsaved, and `Ctrl+S` saves; switching profiles asks before discarding edits.
- **Preview before write:** every save shows a line-by-line diff of `models.yml` / `config.yml` first, and nothing is written until you confirm. The snapshot timeline can be browsed and restored; if an outside edit causes a conflict, a dialog offers a one-click reload.
- **Shortcuts:** `Ctrl+K` opens the command palette (pages, profiles, providers, actions), `Ctrl+1` to `Ctrl+7` switch pages, and `?` lists every shortcut.
