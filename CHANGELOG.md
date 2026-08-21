# Changelog

All notable changes to OMP Switch will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and version tags use `vMAJOR.MINOR.PATCH`.

## 0.4.2 - 2026-08-22

### Changed

- Command palette (Ctrl+K) rewritten to an icon-prefixed list: each item carries a leading glyph
  (shared with the left-rail icon language), a label, and a `↵` affordance that lights up on the
  selected row. The input gained a leading search glyph; Profile items show 当前 / ↵ and provider
  items show a model-count chip. Group headings tightened.
- Session detail moved the "load earlier messages" control inside the scroll area at the top, so the
  pagination entry stays visible instead of being pushed below the thread. The selected session row
  now carries a 3px signal left rail so the active row and the detail panel feel connected.
- Snapshot timeline: the latest snapshot reads as the current state — a filled signal node with a
  soft ring, plus a 最近 badge — instead of every snapshot reading as equal weight.
- Diagnostics rows widened (padding 11px / gap 10px) and severity groups separated by a margin so
  the title-to-list hierarchy is clearer.
- Card surfaces (provider cards, role cards, module list/editor panels, usage cards, trend wrap,
  pricing editor, empty states) gained a 1px hairline border in addition to their shadow, so panels
  separate by tone plus a hair rather than only by shadow — closer to the Apple Settings register.
  Light-mode hairline lifted toward a cooler, lower-contrast neutral; dark-mode hairline sits
  barely above the panel.
- Trend area gradient stops carry per-theme opacity via CSS classes (dark mode nudged up) so the
  fill reads on dark panels; the trend line stroke widened to 1.75.
- Display page-title size token (`--fs-display`, 28px) drives module headings — the single largest
  type on the page, reserved for titles.
- Dark-mode signal desaturated from `#43b8aa` to `#3fb6a6` (teal-mint) so it reads as a highlight
  rather than a saturated accent; dark-mode trend colors lifted to a clearer mint.
- The Profile drawer is now tabbed (设置 / 项目 / 快照 / OMP / OAuth) with a sticky tab bar, so its
  five concerns no longer scroll as one long stack.
- Provider edit form de-duplicated its `input/select/textarea` styling: the field rules now live in
  one place with a single override for fields inside a sunken form-group, removing a stale duplicate
  block that had drifted out of sync.
- Per-row quick-assign affordance is now faintly present at rest (opacity 0.4) so it is discoverable
  without hovering, intensifying on hover/focus; touch users still see it.

### Security

- No new IPC channels and no new dependencies. All changes are renderer-side CSS and React; the
  usage trend, session message, and YAML paths are unchanged.

## 0.4.1 - 2026-08-21

### Added

- Usage dashboard rework: expandable rows reveal the full token split (input/output/cacheRead/
  cacheWrite/reasoning), cache hit rate, and an in-row cost sparkline; the trend chart switched from
  thin bars to an SVG area chart with a 花费/请求/Tokens dimension switcher and a Radix tooltip; top
  KPI cards collapsed into three composite cards (cost + source + token-composition stacked bar,
  requests + failure rate, cache hit). A new `UsageReport.byModelByDay` / `byProviderByDay` feeds the
  in-row sparklines.
- Session messages rebuilt from a raw `<pre>` text join into role bubbles: user turns are
  right-aligned ink/paper inversions, assistant turns are left-aligned sunken blocks carrying the
  model, and system/tool/result turns are centered quiet strips. Whitespace is preserved so code
  blocks render.
- YAML preview with file tabs (models.yml / config.yml), line numbers, and a hand-written four-color
  syntax highlighter (key/string/number/comment), replacing the merged single `<pre>`.
- Diagnostics gained a summary header (status LED + error/warning/info counts) and severity grouping.
- Empty states redesigned: soft rounded panels with a large tinted glyph, a context line, and a
  primary/secondary CTA pair, replacing the dashed-border placeholder.

### Changed

- Left rail: the seven modules are grouped into 配置 / 内容 / 运维 with section titles; the active
  state moved from a 3px accent rail to a soft rounded fill block with a signal-tinted icon.
- Provider card header primary/secondary split: the header row keeps only the name, api, a model-count
  badge, and the chevron; endpoint, key status, and coverage moved into a sunken meta bar above the
  model list.
- Provider edit form grouped into 身份 / 连接 / 模型 / 高级 cards with hint lines (e.g. the DPAPI note
  that OMP reads keys via `!command` and never writes them to config).
- Snapshot timeline draws as a vertical-line timeline with node dots and inline restore buttons,
  instead of a flat clickable list.
- Roles resolution chain split into a secondary quiet reference chain and a primary resolved-model
  line.

### Security

- No new IPC channels; the usage rework adds `byModelByDay` / `byProviderByDay` to the existing
  `omp:usage-summary` payload only. The YAML highlighter runs renderer-side on already-loaded text
  with no new filesystem or network access.

## 0.4.0 - 2026-08-21

### Added

- Manual theme switch (light / dark / system) in the top bar, persisted across sessions and
  forwarded to the main process so the native title-bar overlay buttons follow; one `light-dark()`
  token definition serves both the OS-following and manual tracks.
- Custom title bar: the web topbar doubles as the drag region with native overlay window buttons,
  reclaiming the OS caption height and letting Mica reach the top edge (Snap Layouts kept).
- Tooltips on top-bar icon buttons via Radix Tooltip, replacing slow native `title` hints.
- `pnpm preview:renderer` — a browser dev server for renderer-only work, mirroring the
  electron-vite `@omp-switch/core` alias.

### Changed

- Provider cards: the header now only expands/collapses the model list (animated via a CSS
  grid-rows transition); an edit pencil appears on hover; the selected-state ring is gone.
  Model rows are display-only; quick-assign stays.
- The detail/editor drawer became a floating sheet that springs in over the workspace instead of
  squeezing it as a third column.
- Native `<select>` replaced by a styled Radix Select (profile picker, auth mode, discovery type,
  default thinking level, gateway upstream kind).
- Hairline-weight theme-aware scrollbars; buttons compress slightly on press; section switches
  crossfade with a slight rise.

### Fixed

- Collapsing a provider's model list opened the right-hand drawer, because expand/collapse and
  select/open-drawer shared one click handler. They are now separate controls and can no longer
  fire together.

## 0.3.3 - 2026-08-21

### Added

- Two-step saves with a diff preview: every commit (roles, settings, providers, deletions) first
  shows a line-level diff of the exact text `models.yml` and `config.yml` would receive, produced
  by a new `previewPatch` core path with no filesystem effects; the commit re-guards on
  confirmation.
- Snapshot timeline: the Profile drawer lists retained snapshots (up to 30 per profile) and any
  entry can be restored under the existing external-edit guard.
- Conflict-resolution dialog with one-click reload when the hash guard fires; all `window.confirm`
  prompts replaced by in-app dialogs.
- Command palette (`Ctrl+K`) for sections, profiles, providers, and frequent actions; `Ctrl+1…7`
  section switching; `?` shortcut reference.
- enabledModels coverage signals: provider chips, filtered-model marks in the role picker, and a
  roles-page warning when an assigned model is filtered out of OMP's catalog.
- Save toasts name the written file; loading skeletons for sessions/usage; usage range presets
  (7/30/90/all) as a segmented control; `prefers-reduced-motion` respected globally.

### Fixed

- An explicitly `null` `headers`, `compat`, or `modelOverrides` now fails validation: OMP rejects
  the whole `models.yml` for these and silently disables every custom provider. `headers` slipped
  past a falsy check and the other two were unchecked.
- An `apiKey` command reference into `node_modules` or with a relative `"."` app argument warns
  (`provider.apiKey-fragile-command`) — it only resolves inside the dev checkout that wrote it.

## 0.3.2 - 2026-08-21

### Added

- Dedicated Roles page: every OMP role shows its resolved selector chain (`@default →
  provider/model`), capability chips, and in-place warnings for `@role` cycles, unparseable
  selectors, and `:off`/`:auto` misuse. Custom roles present in `config.yml` beyond the ten
  documented ones are listed and editable instead of invisible.
- Searchable model picker shared by the Roles page and gateway upstreams: provider-grouped list
  with capability chips and context windows, instant search, pinned `@default`/`*`/clear values, a
  segmented thinking-level control limited to the six levels OMP accepts as a role suffix, and
  keyboard navigation.
- Quick-assign action on model rows: assign any provider/model to a role in one click, preserving
  the role's existing thinking suffix.
- Split save semantics with dirty tracking: independent role and settings commits, pending-change
  dots in navigation, `Ctrl+S`, and a discard prompt when switching profiles (section switches keep
  edits in memory and never prompt).
- Dark theme following the OS (`prefers-color-scheme`), and a Mica window material on Windows 11
  22H2+ with automatic solid fallback.
- Toast queue replacing the single notice banner.

### Changed

- Visual language redesigned end to end: untinted zinc neutrals; teal demoted to a signal color
  used only for selection, focus, and switch state; primary buttons use ink/paper inversion;
  status pills became dot + quiet text; tone and soft shadows replace border-on-everything.
- Left navigation became a source list; provider cards became borderless inset groups with
  internal hairlines; checkboxes became switches; body type is 14px Segoe UI Variable; monospace
  is Cascadia Mono.
- The roles editor moved out of the Profile drawer, which now holds settings, snapshot, OAuth, and
  raw YAML only.

### Fixed

- The "new provider" dropdown menu closes on outside click and Escape (previously it stayed open).

### Known Limitations

- The theme follows the OS with no in-app light/dark toggle yet; Mica requires Windows 11 22H2+.
- The binaries remain unsigned; winget and Chocolatey submissions remain pending.

## 0.3.1 - 2026-08-20

### Added

- Sessions page now lists one entry per primary OMP session — title, latest model/provider/status,
  message and request counts, aggregated tokens and cost — with pagination, a distinct empty state
  per failure mode (missing root, unrecognized layout, initial indexing, unreadable files), and a
  visible refresh-statistics line.
- Message viewer pages through session history: 50 messages per page, newest first, 4 KiB text
  previews, with a "load earlier" continuation cursor.
- Explicit "rebuild index" action for a forced full re-index; normal refresh stays incremental.

### Changed

- Session scanning is bounded: only files matching the verified OMP primary-session naming at the
  sessions root and in one-level project group directories are indexed. Ancillary per-session
  directories are never parsed; unrecognized layouts surface a diagnostic instead of triggering a
  broad recursive scan.
- Refresh runs in two phases: quick discovery (stat + head hash + first chunk) returns a usable
  list in tens of milliseconds, while full aggregation streams the rest in the background with at
  most two concurrent file readers. Concurrent refreshes for the same profile are coalesced into
  one main-process task.
- Unchanged session files are reused without reads, appended files are parsed tail-only, and a
  shrink or head change rebuilds that one file. Failed reads keep the previous cache, marked stale.
- Usage accounting consumes compressed per-session records instead of event rows; totals match the
  previous event-level index exactly on the reference archive (5,528 requests, $402.22 recorded).
- The sqlite metadata backend stores session summaries and usage in `session_cache`/`session_usage`
  applied as a transactional per-file diff and drops the legacy event-level `session_index` table;
  the JSON fallback upgrades to schema v3 and writes atomically via temp file + rename.

### Security

- The renderer no longer receives absolute session file paths or byte offsets. List and message
  cursors are opaque, HMAC-signed, and bound to the session file's fingerprint; message reads
  re-validate that the file still lives inside the current profile's sessions root and still
  matches the indexed fingerprint, before and after reading.
- Removed the unused `app:open-folder` IPC (`shell.openPath` with a renderer-supplied path).
- The packaged build always loads the local renderer; `ELECTRON_RENDERER_URL` is honored only when
  unpackaged and must be a loopback http URL. Window navigation and `window.open` are denied.

### Known Limitations

- Session layouts outside the verified primary-session naming are reported rather than scanned.
- Message previews are capped at 4 KiB per message.

## 0.3.0 - 2026-08-19

### Changed

- Reissued the supported Windows desktop app and headless JSON CLI as a verified release with
  installer, portable archive, checksums, and build-provenance attestations.
- Release automation keeps the GitHub Release assets, GHCR CLI image, and Scoop manifest on the
  same version and published checksum.
- Installation documentation now points at the `0.3.0` CLI image and release artifacts.

### Fixed

- Repaired the release tag/version mismatch that previously prevented the `v0.3.0` workflow from
  building any assets.
- Rendered Windows package-manager metadata from the exact published installer and portable ZIP,
  avoiding hashes from a different local build.

### Known Limitations

- The Windows binaries remain unsigned, so SmartScreen may warn on first run.
- winget and Chocolatey submissions depend on their external validation and moderation queues.
- A clean-Windows install, upgrade, and uninstall regression is still pending.

## 0.2.0 - 2026-08-19

### Added

- Usage dashboard: spend, requests, tokens, cache and reasoning totals, a per-day trend, and
  breakdowns by model and provider, with date filtering. Cost is labelled with its provenance, and
  per-model prices can be entered locally to cross-check what OMP recorded.

- `disabledProviders` is now editable, including path-scoped entries, and recognizes OMP's discovery source ids (`native`, `claude`, `codex`, `gemini`, `github`, `opencode`, `cursor`, `agents-md`) alongside model providers.
- The project root used for `.omp` overlay and prompt/skill lookups is a persisted, user-chosen directory instead of `process.cwd()`, which is arbitrary for a GUI launched from the Start Menu. An unconfirmed root is labelled as a guess.
- Project overlays now explain how they override the user-level config: which arrays OMP replaces wholesale, and when `modelRoleStorage: "project"` shadows role edits made here.
- Credentials are reference-counted. Deleting one that a config or gateway pool still uses reports the references instead of breaking that provider silently, and orphaned vault entries left behind by a removed provider can be listed.

### Fixed

- Session indexing read `usage`, `cost`, `model` and `provider` from the top level of a session JSONL
  line, where OMP writes none of them; they live on `message`. Usage and cost were therefore always
  empty, and failures were never detected because `type` is always `"message"` rather than a status.

- Thinking levels are no longer treated as one set. `defaultThinkingLevel` rejects `off`, and a role suffix accepts only `minimal`/`low`/`medium`/`high`/`xhigh`/`max`, matching OMP. A role ending in `:off` or `:auto` now warns instead of being written as a config OMP rejects.
- An override-only provider (no `models`) must carry one of `baseUrl`/`apiKey`/`headers`/`compat`/`disableStrictTools`/`modelOverrides`/`discovery`/`remoteCompaction` or `auth: none`, which OMP requires and this app previously skipped entirely.
- Profile paths follow OMP's own environment overrides (`PI_CONFIG_DIR`, `OMP_PROFILE`, `PI_PROFILE`, `PI_CODING_AGENT_DIR`). Previously a user with any of these set had edits written to files OMP never reads, and the app reported success.
- An unrecognized `api` value is reported as a warning instead of passing unchecked.
- Project overlay discovery stops at the home directory. It previously walked past the project and reported the user-level `~/.omp` as a project overlay.
- Path-scoped `enabledModels` and `disabledProviders` entries are validated, so an entry OMP would silently discard is reported instead.
- Snapshots no longer accumulate without bound: both metadata backends cap at 30 per profile and the snapshot directories on disk are pruned to match. The sqlite backend previously kept every row and neither backend ever deleted a directory.
- The metadata sqlite handle is closed on quit; it previously kept the database file locked.

### Security

- The loopback gateway requires a bearer token, stored at `userData/gateway/gateway.token` with `0600`. It also rejects non-loopback `Host` headers (421) and any request carrying `Origin` (403), so a local process or a web page can no longer spend the user's credentials by knowing the port. `/healthz` stays unauthenticated.
- Gateway responses relay only an allowlist of headers; `set-cookie` and framing headers from the upstream are dropped.
- Gateway upstream requests time out after 255s instead of hanging indefinitely.
- A plaintext-looking `apiKey` in `models.yml` is now reported (`provider.apiKey-plaintext`). The rule lives in the core validator, so it also covers the JSON CLI, which could previously write a key in plaintext.
- `restoreSnapshot` verifies each target file still matches the snapshot or the commit it guarded, and refuses to overwrite an external edit unless `force` is passed.
- Deleting an anchored YAML node, or rewriting an alias, is refused rather than producing a file with dangling aliases. Editing an anchored node in place is still allowed and preserves the anchor.

### Changed

- The secret bridge publishes as Native AOT: 29 ms median cold start versus 148 ms, and 2.4 MB versus 13.5 MB. Building it now needs the Visual Studio "Desktop development with C++" workload; `scripts/build-secret-bridge.ps1` handles `vswhere.exe` discovery.
- The gateway panel shows the bearer token and per-upstream latency, last status and consecutive failures.

### Not yet done

- Clean-Windows install, upgrade and uninstall regression against real OMP profiles.
- Code signing; the binaries are unsigned and rely on build-provenance attestations.

### Also in this release

- OMP v16/v17 write support with unknown-major read-only protection.
- Versioned catalog imports, expanded discovery, compact Provider/Model workbench, Prompts, Skills, Sessions, and Gateway modules.
- JSON CLI commands, loopback gateway routes, DPAPI secret bridge, snapshots, and OMP update/OAuth controls.

### Changed

- Provider, model, role, and settings validation now follows the documented OMP schema fields.

### Security

- Gateway pool identifiers and secret references are validated before persistence.
- Session raw content remains outside metadata and default exports.

## 0.1.0 - Development Snapshot

This is the initial source snapshot. It is intentionally not tagged or published as a supported GitHub Release.
