import { Diagnostic, ModelsDocument, OmpProvider, SettingsDocument } from "./domain";

const DISCOVERY_TYPES = new Set(["ollama", "llama.cpp", "lm-studio", "openai-models-list", "proxy", "litellm"]);
const THINKING_LEVELS = "(?:off|minimal|low|medium|high|xhigh)";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateRoleSelector(selector: string): boolean {
  const thinkingSuffix = `(?::${THINKING_LEVELS})?`;
  if (new RegExp(`^\\*${thinkingSuffix}$`).test(selector)) return true;
  if (new RegExp(`^@[A-Za-z0-9._-]+${thinkingSuffix}$`).test(selector)) return true;
  return new RegExp(`^[A-Za-z0-9._-]+/[A-Za-z0-9._:@+\\-]+${thinkingSuffix}$`).test(selector);
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
    const models = Array.isArray(provider.models) ? provider.models : [];
    if (models.length > 0) {
      if (!provider.baseUrl) diagnostics.push({ severity: "error", code: "provider.baseUrl", path: `providers.${providerId}.baseUrl`, message: `Provider ${providerId} needs baseUrl when defining models` });
      if (!provider.api && !models.every((model) => typeof model?.api === "string")) diagnostics.push({ severity: "error", code: "provider.api", path: `providers.${providerId}.api`, message: `Provider ${providerId} needs api at provider or model level` });
      if (!provider.apiKey && provider.auth !== "none") diagnostics.push({ severity: "error", code: "provider.apiKey", path: `providers.${providerId}.apiKey`, message: `Provider ${providerId} needs apiKey unless auth is none` });
    }
    if (provider.discovery?.type && !DISCOVERY_TYPES.has(provider.discovery.type)) {
      diagnostics.push({ severity: "error", code: "provider.discovery", path: `providers.${providerId}.discovery.type`, message: `Unsupported discovery type: ${provider.discovery.type}` });
    }
    if (provider.discovery?.timeoutMs !== undefined && (!Number.isFinite(provider.discovery.timeoutMs) || provider.discovery.timeoutMs <= 0)) {
      diagnostics.push({ severity: "error", code: "provider.discovery-timeout", path: `providers.${providerId}.discovery.timeoutMs`, message: "Discovery timeout must be positive" });
    }
    if (provider.headers && !isRecord(provider.headers)) {
      diagnostics.push({ severity: "error", code: "provider.headers", path: `providers.${providerId}.headers`, message: "Provider headers must be a mapping" });
    }
    for (const [index, model] of models.entries()) {
      if (!model || typeof model.id !== "string" || model.id.trim() === "") {
        diagnostics.push({ severity: "error", code: "model.id", path: `providers.${providerId}.models.${index}.id`, message: "Every model needs an id" });
      }
      if (model.contextWindow !== undefined && (!Number.isFinite(model.contextWindow) || model.contextWindow <= 0)) {
        diagnostics.push({ severity: "error", code: "model.contextWindow", path: `providers.${providerId}.models.${index}.contextWindow`, message: "contextWindow must be positive" });
      }
      if (model.maxTokens !== undefined && (!Number.isFinite(model.maxTokens) || model.maxTokens <= 0)) {
        diagnostics.push({ severity: "error", code: "model.maxTokens", path: `providers.${providerId}.models.${index}.maxTokens`, message: "maxTokens must be positive" });
      }
    }
  }
  return diagnostics;
}

export function validateSettingsDocument(value: SettingsDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (value.modelRoles && !isRecord(value.modelRoles)) {
    diagnostics.push({ severity: "error", code: "settings.modelRoles", message: "modelRoles must be a mapping" });
  }
  for (const [role, selector] of Object.entries(value.modelRoles ?? {})) {
    if (typeof selector !== "string" || !validateRoleSelector(selector)) {
      diagnostics.push({ severity: "error", code: "settings.role-selector", path: `modelRoles.${role}`, message: `Invalid selector for role ${role}` });
    }
  }
  return diagnostics;
}
