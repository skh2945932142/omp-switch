import type { SettingsDocument } from "@omp-switch/core";

export type ProviderApplyBlockReason = "readonly" | "disabled" | "no-models" | "missing-key";

export type DisabledProviderRule = string | Record<string, unknown>;

export type ProviderApplySettings = Partial<Pick<SettingsDocument, "modelProviderOrder" | "enabledModels" | "disabledProviders" | "defaultThinkingLevel" | "compaction" | "extendedContext" | "externalThinking" | "personality" | "images">>;

export interface ProviderApplyPatchDraft {
  settings: ProviderApplySettings;
  roleAssignments?: Record<string, string>;
}

const SCOPE_KEYS = ["path", "paths", "pathPrefix", "pathPrefixes"] as const;
const VALUE_KEYS = ["providers", "values", "items"] as const;

/** Put a provider first without disturbing the user's remaining provider order. */
export function moveProviderToFront(providerId: string, order: string[]): string[] {
  const id = providerId.trim();
  if (!id) return order.slice();
  return [id, ...order.filter((item) => item !== id)];
}

/** Merge a provider selection into the current settings/role drafts without discarding either. */
export function mergeProviderApplyDraft(
  providerId: string,
  order: string[],
  settings: ProviderApplySettings,
  roles: Record<string, string>,
  rolesDirty: boolean,
): ProviderApplyPatchDraft {
  return {
    settings: { ...settings, modelProviderOrder: moveProviderToFront(providerId, order) },
    ...(rolesDirty ? { roleAssignments: { ...roles } } : {}),
  };
}

/** Resolve the first configured provider, falling back to declaration order when no preference exists. */
export function effectivePreferredProviderId(providerIds: string[], order: string[]): string | null {
  const configured = new Set(providerIds);
  return order.find((id) => configured.has(id)) ?? providerIds[0] ?? null;
}

/**
 * Normalize a path for scope comparison. `sep` is the platform separator (`"\\"` on Windows, `"/`
 * on POSIX); user-written scopes may still use the other convention, so both are folded to `sep`
 * before comparison — matching OMP's own tolerance for either spelling.
 */
function normalizedPath(value: string, sep: string): string {
  const normalized = value.trim().replaceAll("/", sep).replaceAll("\\", sep).replace(/[\\/]+$/, "").toLowerCase();
  return normalized || sep;
}

function scopeMatches(scope: string, profilePath: string, sep: string): boolean {
  const candidate = normalizedPath(scope, sep);
  const current = normalizedPath(profilePath, sep);
  if (candidate === "~") return true;
  if (candidate.startsWith(`~${sep}`)) return current.endsWith(candidate.slice(1));
  return current === candidate || current.startsWith(`${candidate}${sep}`);
}

function scopedRuleMatches(rule: Record<string, unknown>, providerId: string, profilePath: string, sep: string): boolean {
  const values = VALUE_KEYS.flatMap((key) => {
    const value = rule[key];
    return Array.isArray(value) ? value : value === undefined ? [] : [value];
  });
  if (!values.some((value) => value === providerId)) return false;

  const scopes = SCOPE_KEYS.flatMap((key) => {
    const value = rule[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : typeof value === "string" ? [value] : [];
  });
  return scopes.length > 0 && scopes.some((scope) => scopeMatches(scope, profilePath, sep));
}

/**
 * Match only explicit bare rules or scoped rules that apply to the current profile path.
 * `sep` is the platform separator; omitting it preserves the historical Windows-only behavior.
 */
export function isProviderDisabled(providerId: string, rules: DisabledProviderRule[] | undefined, profilePath: string, sep = "\\"): boolean {
  const id = providerId.trim();
  if (!id || !rules?.length) return false;
  return rules.some((rule) => typeof rule === "string" ? rule.trim() === id : scopedRuleMatches(rule, id, profilePath, sep));
}

export function providerApplyBlockReason(input: {
  readOnly?: boolean;
  disabled?: boolean;
  modelCount: number;
  auth?: string;
  apiKey?: string;
}): ProviderApplyBlockReason | null {
  if (input.readOnly) return "readonly";
  if (input.disabled) return "disabled";
  if (input.modelCount <= 0) return "no-models";
  if (input.auth !== "none" && input.auth !== "oauth" && !input.apiKey?.trim()) return "missing-key";
  return null;
}
