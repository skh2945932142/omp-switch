# Installing OMP Switch

## What runs where

OMP Switch ships two different things. They have different platform support, and the difference is
architectural rather than a packaging gap:

| Artifact | Windows | Linux / macOS | Contains |
| --- | --- | --- | --- |
| **Desktop app** (GUI, credential vault, gateway, prompts/skills/sessions) | Supported | **Not supported yet** | Everything |
| **Headless CLI** (`omp-switch-cli`) | Supported | Supported | Config read/write, validation, snapshots |

The desktop app is Windows-only because the credential path is: API keys are sealed with Electron
`safeStorage` (the Windows user's DPAPI key) and Oh My Pi resolves them by running
`native/secret-bridge`, a `net10.0-windows` binary that calls `crypt32.dll`. Porting the GUI to Linux
means choosing and implementing a different credential backend, not adding a build target. See
[Linux support](#linux-support) below.

The headless CLI has no Electron dependency at all — `packages/core` is pure Node — so it runs
anywhere Node 24 does. It cannot open the credential vault (only the machine that sealed a key can),
so it manages configuration, not secrets.

---

## Windows: desktop app

### winget

```powershell
winget install skh2945932142.OMPSwitch
```

### Scoop

```powershell
scoop bucket add omp-switch https://github.com/skh2945932142/omp-switch
scoop install omp-switch
```

### Chocolatey

```powershell
choco install omp-switch
```

### Direct download

From the [latest release](https://github.com/skh2945932142/omp-switch/releases/latest):

- `OMP Switch Setup <version>.exe` — NSIS installer, per-user
- `OMP Switch-<version>-win.zip` — portable, unzip and run
- `SHA256SUMS.txt` — verify before running:

```powershell
(Get-FileHash -Algorithm SHA256 ".\OMP Switch Setup 0.2.0.exe").Hash.ToLower()
# compare against the matching line in SHA256SUMS.txt
```

Releases also carry GitHub build-provenance attestations:

```powershell
gh attestation verify ".\OMP Switch Setup 0.2.0.exe" --repo skh2945932142/omp-switch
```

> **Installs are per user on purpose.** The credential vault is encrypted with the installing Windows
> account's DPAPI key. A per-machine install would create a vault the other accounts on the box
> cannot read, and keys never transfer to another machine.

---

## Any platform: headless CLI

### Docker

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

What already works on Linux today: `packages/core` (all domain logic), the headless CLI, and the
test suite.

What blocks the desktop app, in order of difficulty:

1. **Credential backend.** Oh My Pi resolves an API key by running the command in `apiKey: '!…'`
   with a 10 second timeout, with the GUI closed. On Windows that command is the DPAPI-backed
   secret bridge. Linux needs an equivalent — `libsecret`/`kwallet` via `secret-tool`, or an
   age/gpg-encrypted vault — and that is a security design decision, not a port.
2. **`native/cli-proxy`** is unnecessary on Linux (it only exists because a GUI-subsystem Windows
   binary cannot write to an attached console); a shell wrapper replaces it.
3. **Interactive OAuth launch** currently shells out to `cmd.exe /c start`.
4. **Packaging**: `electron-builder` can emit AppImage/deb/rpm once the above are settled.

Until then, `deb`/`rpm`/AppImage packages are deliberately not published rather than shipped with a
credential path that silently fails or stores keys in plaintext.
