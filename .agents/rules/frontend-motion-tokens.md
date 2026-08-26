# Frontend Design System & Motion Invariants

- **Token Discipline**: All colors MUST resolve through light-dark() tokens in `src/renderer/styles/tokens.css`. No raw hex codes allowed in components or CSS modules. `--signal` is reserved exclusively for selected/focus/switch states.
- **Layout Motion**: Navigation pills and tab indicators MUST use motion/react with layoutId and spring physics for fluid movement.
- **Grid Column Resilience**: Navigation items and list rows with dynamic text MUST use `minmax(0, 1fr)` with `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` to prevent text expansion from distorting vertical rhythm.
- **Zero-Hardcoded Strings**: Main process dialogs and alerts must never use hardcoded Chinese/English strings. Translated strings must be passed from the renderer or structured error codes returned for UI-layer `t()` resolution. `zh.json` and `en.json` keys must remain in 100% parity.
- **Flow Pipeline Badges**: Display multi-hop entity relations (like role delegations) using flow-chain pills (`.flow-chain-wrap` -> `.flow-node`).
- **Structured Message Rendering**: Message streams MUST separate `<think>` tags into collapsible accordions (`.thinking-block`) and wrap code fences in `.msg-code-block` with clipboard copy.
