import { parseRoleSelector, type ParsedRoleSelector } from "@omp-switch/core/validation";

/**
 * OMP's documented roles. Ids stay English — they are written to config.yml. The gloss is an i18n
 * key (`roles.gloss.<id>`); the renderer resolves it with t(), the TUI with its own strings.
 */
export const ROLE_CATALOG: Array<{ id: string; glossKey: string }> = [
  { id: "default", glossKey: "roles.gloss.default" },
  { id: "smol", glossKey: "roles.gloss.smol" },
  { id: "slow", glossKey: "roles.gloss.slow" },
  { id: "vision", glossKey: "roles.gloss.vision" },
  { id: "plan", glossKey: "roles.gloss.plan" },
  { id: "designer", glossKey: "roles.gloss.designer" },
  { id: "commit", glossKey: "roles.gloss.commit" },
  { id: "tiny", glossKey: "roles.gloss.tiny" },
  { id: "task", glossKey: "roles.gloss.task" },
  { id: "advisor", glossKey: "roles.gloss.advisor" },
];

/** Just the documented role ids, in catalog order, for consumers that only need the id set. */
export const KNOWN_ROLE_IDS: string[] = ROLE_CATALOG.map(({ id }) => id);

export interface Resolution {
  chain: string[];
  final: ParsedRoleSelector | null;
  cycle: boolean;
}

/**
 * Follows `@role` indirection so a row can show what a role actually resolves to. Stops at the
 * first cycle or unparseable hop rather than looping.
 */
export function resolveChain(roles: Record<string, string>, role: string, providerIds: string[]): Resolution {
  let selector = (roles[role] ?? "").trim();
  const seen = new Set<string>([role]);
  const chain: string[] = [];
  while (selector) {
    const parsed = parseRoleSelector(selector, providerIds);
    if (!parsed) return { chain, final: null, cycle: false };
    chain.push(selector);
    if (parsed.kind !== "role") return { chain, final: parsed, cycle: false };
    if (seen.has(parsed.role)) return { chain, final: parsed, cycle: true };
    seen.add(parsed.role);
    selector = (roles[parsed.role] ?? "").trim();
  }
  return { chain, final: null, cycle: false };
}
