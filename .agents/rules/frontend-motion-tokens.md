# Frontend Design System & Motion Invariants

- **Token Discipline**: All colors MUST resolve through light-dark() tokens in src/renderer/styles/tokens.css. No raw hex codes allowed in components or CSS modules.
- **Layout Motion**: Navigation pills and tab indicators MUST use motion/react with layoutId and spring physics for fluid movement.
- **Flow Pipeline Badges**: Display multi-hop entity relations (like role delegations) using flow-chain pills (.flow-chain-wrap -> .flow-node).
- **Structured Message Rendering**: Message streams MUST separate <think> tags into collapsible accordions (.thinking-block) and wrap code fences in .msg-code-block with clipboard copy.
