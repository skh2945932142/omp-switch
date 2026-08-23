import { Diagnostic, ModelsDocument, OmpProvider, RoleThinkingLevel, SettingsDocument, SettingsThinkingLevel } from "./domain";

export const DISCOVERY_TYPES = new Set(["ollama", "llama.cpp", "lm-studio", "openai-models-list", "proxy", "litellm"]);

/** Values OMP accepts for `defaultThinkingLevel`. `off` is deliberately absent. */
export const SETTINGS_THINKING_LEVELS: SettingsThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max", "auto"];

/** Values OMP accepts as a role suffix. Neither `off` nor `auto` is one of them. */
export const ROLE_THINKING_LEVELS: RoleThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Every `api` value OMP's schema accepts. Extensions may register further ids at runtime via
 * `pi.registerProvider`, so an unknown value is reported as a warning rather than an error.
 */
export const KNOWN_PROVIDER_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "azure-openai-responses",
  "anthropic-messages",
  "bedrock-converse-stream",
  "google-generative-ai",
  "google-gemini-cli",
  "google-vertex",
]);

/**
 * Every documented `tokenizer` family value (OMP v17.4.0+). Like `api`, an unknown value is a warning,
 * not an error: OMP may add families, and a proxy model with an unrecognized id simply keeps the fast
 * local estimate rather than rejecting the document.
 */
export const KNOWN_TOKENIZER_FAMILIES = new Set([
  "claude-v3",
  "claude-v47",
  "claude-v5",
  "claude-v5-sonnet",
  "qwen3",
  "deepseek-v3",
  "kimi-k2",
  "glm5",
]);

/**
 * `personality` enum in config.yml (OMP v17.4.1+). `none` omits the personality block; the others
 * select a preset whose text a user-level `<agent dir>/PERSONALITY.md` can replace.
 */
export const UNEXPECTED_STOP_MODES = ["none", "mechanical", "smart"] as const;
export type UnexpectedStopMode = (typeof UNEXPECTED_STOP_MODES)[number];

export const UPDATE_CHANNELS = ["stable", "canary"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

export const PERSONALITY_PRESETS = ["default", "friendly", "pragmatic", "none"] as const;
export type PersonalityPreset = (typeof PERSONALITY_PRESETS)[number];

/**
 * `providers.openai-codex.codeMode` enum (OMP v17.4.1+). `auto` follows the catalog `tool_mode`
 * flag, `on` forces Code Mode, `off` (default) leaves the full direct surface.
 */
export const CODE_MODE_VALUES = ["off", "auto", "on"] as const;
export type CodeMode = (typeof CODE_MODE_VALUES)[number];

/**
 * A provider with no models still has to carry one of these, or OMP fails the whole document
 * and silently falls back to its built-in catalog.
 */
const OVERRIDE_ONLY_KEYS = [
  "baseUrl",
  "apiKey",
  "headers",
  "compat",
  "disableStrictTools",
  "modelOverrides",
  "discovery",
  "remoteCompaction",
] as const;

export type ParsedRoleSelector =
  | { kind: "model"; provider: string; model: string; thinking?: RoleThinkingLevel }
  | { kind: "role"; role: string; thinking?: RoleThinkingLevel }
  | { kind: "wildcard"; thinking?: RoleThinkingLevel };


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validRemoteCompaction(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const key of ["enabled", "v2StreamingEnabled"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return false;
  }
  for (const key of ["api", "endpoint", "model", "v2Endpoint", "streamingEndpoint"]) {
    if (value[key] !== undefined && typeof value[key] !== "string") return false;
  }
  return true;
}

export function validateRoleSelector(selector: string, providerIds?: Iterable<string>): boolean {
  return parseRoleSelector(selector, providerIds) !== null;
}

/**
 * `off` and `auto` are real thinking levels elsewhere in OMP but not as a role suffix, so a role
 * ending in one of them is almost always a mistake. It cannot simply be rejected: only known level
 * names are stripped as suffixes, because model ids legitimately contain colons (`llama3.1:8b`).
 */
export function findMisusedRoleThinkingSuffix(selector: string): "off" | "auto" | null {
  const match = selector.trim().match(/:(off|auto)$/);
  return match ? (match[1] as "off" | "auto") : null;
}

export function parseRoleSelector(selector: string, providerIds?: Iterable<string>): ParsedRoleSelector | null {
  const value = selector.trim();
  if (!value || /\s/.test(value)) return null;
  // Only documented role levels are stripped; anything else stays part of the model id so that
  // Ollama-style ids such as `ollama/llama3.1:8b` keep resolving.
  const suffixMatch = value.match(/:(minimal|low|medium|high|xhigh|max)$/);
  const thinking = suffixMatch?.[1] as RoleThinkingLevel | undefined;
  const base = suffixMatch ? value.slice(0, -suffixMatch[0].length) : value;
  if (!base || value.endsWith(":")) return null;

  if (base === "*") return { kind: "wildcard", ...(thinking ? { thinking } : {}) };
  if (base.startsWith("@")) return /^@[A-Za-z0-9._-]+$/.test(base) ? { kind: "role", role: base.slice(1), ...(thinking ? { thinking } : {}) } : null;

  const knownProviders = providerIds ? Array.from(providerIds).filter((provider) => /^[A-Za-z0-9._-]+$/.test(provider)).sort((left, right) => right.length - left.length) : [];
  const provider = knownProviders.find((candidate) => base.startsWith(`${candidate}/`)) ?? base.slice(0, base.indexOf("/"));
  if (!provider || !/^[A-Za-z0-9._-]+$/.test(provider) || (providerIds && !knownProviders.includes(provider))) return null;
  const model = base.slice(provider.length + 1);
  if (!model || /[\r\n\t]/.test(model)) return null;
  return { kind: "model", provider, model, ...(thinking ? { thinking } : {}) };
}

/**
 * OMP resolves `apiKey` as an environment variable name first, then as a literal token, and treats
 * a leading `!` as a command to run. A value that is none of the first two shapes and is not a
 * command reference is therefore a plaintext credential sitting in a user-owned config file.
 */
export function looksLikePlaintextSecret(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("!")) return false;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) && trimmed === trimmed.toUpperCase()) return false;
  if (/^(sk|pk|rk|api|key|tok|ghp|gho|xai|pat)[-_]/i.test(trimmed)) return true;
  return trimmed.length >= 24 && /[0-9]/.test(trimmed) && /[a-z]/.test(trimmed);
}

/**
 * OMP's `cost` mapping: scalar price fields (`input`, `output`, `cacheRead`, `cacheWrite`) are
 * numbers, and since v17.4.0 subscription Codex GPT-5.6 models also carry a nested `longContext`
 * object of threshold-tiered prices. The value can therefore be a finite non-negative number OR a
 * mapping whose own values satisfy the same rule. OMP writes the nested shape itself, so treating it
 * as an error would block a commit on a file this app does not own — only reject genuinely malformed
 * (non-finite, negative, or structurally wrong) values.
 */
function validCost(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (!isRecord(value)) return false;
  return Object.values(value).every(validCost);
}

function validateProviderCredential(providerId: string, provider: OmpProvider, diagnostics: Diagnostic[]): void {
  if (typeof provider.apiKey !== "string" || !provider.apiKey.trim()) return;
  if (provider.apiKey.startsWith("!")) {
    // A dev-session bridge reference (`electron.exe "." --secret-get …`) only works from the
    // checkout it was written from: OMP spawns it from an arbitrary cwd, it fails or burns the
    // whole 10s budget, and the key is silently dropped — the provider just disappears from the
    // catalog. Warn so the owner re-vaults the key from a packaged build.
    if (provider.apiKey.includes("node_modules") || /"\s*\.\s*"/.test(provider.apiKey)) {
      diagnostics.push({
        severity: "warning",
        code: "provider.apiKey-fragile-command",
        path: `providers.${providerId}.apiKey`,
        message: `Provider ${providerId} uses a command reference that only works inside a dev checkout (node_modules path or relative app argument). OMP runs it from an arbitrary working directory, so the key silently fails — re-save the provider from an installed OMP Switch to rewrite the reference`,
      });
    }
    return;
  }
  if (!looksLikePlaintextSecret(provider.apiKey)) return;
  diagnostics.push({
    severity: "warning",
    code: "provider.apiKey-plaintext",
    path: `providers.${providerId}.apiKey`,
    message: `Provider ${providerId} stores what looks like a plaintext API key. Move it into the OMP Switch vault or an environment variable so the key does not live in models.yml`,
  });
}

export function validateModelsDocument(value: Record<string, unknown>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const key of Object.keys(value)) {
    if (key !== "providers") {
      diagnostics.push({ severity: "error", code: "root.unknown-key", path: key, message: `Unknown root key: ${key}` });
    }
  }
  if (!isRecord(value.providers)) {
    diagnostics.push({ severity: "error", code: "root.providers", message: "models.yml must contain a providers mapping" });
    return diagnostics;
  }
  for (const [providerId, rawProvider] of Object.entries(value.providers)) {
    if (!isRecord(rawProvider)) {
      diagnostics.push({ severity: "error", code: "provider.shape", path: `providers.${providerId}`, message: `Provider ${providerId} must be a mapping` });
      continue;
    }
    const provider = rawProvider as OmpProvider;
    if (provider.models !== undefined && !Array.isArray(provider.models)) {
      diagnostics.push({ severity: "error", code: "provider.models", path: `providers.${providerId}.models`, message: "Provider models must be an array" });
    }
    const models = Array.isArray(provider.models) ? provider.models : [];
    if (models.length > 0) {
      if (!provider.baseUrl) diagnostics.push({ severity: "error", code: "provider.baseUrl", path: `providers.${providerId}.baseUrl`, message: `Provider ${providerId} needs baseUrl when defining models` });
      if (!provider.api && !models.every((model) => typeof model?.api === "string")) diagnostics.push({ severity: "error", code: "provider.api", path: `providers.${providerId}.api`, message: `Provider ${providerId} needs api at provider or model level` });
      if (!provider.apiKey && provider.auth !== "none") diagnostics.push({ severity: "error", code: "provider.apiKey", path: `providers.${providerId}.apiKey`, message: `Provider ${providerId} needs apiKey unless auth is none` });
    } else if (!OVERRIDE_ONLY_KEYS.some((key) => provider[key] !== undefined) && provider.auth !== "none") {
      // OMP rejects an override-only provider that carries none of the documented override fields.
      diagnostics.push({
        severity: "error",
        code: "provider.empty",
        path: `providers.${providerId}`,
        message: `Provider ${providerId} defines no models and none of ${OVERRIDE_ONLY_KEYS.join(", ")} or auth: none, which OMP rejects`,
      });
    }
    validateProviderCredential(providerId, provider, diagnostics);
    if (typeof provider.api === "string" && !KNOWN_PROVIDER_APIS.has(provider.api)) {
      diagnostics.push({ severity: "warning", code: "provider.api-unknown", path: `providers.${providerId}.api`, message: `Unknown api "${provider.api}"; OMP only ships ${[...KNOWN_PROVIDER_APIS].join(", ")} unless an extension registers more` });
    }
    if (provider.discovery?.type && !DISCOVERY_TYPES.has(provider.discovery.type)) {

      diagnostics.push({ severity: "error", code: "provider.discovery", path: `providers.${providerId}.discovery.type`, message: `Unsupported discovery type: ${provider.discovery.type}` });
    }
    if (provider.discovery?.type && provider.discovery.type !== "proxy" && !provider.api) {
      diagnostics.push({ severity: "error", code: "provider.discovery-api", path: `providers.${providerId}.api`, message: `Provider ${providerId} needs api for discovery type ${provider.discovery.type}` });
    }
    if (provider.discovery?.timeoutMs !== undefined && (!Number.isFinite(provider.discovery.timeoutMs) || provider.discovery.timeoutMs <= 0)) {
      diagnostics.push({ severity: "error", code: "provider.discovery-timeout", path: `providers.${providerId}.discovery.timeoutMs`, message: "Discovery timeout must be positive" });
    }
    // OMP's schema is all-or-nothing: an explicitly null object field makes it reject the whole
    // models.yml and silently fall back to the built-in catalog. The `!== undefined` form (not a
    // truthiness check) is what catches null — a null headers previously slipped past validation.
    if (provider.headers !== undefined && !isRecord(provider.headers)) {
      diagnostics.push({ severity: "error", code: "provider.headers", path: `providers.${providerId}.headers`, message: `Provider headers must be a mapping${provider.headers === null ? " (currently null — OMP rejects the whole models.yml and disables every custom provider)" : ""}` });
    }
    if (provider.compat !== undefined && !isRecord(provider.compat)) {
      diagnostics.push({ severity: "error", code: "provider.compat", path: `providers.${providerId}.compat`, message: `Provider compat must be a mapping${provider.compat === null ? " (currently null — OMP rejects the whole models.yml and disables every custom provider)" : ""}` });
    }
    if (provider.modelOverrides !== undefined && (!isRecord(provider.modelOverrides) || Object.values(provider.modelOverrides).some((override) => !isRecord(override)))) {
      diagnostics.push({ severity: "error", code: "provider.modelOverrides", path: `providers.${providerId}.modelOverrides`, message: `Provider modelOverrides must be a mapping of mappings${provider.modelOverrides === null ? " (currently null — OMP rejects the whole models.yml and disables every custom provider)" : ""}` });
    }
    if (provider.authHeader !== undefined && typeof provider.authHeader !== "boolean") {
      diagnostics.push({ severity: "error", code: "provider.authHeader", path: `providers.${providerId}.authHeader`, message: "authHeader must be boolean" });
    }
    if (provider.disableStrictTools !== undefined && typeof provider.disableStrictTools !== "boolean") {
      diagnostics.push({ severity: "error", code: "provider.disableStrictTools", path: `providers.${providerId}.disableStrictTools`, message: "disableStrictTools must be boolean" });
    }
    if (provider.remoteCompaction !== undefined && !validRemoteCompaction(provider.remoteCompaction)) {
      diagnostics.push({ severity: "error", code: "provider.remoteCompaction", path: `providers.${providerId}.remoteCompaction`, message: "remoteCompaction must be a mapping with documented string and boolean fields" });
    }
    if (provider.transport !== undefined && provider.transport !== "pi-native") {
      diagnostics.push({ severity: "error", code: "provider.transport", path: `providers.${providerId}.transport`, message: "transport must be pi-native" });
    }
    if (provider.cost !== undefined && !validCost(provider.cost)) {
      diagnostics.push({ severity: "error", code: "provider.cost", path: `providers.${providerId}.cost`, message: "Provider cost values must be finite non-negative numbers (a nested longContext tier mapping is accepted)" });
    }
    for (const [index, model] of models.entries()) {
      if (!model || typeof model !== "object" || typeof model.id !== "string" || model.id.trim() === "") {
        diagnostics.push({ severity: "error", code: "model.id", path: `providers.${providerId}.models.${index}.id`, message: "Every model needs an id" });
        continue;
      }
      if (model.contextWindow !== undefined && (!Number.isFinite(model.contextWindow) || model.contextWindow <= 0)) {
        diagnostics.push({ severity: "error", code: "model.contextWindow", path: `providers.${providerId}.models.${index}.contextWindow`, message: "contextWindow must be positive" });
      }
      if (model.maxTokens !== undefined && (!Number.isFinite(model.maxTokens) || model.maxTokens <= 0)) {
        diagnostics.push({ severity: "error", code: "model.maxTokens", path: `providers.${providerId}.models.${index}.maxTokens`, message: "maxTokens must be positive" });
      }
      if (model.input !== undefined && (!Array.isArray(model.input) || model.input.some((item) => typeof item !== "string"))) {
        diagnostics.push({ severity: "error", code: "model.input", path: `providers.${providerId}.models.${index}.input`, message: "model input must be a string array" });
      }
      if (model.headers !== undefined && !isRecord(model.headers)) diagnostics.push({ severity: "error", code: "model.headers", path: `providers.${providerId}.models.${index}.headers`, message: "Model headers must be a mapping" });
      if (typeof model.api === "string" && !KNOWN_PROVIDER_APIS.has(model.api)) {
        diagnostics.push({ severity: "warning", code: "model.api-unknown", path: `providers.${providerId}.models.${index}.api`, message: `Unknown api "${model.api}" on model ${model.id}` });
      }
      if (model.compat !== undefined && !isRecord(model.compat)) diagnostics.push({ severity: "error", code: "model.compat", path: `providers.${providerId}.models.${index}.compat`, message: "Model compat must be a mapping" });
      if (model.transport !== undefined && model.transport !== "pi-native") diagnostics.push({ severity: "error", code: "model.transport", path: `providers.${providerId}.models.${index}.transport`, message: "transport must be pi-native" });
      if (model.remoteCompaction !== undefined && !validRemoteCompaction(model.remoteCompaction)) diagnostics.push({ severity: "error", code: "model.remoteCompaction", path: `providers.${providerId}.models.${index}.remoteCompaction`, message: "remoteCompaction must be a mapping" });
      if (model.imageInputDecoder !== undefined && model.imageInputDecoder !== "stb") diagnostics.push({ severity: "error", code: "model.imageInputDecoder", path: `providers.${providerId}.models.${index}.imageInputDecoder`, message: "imageInputDecoder must be stb" });
      if (model.cost !== undefined && !validCost(model.cost)) {
        diagnostics.push({ severity: "error", code: "model.cost", path: `providers.${providerId}.models.${index}.cost`, message: "Model cost values must be finite non-negative numbers (a nested longContext tier mapping is accepted)" });
      }
      if (model.name !== undefined && typeof model.name !== "string") {
        diagnostics.push({ severity: "error", code: "model.name", path: `providers.${providerId}.models.${index}.name`, message: "model name must be a string" });
      }
      if (model.reasoning !== undefined && typeof model.reasoning !== "boolean") {
        diagnostics.push({ severity: "error", code: "model.reasoning", path: `providers.${providerId}.models.${index}.reasoning`, message: "reasoning must be boolean" });
      }
      if (model.disableStrictTools !== undefined && typeof model.disableStrictTools !== "boolean") {
        diagnostics.push({ severity: "error", code: "model.disableStrictTools", path: `providers.${providerId}.models.${index}.disableStrictTools`, message: "disableStrictTools must be boolean" });
      }
      if (typeof model.tokenizer === "string" && !KNOWN_TOKENIZER_FAMILIES.has(model.tokenizer)) {
        diagnostics.push({ severity: "warning", code: "model.tokenizer-unknown", path: `providers.${providerId}.models.${index}.tokenizer`, message: `Unknown tokenizer "${model.tokenizer}" on model ${model.id}; OMP only ships ${[...KNOWN_TOKENIZER_FAMILIES].join(", ")} unless a future version adds more` });
      }
      if (model.tokenizer !== undefined && typeof model.tokenizer !== "string") {
        diagnostics.push({ severity: "error", code: "model.tokenizer", path: `providers.${providerId}.models.${index}.tokenizer`, message: "tokenizer must be a family string" });
      }
    }
  }
  return diagnostics;
}

/**
 * Discovery sources `disabledProviders` can switch off, alongside model provider ids. These are not
 * model providers, so they never appear in models.yml and must be recognized separately.
 */
export const DISCOVERY_SOURCE_IDS = new Set(["native", "claude", "codex", "gemini", "github", "opencode", "cursor", "agents-md"]);

/** Built-in model providers a user may disable without ever declaring them in models.yml. */
export const BUILTIN_PROVIDER_IDS = new Set(["anthropic", "openai", "google", "groq", "ollama", "openrouter"]);

const SCOPE_PATH_KEYS = ["path", "paths", "pathPrefix", "pathPrefixes"] as const;

/**
 * `enabledModels` and `disabledProviders` share one shape: a bare string, or a mapping that scopes
 * values to a path. OMP drops a malformed scoped entry silently, so catching it here is the only
 * way the user finds out.
 */
function validateScopedRules(
  rules: unknown,
  field: "enabledModels" | "disabledProviders",
  valueKey: "models" | "providers",
  diagnostics: Diagnostic[],
): void {
  if (rules === undefined) return;
  if (!Array.isArray(rules)) {
    diagnostics.push({ severity: "error", code: `settings.${field}`, message: `${field} must be an array` });
    return;
  }
  for (const [index, rule] of rules.entries()) {
    const path = `${field}.${index}`;
    if (typeof rule === "string") {
      if (!rule.trim()) diagnostics.push({ severity: "error", code: `settings.${field}`, path, message: `${field} entries must not be empty` });
      continue;
    }
    if (!isRecord(rule)) {
      diagnostics.push({ severity: "error", code: `settings.${field}`, path, message: `${field} entries must be strings or scoped mappings` });
      continue;
    }
    const hasPath = SCOPE_PATH_KEYS.some((key) => rule[key] !== undefined);
    const values = rule[valueKey] ?? rule.values ?? rule.items;
    if (!hasPath) {
      diagnostics.push({ severity: "error", code: `settings.${field}-scope`, path, message: `A scoped ${field} entry needs one of ${SCOPE_PATH_KEYS.join(", ")}` });
    }
    if (values === undefined) {
      diagnostics.push({ severity: "error", code: `settings.${field}-values`, path, message: `A scoped ${field} entry needs ${valueKey}, values or items` });
      continue;
    }
    // Only string values survive OMP's own filtering, so a nested object is silently dropped there.
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
      diagnostics.push({ severity: "error", code: `settings.${field}-values`, path, message: `Scoped ${field} values must be a non-empty string array` });
    }
  }
}

export function validateSettingsDocument(value: SettingsDocument, providerIds?: Iterable<string>): Diagnostic[] {

  const diagnostics: Diagnostic[] = [];
  if (value.modelRoles && !isRecord(value.modelRoles)) {
    diagnostics.push({ severity: "error", code: "settings.modelRoles", message: "modelRoles must be a mapping" });
  }
  for (const [role, selector] of Object.entries(value.modelRoles ?? {})) {
    if (typeof selector !== "string" || !validateRoleSelector(selector, providerIds)) {
      diagnostics.push({ severity: "error", code: "settings.role-selector", path: `modelRoles.${role}`, message: `Invalid selector for role ${role}` });
      continue;
    }
    const misused = findMisusedRoleThinkingSuffix(selector);
    if (misused) {
      diagnostics.push({
        severity: "warning",
        code: "settings.role-thinking-suffix",
        path: `modelRoles.${role}`,
        message: `Role ${role} ends in ":${misused}", which OMP does not accept as a role suffix (use ${ROLE_THINKING_LEVELS.join(", ")}); it is being read as part of the model id`,
      });
    }
  }
  if (value.modelProviderOrder !== undefined && (!Array.isArray(value.modelProviderOrder) || value.modelProviderOrder.some((item) => typeof item !== "string" || !item.trim()))) {
    diagnostics.push({ severity: "error", code: "settings.modelProviderOrder", message: "modelProviderOrder must be a non-empty string array" });
  }
  if (value.enabledModels !== undefined && (!Array.isArray(value.enabledModels) || value.enabledModels.some((item) => (typeof item === "string" && !item.trim()) || (typeof item !== "string" && !isRecord(item))))) {
    diagnostics.push({ severity: "error", code: "settings.enabledModels", message: "enabledModels must contain non-empty strings or scoped mappings" });
  } else {
    validateScopedRules(value.enabledModels, "enabledModels", "models", diagnostics);
  }
  validateScopedRules(value.disabledProviders, "disabledProviders", "providers", diagnostics);
  for (const [index, rule] of (Array.isArray(value.disabledProviders) ? value.disabledProviders : []).entries()) {
    // A typo here silently keeps a provider enabled, so name the unknown id even though OMP's own
    // built-in catalog is larger than the ids this app can see.
    const named = typeof rule === "string" ? [rule] : [];
    for (const id of named) {
      const known = DISCOVERY_SOURCE_IDS.has(id) || BUILTIN_PROVIDER_IDS.has(id) || (providerIds ? Array.from(providerIds).includes(id) : false);
      if (!known) {
        diagnostics.push({ severity: "warning", code: "settings.disabledProviders-unknown", path: `disabledProviders.${index}`, message: `"${id}" is neither a configured provider nor a known discovery source; it may be a typo` });
      }
    }
  }
  if (value.defaultThinkingLevel !== undefined && !SETTINGS_THINKING_LEVELS.includes(value.defaultThinkingLevel)) {
    diagnostics.push({ severity: "error", code: "settings.defaultThinkingLevel", message: `Unsupported thinking level: ${value.defaultThinkingLevel}. OMP accepts ${SETTINGS_THINKING_LEVELS.join(", ")}` });
  }
  if (value.unexpectedStopDetection !== undefined && !UNEXPECTED_STOP_MODES.includes(value.unexpectedStopDetection as UnexpectedStopMode)) {
    diagnostics.push({ severity: "error", code: "settings.unexpectedStopDetection", message: `Unsupported unexpectedStopDetection: ${value.unexpectedStopDetection}. OMP accepts ${UNEXPECTED_STOP_MODES.join(", ")}` });
  }
  if (value.updateChannel !== undefined && !UPDATE_CHANNELS.includes(value.updateChannel as UpdateChannel)) {
    diagnostics.push({ severity: "error", code: "settings.updateChannel", message: `Unsupported updateChannel: ${value.updateChannel}. OMP accepts ${UPDATE_CHANNELS.join(", ")}` });
  }
  validateCompaction(value.compaction, diagnostics);
  if (value.extendedContext !== undefined && typeof value.extendedContext !== "boolean") {
    diagnostics.push({ severity: "error", code: "settings.extendedContext", message: "extendedContext must be a boolean" });
  }
  if (value.externalThinking !== undefined && typeof value.externalThinking !== "boolean") {
    diagnostics.push({ severity: "error", code: "settings.externalThinking", message: "externalThinking must be a boolean" });
  }
  if (value.personality !== undefined && !PERSONALITY_PRESETS.includes(value.personality as PersonalityPreset)) {
    diagnostics.push({ severity: "error", code: "settings.personality", message: `Unsupported personality: ${value.personality}. OMP accepts ${PERSONALITY_PRESETS.join(", ")}` });
  }
  if (value.images !== undefined) {
    if (!isRecord(value.images)) {
      diagnostics.push({ severity: "error", code: "settings.images", message: "images must be a mapping" });
    } else if (value.images.urls !== undefined) {
      if (!isRecord(value.images.urls)) {
        diagnostics.push({ severity: "error", code: "settings.images.urls", message: "images.urls must be a mapping" });
      } else if (value.images.urls.enabled !== undefined && typeof value.images.urls.enabled !== "boolean") {
        diagnostics.push({ severity: "error", code: "settings.images.urls.enabled", message: "images.urls.enabled must be a boolean" });
      }
    }
  }
  return diagnostics;
}

/**
 * `compaction` (OMP v17.4.0+) is a mapping of tuning keys. `strategy`/`remoteEnabled` were replaced
 * by `methodOrder`; validating both shapes lets this app read files an older OMP wrote without
 * flagging the deprecated keys as errors (they are simply ignored by current OMP).
 */
function validateCompaction(value: SettingsDocument["compaction"], diagnostics: Diagnostic[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    diagnostics.push({ severity: "error", code: "settings.compaction", message: "compaction must be a mapping" });
    return;
  }
  for (const key of ["enabled", "midTurnEnabled", "asyncEnabled", "autoContinue"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      diagnostics.push({ severity: "error", code: "settings.compaction", path: `compaction.${key}`, message: `compaction.${key} must be a boolean` });
    }
  }
  for (const key of ["thresholdPercent", "thresholdTokens", "reserveTokens", "keepRecentTokens"]) {
    if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) {
      diagnostics.push({ severity: "error", code: "settings.compaction", path: `compaction.${key}`, message: `compaction.${key} must be a number` });
    }
  }
  if (value.methodOrder !== undefined && (!Array.isArray(value.methodOrder) || value.methodOrder.some((item) => typeof item !== "string" || !item.trim()))) {
    diagnostics.push({ severity: "error", code: "settings.compaction.methodOrder", message: "compaction.methodOrder must be a non-empty string array" });
  }
}
