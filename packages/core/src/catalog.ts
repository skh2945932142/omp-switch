import type { ProviderPreset } from "./domain";

export interface CatalogBundle {
  version: 1;
  source: string;
  entries: ProviderPreset[];
}

const VERSION = "0.2.0";

function preset(
  id: string,
  label: string,
  baseUrl: string,
  api: string,
  category: string,
  options: Partial<Pick<ProviderPreset, "auth" | "discovery" | "requiresBaseUrl">> = {},
): ProviderPreset {
  return { id, label, baseUrl, api, category, source: "built-in", version: VERSION, ...options };
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  preset("openai", "OpenAI", "https://api.openai.com/v1", "openai-responses", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("openai-codex", "OpenAI Codex", "https://api.openai.com/v1", "openai-codex-responses", "Hosted", { auth: "oauth" }),
  preset("anthropic", "Anthropic", "https://api.anthropic.com", "anthropic-messages", "Hosted", { auth: "apiKey" }),
  preset("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "openai-completions", "Gateway", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("groq", "Groq", "https://api.groq.com/openai/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("together", "Together AI", "https://api.together.xyz/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("mistral", "Mistral AI", "https://api.mistral.ai/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("xai", "xAI", "https://api.x.ai/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("perplexity", "Perplexity", "https://api.perplexity.ai", "openai-completions", "Hosted", { auth: "apiKey" }),
  preset("cohere", "Cohere", "https://api.cohere.com/compatibility/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("ai21", "AI21", "https://api.ai21.com/studio/v1", "openai-completions", "Hosted", { auth: "apiKey" }),
  preset("cerebras", "Cerebras", "https://api.cerebras.ai/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("sambanova", "SambaNova", "https://api.sambanova.ai/v1", "openai-completions", "Hosted", { auth: "apiKey" }),
  preset("nvidia-nim", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("replicate", "Replicate", "", "openai-completions", "Hosted", { auth: "apiKey", requiresBaseUrl: true }),
  preset("cloudflare-workers-ai", "Cloudflare Workers AI", "", "openai-completions", "Hosted", { auth: "apiKey", requiresBaseUrl: true }),
  preset("google-ai-studio", "Google AI Studio", "https://generativelanguage.googleapis.com/v1beta/openai", "openai-completions", "Hosted", { auth: "apiKey" }),
  preset("google-vertex", "Google Vertex AI", "", "google-vertex", "Hosted", { auth: "oauth", requiresBaseUrl: true }),
  preset("azure-openai", "Azure OpenAI", "", "azure-openai-responses", "Hosted", { auth: "apiKey", requiresBaseUrl: true }),
  preset("amazon-bedrock", "Amazon Bedrock", "", "bedrock-converse-stream", "Hosted", { auth: "oauth", requiresBaseUrl: true }),
  preset("github-models", "GitHub Models", "https://models.inference.ai.azure.com", "openai-completions", "Hosted", { auth: "apiKey" }),
  preset("dashscope", "Alibaba DashScope", "https://dashscope.aliyuncs.com/compatible-mode/v1", "openai-completions", "Regional", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("siliconflow", "SiliconFlow", "https://api.siliconflow.cn/v1", "openai-completions", "Regional", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("zhipu", "Zhipu AI", "https://open.bigmodel.cn/api/paas/v4", "openai-completions", "Regional", { auth: "apiKey" }),
  preset("moonshot", "Moonshot", "https://api.moonshot.cn/v1", "openai-completions", "Regional", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("minimax", "MiniMax", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true }),
  preset("baichuan", "Baichuan", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true }),
  preset("yi", "01.AI", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true }),
  preset("volcengine-ark", "Volcengine Ark", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true }),
  preset("tencent-hunyuan", "Tencent Hunyuan", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true }),
  preset("baidu-qianfan", "Baidu Qianfan", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true }),
  preset("stepfun", "StepFun", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true }),
  preset("ollama", "Ollama", "http://127.0.0.1:11434/v1", "openai-responses", "Local", { auth: "none", discovery: { type: "ollama" } }),
  preset("lm-studio", "LM Studio", "http://127.0.0.1:1234/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "lm-studio" } }),
  preset("llama-cpp", "llama.cpp", "http://127.0.0.1:8080/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "llama.cpp" } }),
  preset("vllm", "vLLM", "http://127.0.0.1:8000/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "openai-models-list" } }),
  preset("localai", "LocalAI", "http://127.0.0.1:8080/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "openai-models-list" } }),
  preset("litellm", "LiteLLM", "http://127.0.0.1:4000/v1", "openai-completions", "Gateway", { auth: "apiKey", discovery: { type: "litellm" } }),
  preset("open-webui", "Open WebUI", "http://127.0.0.1:3000/api", "openai-completions", "Local", { auth: "apiKey", requiresBaseUrl: true }),
  preset("jan", "Jan", "http://127.0.0.1:1337/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "openai-models-list" } }),
  preset("fastchat", "FastChat", "http://127.0.0.1:8000/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "openai-models-list" } }),
  preset("text-generation-webui", "Text Generation WebUI", "", "openai-completions", "Local", { auth: "none", requiresBaseUrl: true }),
  preset("koboldcpp", "KoboldCpp", "", "openai-completions", "Local", { auth: "none", requiresBaseUrl: true }),
  preset("tabbyapi", "TabbyAPI", "", "openai-completions", "Local", { auth: "apiKey", requiresBaseUrl: true }),
  preset("tgi", "Text Generation Inference", "", "openai-completions", "Local", { auth: "none", requiresBaseUrl: true }),
  preset("sglang", "SGLang", "http://127.0.0.1:30000/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "openai-models-list" } }),
  preset("openai-compatible", "OpenAI-compatible", "https://api.example.com/v1", "openai-completions", "Template", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
  preset("portkey", "Portkey", "", "openai-completions", "Gateway", { auth: "apiKey", requiresBaseUrl: true }),
  preset("helicone", "Helicone", "", "openai-completions", "Gateway", { auth: "apiKey", requiresBaseUrl: true }),
  preset("kong-ai-gateway", "Kong AI Gateway", "", "openai-completions", "Gateway", { auth: "apiKey", requiresBaseUrl: true }),
  preset("cloudflare-ai-gateway", "Cloudflare AI Gateway", "", "openai-completions", "Gateway", { auth: "apiKey", requiresBaseUrl: true }),
  preset("azure-api-management", "Azure API Management", "", "openai-completions", "Gateway", { auth: "apiKey", requiresBaseUrl: true }),
];

export function listProviderPresets(query = ""): ProviderPreset[] {
  const normalized = query.trim().toLowerCase();
  return PROVIDER_PRESETS.filter((entry) => !normalized || `${entry.id} ${entry.label} ${entry.category ?? ""}`.toLowerCase().includes(normalized));
}

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((entry) => entry.id === id);
}

export function validateCatalogBundle(value: unknown): CatalogBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Catalog bundle must be an object");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.source !== "string" || !record.source.trim() || !Array.isArray(record.entries)) throw new Error("Unsupported catalog bundle");
  const entries: ProviderPreset[] = [];
  const seen = new Set<string>();
  for (const item of record.entries) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Catalog entry must be an object");
    const entry = item as Partial<ProviderPreset>;
    if (typeof entry.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.id) || seen.has(entry.id)) throw new Error("Catalog entry has a duplicate or invalid id");
    if (typeof entry.label !== "string" || typeof entry.baseUrl !== "string" || typeof entry.api !== "string" || typeof entry.source !== "string" || typeof entry.version !== "string") throw new Error(`Catalog entry ${entry.id} is incomplete`);
    if (entry.baseUrl && !/^https?:\/\//i.test(entry.baseUrl) && !/^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(entry.baseUrl)) throw new Error(`Catalog entry ${entry.id} has an invalid baseUrl`);
    seen.add(entry.id);
    entries.push({ ...entry } as ProviderPreset);
  }
  return { version: 1, source: record.source.trim(), entries };
}

export function mergeCatalogBundle(base: ProviderPreset[], bundle: CatalogBundle): ProviderPreset[] {
  const imported = new Map(bundle.entries.map((entry) => [entry.id, entry]));
  const merged = base.map((entry) => {
    const incoming = imported.get(entry.id);
    if (!incoming) return entry;
    const hasIncomingLabel = typeof incoming.label === "string" && incoming.label.trim() !== "";
    return {
      ...entry,
      ...incoming,
      label: hasIncomingLabel ? incoming.label.trim() : entry.label,
    };
  });
  for (const entry of bundle.entries) {
    if (!base.some((candidate) => candidate.id === entry.id)) {
      merged.push(entry);
    }
  }
  return merged;
}
