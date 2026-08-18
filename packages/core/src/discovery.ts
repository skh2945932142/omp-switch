import { DiscoveryModel, DiscoveryResult } from "./domain";

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
}

function resolveModelsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  if (/\/models$/i.test(normalized)) return normalized;
  if (/\/v1$/i.test(normalized)) return `${normalized}/models`;
  return `${normalized}/v1/models`;
}

export async function discoverOpenAIModels(options: DiscoverOptions): Promise<DiscoveryResult> {
  const endpoint = resolveModelsEndpoint(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  const startedAt = Date.now();
  try {
    const headers = new Headers(options.headers);
    headers.set("accept", "application/json");
    if (options.apiKey && !headers.has("authorization")) headers.set("authorization", `Bearer ${options.apiKey}`);
    const response = await fetchImpl(endpoint, { method: "GET", headers, signal: controller.signal });
    if (response.status === 401 || response.status === 403) throw new DiscoveryError("discovery.auth", "The provider rejected the API key", response.status);
    if (response.status === 404 || response.status === 405) throw new DiscoveryError("discovery.endpoint", "The provider does not expose an OpenAI-compatible /models endpoint", response.status);
    if (!response.ok) throw new DiscoveryError("discovery.http", `Provider returned HTTP ${response.status}`, response.status);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DiscoveryError("discovery.parse", "Provider returned invalid JSON");
    }
    const rawModels = (payload as { data?: unknown })?.data;
    if (!Array.isArray(rawModels)) throw new DiscoveryError("discovery.shape", "Response does not contain a data array");
    const models: DiscoveryModel[] = rawModels
      .filter((model): model is Record<string, unknown> => typeof model === "object" && model !== null)
      .map((model) => ({
        id: typeof model.id === "string" ? model.id : "",
        name: typeof model.name === "string" ? model.name : undefined,
        created: typeof model.created === "number" ? model.created : undefined,
        ownedBy: typeof model.owned_by === "string" ? model.owned_by : undefined,
      }))
      .filter((model) => model.id.length > 0);
    if (models.length === 0) throw new DiscoveryError("discovery.empty", "Provider returned an empty model list");
    return { models, endpoint, durationMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof DiscoveryError) throw error;
    if ((error as Error).name === "AbortError") throw new DiscoveryError("discovery.timeout", "Provider did not respond before the timeout");
    throw new DiscoveryError("discovery.network", (error as Error).message || "Unable to reach provider");
  } finally {
    clearTimeout(timeout);
  }
}
