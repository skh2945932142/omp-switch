import { DiscoveryModel, DiscoveryResult } from "./domain";

export type DiscoveryType = "ollama" | "llama.cpp" | "lm-studio" | "openai-models-list" | "proxy" | "litellm";

export class DiscoveryError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(message);
    this.name = "DiscoveryError";
  }
}

export interface DiscoverOptions {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  type?: DiscoveryType;
}

function trimTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function resolveModelsEndpoint(baseUrl: string): string {
  const normalized = trimTrailingSlash(baseUrl);
  if (/\/models$/i.test(normalized)) return normalized;
  if (/\/v1$/i.test(normalized)) return `${normalized}/models`;
  return `${normalized}/v1/models`;
}

function resolveOllamaEndpoint(baseUrl: string): string {
  const normalized = trimTrailingSlash(baseUrl).replace(/\/v1$/i, "");
  return `${normalized}/api/tags`;
}

function normalizeModels(items: unknown[]): DiscoveryModel[] {
  return items
    .filter((model): model is Record<string, unknown> => typeof model === "object" && model !== null)
    .map((model) => ({
      id: typeof model.id === "string" ? model.id : typeof model.model === "string" ? model.model : typeof model.name === "string" ? model.name : "",
      name: typeof model.name === "string" ? model.name : undefined,
      created: typeof model.created === "number" ? model.created : undefined,
      ownedBy: typeof model.owned_by === "string" ? model.owned_by : typeof model.ownedBy === "string" ? model.ownedBy : undefined,
    }))
    .filter((model) => model.id.length > 0);
}

function extractModels(type: DiscoveryType, payload: unknown): DiscoveryModel[] {
  if (!payload || typeof payload !== "object") throw new DiscoveryError("discovery.shape", "Response must be a JSON object");
  const record = payload as Record<string, unknown>;
  const candidates = type === "ollama"
    ? record.models
    : Array.isArray(record.data)
      ? record.data
      : Array.isArray(record.models)
        ? record.models
        : undefined;
  if (!Array.isArray(candidates)) throw new DiscoveryError("discovery.shape", "Response does not contain a model array");
  const models = normalizeModels(candidates);
  if (models.length === 0) throw new DiscoveryError("discovery.empty", "Provider returned an empty model list");
  return models;
}

async function fetchDiscoveryPayload(endpoint: string, options: DiscoverOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const headers = new Headers(options.headers);
    headers.set("accept", "application/json");
    if (options.apiKey && !headers.has("authorization")) headers.set("authorization", `Bearer ${options.apiKey}`);
    const response = await fetchImpl(endpoint, { method: "GET", headers, signal: controller.signal });
    if (response.status === 401 || response.status === 403) throw new DiscoveryError("discovery.auth", "The provider rejected the API key", response.status);
    if (response.status === 404 || response.status === 405) throw new DiscoveryError("discovery.endpoint", "The provider does not expose the requested discovery endpoint", response.status);
    if (!response.ok) throw new DiscoveryError("discovery.http", `Provider returned HTTP ${response.status}`, response.status);
    try {
      return await response.json();
    } catch {
      throw new DiscoveryError("discovery.parse", "Provider returned invalid JSON");
    }
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    if ((error as Error).name === "AbortError") throw new DiscoveryError("discovery.timeout", "Provider did not respond before the timeout");
    throw new DiscoveryError("discovery.network", (error as Error).message || "Unable to reach provider");
  } finally {
    clearTimeout(timeout);
  }
}

function validateBaseUrl(baseUrl: string): void {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new DiscoveryError("discovery.endpoint", "baseUrl must be a non-empty string");
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new DiscoveryError("discovery.endpoint", "Invalid baseUrl format");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DiscoveryError("discovery.endpoint", `Unsupported baseUrl protocol: ${parsed.protocol}`);
  }
}

export async function discoverModels(options: DiscoverOptions): Promise<DiscoveryResult> {
  validateBaseUrl(options.baseUrl);
  const type = options.type ?? "openai-models-list";
  const endpoint = type === "ollama" ? resolveOllamaEndpoint(options.baseUrl) : resolveModelsEndpoint(options.baseUrl);
  const startedAt = Date.now();
  const payload = await fetchDiscoveryPayload(endpoint, options);
  return { models: extractModels(type, payload), endpoint, durationMs: Date.now() - startedAt, type };
}

export async function discoverOpenAIModels(options: DiscoverOptions): Promise<DiscoveryResult> {
  return discoverModels({ ...options, type: "openai-models-list" });
}
