# Installing OMP Switch

## What runs where

OMP Switch ships three things. Platform support differs by artifact, and the differences are
architectural choices, not packaging gaps:

| Artifact | Windows | Linux | Contains |
| --- | --- | --- | --- |
| **Desktop app** (GUI, credential vault, gateway, prompts/skills/sessions) | Supported | Supported (v0.6.0) | Everything |
| **Headless CLI** (`omp-switch-cli`) | Supported | Supported | Config read/write, validation, snapshots |
| **TUI** (`omp-switch-tui`, from source) | Supported | Supported | Interactive terminal config editing |

The credential path is platform-keyed. Windows: API keys are sealed with Electron `safeStorage`
(the user's DPAPI key) and Oh My Pi resolves them by running `native/secret-bridge`, a
`net10.0-windows` binary that calls `crypt32.dll`. Linux: each key is a **direct libsecret keyring
entry** resolved by `secret-tool` (no bridge binary), with an age keyfile fallback when no Secret
Service is available — see [Linux support](#linux-support) below and [docs/security.md](security.md).

The headless CLI and TUI have no Electron dependency at all — `packages/core` and
`@omp-switch/shared` are pure Node — so they run anywhere Node 24 does. The CLI cannot open the
credential vault (only the machine that sealed a key can),
so it manages configuration, not secrets.

---

## Windows: desktop app

Availability differs per channel, so the table says what actually works today rather than what is
planned:

| Channel | Status |
| --- | --- |
| Direct download (GitHub Releases) | **Works** — Windows exe/zip + Linux AppImage/deb |
| Scoop (bucket hosted in this repository) | **Works** — auto-syncs on every release |
| winget | **Live since 0.3.0** (`skh2945932142.OMPSwitch`); 0.6.0 update submitted |
| Chocolatey | Package prepared; feed submission and moderation **pending** |

The winget and Chocolatey manifests live in `packaging/` and are rendered with real release hashes by
`pnpm render:packaging`. Until those submissions are accepted, `winget install` and `choco install`
will not find the package — use Scoop or the direct download.

### Scoop

```powershell
scoop bucket add omp-switch https://github.com/skh2945932142/omp-switch
scoop install omp-switch
```

This installs the portable build and puts `omp-switch-cli.exe` on PATH.

### Direct download

---

## Any platform: headless CLI

### Docker

```bash
docker pull ghcr.io/skh2945932142/omp-switch-cli:0.5.4
docker run --rm -v "$HOME/.omp:/home/node/.omp"   ghcr.io/skh2945932142/omp-switch-cli:0.5.4 validate --profile default
```

`:latest` also tracks the newest release.

> **The published image may still be private.** GitHub creates container packages as private and
> visibility is a repository-settings toggle, not something the release workflow can set. If the pull
> fails with `unauthorized`, either the owner has not made the package public yet — Settings →
> Packages → `omp-switch-cli` → Change visibility → Public — or you need
> `docker login ghcr.io` with a token carrying `read:packages`. Building locally always works:

```bash
docker build -t omp-switch-cli .
docker run --rm -v "$HOME/.omp:/home/node/.omp" omp-switch-cli validate --profile default
```

The image contains only the CLI. Mount the Oh My Pi config directory you want it to act on. To let it
write snapshots somewhere durable, mount a data directory too:

```bash
docker run --rm \
  -v "$HOME/.omp:/home/node/.omp" \
  -v "$HOME/.local/share/omp-switch:/home/node/.local/share/omp-switch" \
  omp-switch-cli apply --profile default --patch '{"roleAssignments":{"default":"openai/gpt-5"}}'
```

The container runs as the unprivileged `node` user; if your config directory is owned by another uid,
pass `--user "$(id -u):$(id -g)"`.

### From source

```bash
pnpm install --frozen-lockfile
pnpm build:cli
node packages/cli/dist/main.js --help
```

`packages/cli/dist/main.js` is a single self-contained file with no runtime dependencies. Copy it
anywhere Node 24 is available.

On Windows the desktop package also ships `omp-switch-cli.exe`, a console shim next to
`OMP Switch.exe` that reaches the same commands through the installed app.

### CLI contract

stdout is always one line of JSON:

```json
{"version":1,"ok":true,"data":…}
{"version":1,"ok":false,"error":{"code":"command_failed","message":"…"}}
```

Exit codes: `0` success, `1` command failure, `2` usage error. Errors and help go to stderr, so
stdout stays parseable. Commands: `list`, `get`, `validate`, `snapshot`, `apply`.

Environment: `OMP_SWITCH_DATA_DIR` moves the snapshot/data location. `PI_CONFIG_DIR`, `OMP_PROFILE`,
`PI_PROFILE` and `PI_CODING_AGENT_DIR` are honored exactly as Oh My Pi honors them, so the CLI edits
the files Oh My Pi actually reads.

---

## Linux support

What works on Linux today: the **desktop app** (AppImage + deb), `packages/core` (all domain
logic), the headless CLI, and the test suite.

```bash
# From a release (AppImage or deb)
sudo dpkg -i OMP-Switch-<version>-linux.deb
# or chmod +x OMP-Switch-<version>-linux.AppImage and run it

# From source — no .NET/MSVC needed on Linux (build:native is a no-op off Windows)
pnpm install --frozen-lockfile
pnpm dev
pnpm package:linux
```

`omp-switch-cli` on Linux is a shell shim (`bin/omp-switch-cli`) that forwards `--json` argv to the
packaged app; `native/cli-proxy` exists only for Windows. Interactive OAuth login opens your
terminal emulator (resolution order: `$OMP_SWITCH_TERMINAL`, xdg-terminal-exec, gnome-terminal,
konsole, xfce4-terminal, xterm, alacritty, kitty, foot).

**The Linux credential vault landed in v0.6.0.** Each API key is stored as a direct libsecret
keyring entry and resolved by `secret-tool lookup …` (the `!command` grammar was verified against
real OMP 18.x on Linux). Without a Secret Service the store falls back to an age-encrypted keyfile
under `~/.config/OMP Switch/` — an honest downgrade documented in [docs/security.md](security.md).
`OMP_SWITCH_SECRET_BACKEND=libsecret|age` forces either backend for testing. The one runtime
dependency to know about: `secret-tool` comes from the `libsecret-tools` distro package (GNOME
desktops usually have the daemon already).
