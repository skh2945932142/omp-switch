# IPC, Security & Architecture Invariants

- **Dependency Direction**: Strict unidirectional flow: `packages/core` -> `electron` -> `src/renderer`. Core must NEVER import Electron.
- **IPC Five-Point Sync**: Any new or modified IPC channel MUST be updated across all five locations in sync:
  1. `packages/core` type exports (if applicable)
  2. `electron/main.ts` IPC handlers
  3. `electron/preload.ts` bridge exposure
  4. `src/renderer/global.d.ts` (`OmpSwitchApi`)
  5. `src/renderer/api.ts` (`createMockApi()`)
- **Sandbox Boundary & Restore Protection**: High-privilege IPC handlers (e.g. `omp:restore`, `secret:put`) must strictly validate targets within the active profile's `agentDir` and never trust unverified target file paths supplied by the renderer.
- **Credential Masking Invariant**: CLI and API outputs must mask sensitive keys by default (e.g. `sk-***`) and only reveal plaintext when explicitly requested via flags like `--reveal-secrets`.
- **Single Path for Config Writes**: All OMP configuration mutations must go exclusively through `OmpFilesystemAdapter` (`loadProfile` -> `previewPatch`/`planPatch` -> `commitPatch`). Bypass writes are strictly prohibited.
