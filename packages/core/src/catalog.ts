import type { CatalogModel, ProviderPreset } from "./domain";
import { THINKING_PROFILES } from "./thinking-profiles";

export interface CatalogBundle {
  version: 1;
  source: string;
  entries: ProviderPreset[];
}

const VERSION = "0.8.0";

function model(
  providerId: string,
  id: string,
  name: string,
  options: Partial<Omit<CatalogModel, "id" | "name" | "providerId">> = {},
): CatalogModel {
  return {
    providerId,
    id,
    name,
    source: "built-in",
    ...options,
  };
}

function preset(
  id: string,
  label: string,
  baseUrl: string,
  api: string,
  category: string,
  options: Partial<Pick<ProviderPreset, "auth" | "discovery" | "requiresBaseUrl" | "models" | "headers" | "compat" | "websiteUrl" | "apiKeyUrl">> = {},
): ProviderPreset {
  return { id, label, baseUrl, api, category, source: "built-in", version: VERSION, ...options };
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  // 1. Hosted International
  preset("openai", "OpenAI", "https://api.openai.com/v1", "openai-responses", "Hosted", {
    auth: "apiKey",
    discovery: { type: "openai-models-list" },
    websiteUrl: "https://openai.com",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    models: [
      model("openai", "gpt-5.6", "GPT-5.6", { reasoning: true, contextWindow: 200000, maxTokens: 32768, thinkingLevelMap: THINKING_PROFILES.openaiResponsesGpt56.map }),
      model("openai", "gpt-5.2", "GPT-5.2", { reasoning: true, contextWindow: 200000, maxTokens: 32768, thinkingLevelMap: THINKING_PROFILES.openaiResponsesGpt52To55.map }),
      model("openai", "gpt-5.1", "GPT-5.1", { reasoning: true, contextWindow: 200000, maxTokens: 32768, thinkingLevelMap: THINKING_PROFILES.openaiResponsesGpt51.map }),
      model("openai", "gpt-5", "GPT-5", { reasoning: true, contextWindow: 200000, maxTokens: 32768, thinkingLevelMap: THINKING_PROFILES.openaiResponsesGpt5.map }),
      model("openai", "gpt-4o", "GPT-4o", { reasoning: false, contextWindow: 128000, maxTokens: 4096 }),
      model("openai", "gpt-4o-mini", "GPT-4o mini", { reasoning: false, contextWindow: 128000, maxTokens: 4096 }),
      model("openai", "o3", "o3", { reasoning: true, contextWindow: 200000, maxTokens: 100000, thinkingLevelMap: THINKING_PROFILES.xhighAndMax.map }),
      model("openai", "o3-mini", "o3-mini", { reasoning: true, contextWindow: 200000, maxTokens: 100000, thinkingLevelMap: THINKING_PROFILES.lowMediumHighOnly.map }),
    ],
  }),
  preset("openai-codex", "OpenAI Codex", "https://api.openai.com/v1", "openai-codex-responses", "Hosted", { auth: "oauth", websiteUrl: "https://openai.com" }),
  preset("anthropic", "Anthropic", "https://api.anthropic.com", "anthropic-messages", "Hosted", {
    auth: "apiKey",
    websiteUrl: "https://anthropic.com",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    models: [
      model("anthropic", "claude-opus-5.5", "Claude 5.5 Opus", { reasoning: true, contextWindow: 200000, maxTokens: 16384, thinkingLevelMap: THINKING_PROFILES.offUnsupportedXhighAndMax.map }),
      model("anthropic", "claude-sonnet-4.5", "Claude 4.5 Sonnet", { reasoning: true, contextWindow: 200000, maxTokens: 8192, thinkingLevelMap: THINKING_PROFILES.xhighAndMax.map }),
      model("anthropic", "claude-3-7-sonnet", "Claude 3.7 Sonnet", { reasoning: true, contextWindow: 200000, maxTokens: 8192, thinkingLevelMap: THINKING_PROFILES.xhighAndMax.map }),
      model("anthropic", "claude-3-5-sonnet", "Claude 3.5 Sonnet", { reasoning: false, contextWindow: 200000, maxTokens: 8192 }),
      model("anthropic", "claude-3-5-haiku", "Claude 3.5 Haiku", { reasoning: false, contextWindow: 200000, maxTokens: 8192 }),
    ],
  }),
  preset("google-ai-studio", "Google AI Studio", "https://generativelanguage.googleapis.com/v1beta/openai", "openai-completions", "Hosted", {
    auth: "apiKey",
    websiteUrl: "https://aistudio.google.com",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    models: [
      model("google-ai-studio", "gemini-2.5-pro", "Gemini 2.5 Pro", { reasoning: true, contextWindow: 1000000, maxTokens: 8192, thinkingLevelMap: THINKING_PROFILES.geminiLowHigh.map }),
      model("google-ai-studio", "gemini-2.5-flash", "Gemini 2.5 Flash", { reasoning: true, contextWindow: 1000000, maxTokens: 8192, thinkingLevelMap: THINKING_PROFILES.geminiLowHigh.map }),
      model("google-ai-studio", "gemini-2.0-flash", "Gemini 2.0 Flash", { reasoning: false, contextWindow: 1000000, maxTokens: 8192 }),
    ],
  }),
  preset("google-vertex", "Google Vertex AI", "", "google-vertex", "Hosted", { auth: "oauth", requiresBaseUrl: true }),
  preset("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "openai-completions", "Hosted", {
    auth: "apiKey",
    discovery: { type: "openai-models-list" },
    websiteUrl: "https://deepseek.com",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    models: [
      model("deepseek", "deepseek-reasoner", "DeepSeek-R1", { reasoning: true, contextWindow: 64000, maxTokens: 8192, thinkingLevelMap: THINKING_PROFILES.deepseekV4.map }),
      model("deepseek", "deepseek-chat", "DeepSeek-V3", { reasoning: false, contextWindow: 64000, maxTokens: 8192 }),
    ],
  }),
  preset("groq", "Groq", "https://api.groq.com/openai/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" }, websiteUrl: "https://groq.com" }),
  preset("together", "Together AI", "https://api.together.xyz/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" }, websiteUrl: "https://together.ai" }),
  preset("fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" }, websiteUrl: "https://fireworks.ai" }),
  preset("deepinfra", "DeepInfra", "https://api.deepinfra.com/v1/openai", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" }, websiteUrl: "https://deepinfra.com" }),
  preset("mistral", "Mistral AI", "https://api.mistral.ai/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" }, websiteUrl: "https://mistral.ai" }),
  preset("xai", "xAI", "https://api.x.ai/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" }, websiteUrl: "https://x.ai" }),
  preset("perplexity", "Perplexity", "https://api.perplexity.ai", "openai-completions", "Hosted", { auth: "apiKey", websiteUrl: "https://perplexity.ai" }),
  preset("cohere", "Cohere", "https://api.cohere.com/compatibility/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" }, websiteUrl: "https://cohere.com" }),
  preset("ai21", "AI21", "https://api.ai21.com/studio/v1", "openai-completions", "Hosted", { auth: "apiKey", websiteUrl: "https://ai21.com" }),
  preset("cerebras", "Cerebras", "https://api.cerebras.ai/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" }, websiteUrl: "https://cerebras.ai" }),
  preset("sambanova", "SambaNova", "https://api.sambanova.ai/v1", "openai-completions", "Hosted", { auth: "apiKey", websiteUrl: "https://sambanova.ai" }),
  preset("nvidia-nim", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1", "openai-completions", "Hosted", { auth: "apiKey", discovery: { type: "openai-models-list" }, websiteUrl: "https://build.nvidia.com" }),
  preset("replicate", "Replicate", "", "openai-completions", "Hosted", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://replicate.com" }),
  preset("cloudflare-workers-ai", "Cloudflare Workers AI", "", "openai-completions", "Hosted", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://ai.cloudflare.com" }),
  preset("azure-openai", "Azure OpenAI", "", "azure-openai-responses", "Hosted", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://azure.microsoft.com" }),
  preset("amazon-bedrock", "Amazon Bedrock", "", "bedrock-converse-stream", "Hosted", { auth: "oauth", requiresBaseUrl: true, websiteUrl: "https://aws.amazon.com/bedrock" }),
  preset("github-models", "GitHub Models", "https://models.inference.ai.azure.com", "openai-completions", "Hosted", { auth: "apiKey", websiteUrl: "https://github.com/marketplace/models" }),

  // 2. Regional (CN & Special)
  preset("dashscope", "Alibaba DashScope", "https://dashscope.aliyuncs.com/compatible-mode/v1", "openai-completions", "Regional", {
    auth: "apiKey",
    discovery: { type: "openai-models-list" },
    websiteUrl: "https://bailian.console.aliyun.com",
    models: [
      model("dashscope", "qwen-max", "Qwen Max", { reasoning: false, contextWindow: 32000, maxTokens: 8192 }),
      model("dashscope", "qwen-plus", "Qwen Plus", { reasoning: false, contextWindow: 128000, maxTokens: 8192 }),
      model("dashscope", "qwq-32b-preview", "QwQ 32B Preview", { reasoning: true, contextWindow: 32000, maxTokens: 8192, thinkingLevelMap: THINKING_PROFILES.xhighAndMax.map }),
    ],
  }),
  preset("siliconflow", "SiliconFlow", "https://api.siliconflow.com/v1", "openai-completions", "Regional", {
    auth: "apiKey",
    discovery: { type: "openai-models-list" },
    websiteUrl: "https://siliconflow.com",
    apiKeyUrl: "https://cloud.siliconflow.com/account/ak",
    models: [
      model("siliconflow", "deepseek-ai/DeepSeek-R1", "DeepSeek R1 (SiliconFlow)", { reasoning: true, contextWindow: 64000, maxTokens: 8192, thinkingLevelMap: THINKING_PROFILES.deepseekV4.map }),
      model("siliconflow", "deepseek-ai/DeepSeek-V3", "DeepSeek V3 (SiliconFlow)", { reasoning: false, contextWindow: 64000, maxTokens: 8192 }),
    ],
  }),
  preset("siliconflow-cn", "SiliconFlow CN", "https://api.siliconflow.cn/v1", "openai-completions", "Regional", {
    auth: "apiKey",
    discovery: { type: "openai-models-list" },
    websiteUrl: "https://siliconflow.cn",
    apiKeyUrl: "https://cloud.siliconflow.cn/account/ak",
  }),
  preset("zhipu", "Zhipu AI", "https://open.bigmodel.cn/api/paas/v4", "openai-completions", "Regional", {
    auth: "apiKey",
    websiteUrl: "https://bigmodel.cn",
    models: [
      model("zhipu", "glm-4-plus", "GLM-4-Plus", { reasoning: false, contextWindow: 128000, maxTokens: 4096 }),
      model("zhipu", "glm-4-air", "GLM-4-Air", { reasoning: false, contextWindow: 128000, maxTokens: 4096 }),
      model("zhipu", "glm-zero-preview", "GLM-Zero-Preview", { reasoning: true, contextWindow: 128000, maxTokens: 8192, thinkingLevelMap: THINKING_PROFILES.openCodeGoGlm52.map }),
    ],
  }),
  preset("moonshot", "Moonshot", "https://api.moonshot.cn/v1", "openai-completions", "Regional", {
    auth: "apiKey",
    discovery: { type: "openai-models-list" },
    websiteUrl: "https://platform.moonshot.cn",
    models: [
      model("moonshot", "moonshot-v1-128k", "Moonshot v1 128k", { reasoning: false, contextWindow: 128000, maxTokens: 4096 }),
    ],
  }),
  preset("kimi-coding", "Kimi For Coding", "https://api.kimi.com/coding", "anthropic-messages", "Regional", {
    auth: "apiKey",
    websiteUrl: "https://www.kimi.com/code",
    apiKeyUrl: "https://platform.kimi.com/console/api-keys",
    models: [
      model("kimi-coding", "kimi-k1.5", "Kimi k1.5", { reasoning: true, contextWindow: 128000, maxTokens: 8192, thinkingLevelMap: THINKING_PROFILES.kimi3.map }),
    ],
  }),
  preset("kimi-coding-global", "Kimi For Coding Global", "https://api.kimi.ai/coding", "anthropic-messages", "Hosted", {
    auth: "apiKey",
    websiteUrl: "https://www.kimi.ai/code",
    apiKeyUrl: "https://www.kimi.ai/code",
  }),
  preset("ppio", "PPIO AI", "https://api.ppinfra.com/v3/openai", "openai-completions", "Regional", {
    auth: "apiKey",
    websiteUrl: "https://ppinfra.com",
    models: [
      model("ppio", "deepseek/deepseek-r1", "DeepSeek R1 (PPIO)", { reasoning: true, contextWindow: 64000, maxTokens: 8192, thinkingLevelMap: THINKING_PROFILES.deepseekV4.map }),
      model("ppio", "deepseek/deepseek-v3", "DeepSeek V3 (PPIO)", { reasoning: false, contextWindow: 64000, maxTokens: 8192 }),
    ],
  }),
  preset("minimax", "MiniMax", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://minimaxi.com" }),
  preset("baichuan", "Baichuan", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://baichuan-ai.com" }),
  preset("yi", "01.AI", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://01.ai" }),
  preset("volcengine-ark", "Volcengine Ark", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://volcengine.com" }),
  preset("tencent-hunyuan", "Tencent Hunyuan", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://cloud.tencent.com/product/hunyuan" }),
  preset("baidu-qianfan", "Baidu Qianfan", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://cloud.baidu.com/product/wenxinworkshop" }),
  preset("baidu-qianfan-coding", "Baidu Qianfan Coding Plan", "https://qianfan.baidubce.com/v2", "openai-completions", "Regional", { auth: "apiKey", websiteUrl: "https://cloud.baidu.com/product/wenxinworkshop" }),
  preset("stepfun", "StepFun", "", "openai-completions", "Regional", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://stepfun.com" }),
  preset("stepfun-plan", "StepFun Step Plan", "https://api.stepfun.com/v1", "openai-completions", "Regional", { auth: "apiKey", websiteUrl: "https://stepfun.com" }),
  preset("shengsuanyun", "ShengsuanYun", "https://api.shengsuan.cloud/v1", "openai-completions", "Regional", { auth: "apiKey", websiteUrl: "https://shengsuan.cloud" }),
  preset("qiniu", "Qiniu AI", "https://api.qiniu.com/v1", "openai-completions", "Regional", { auth: "apiKey", websiteUrl: "https://qiniu.com" }),

  // 3. Gateway & Router
  preset("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "openai-completions", "Gateway", {
    auth: "apiKey",
    discovery: { type: "openai-models-list" },
    websiteUrl: "https://openrouter.ai",
    apiKeyUrl: "https://openrouter.ai/keys",
  }),
  preset("aihubmix", "AIHubMix", "https://aihubmix.com/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://aihubmix.com" }),
  preset("302-ai", "302.AI", "https://api.302.ai/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://302.ai" }),
  preset("packy-code", "PackyCode", "https://www.packyapi.ai", "anthropic-messages", "Gateway", { auth: "apiKey", websiteUrl: "https://www.packyapi.ai" }),
  preset("zeta-api", "ZetaAPI", "https://api.zetaapi.ai/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://zetaapi.ai" }),
  preset("apinebula", "APINebula", "https://apinebula.ai/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://apinebula.ai" }),
  preset("aicode-mirror", "AICodeMirror", "https://api.aicodemirror.ai/api/claudecode", "anthropic-messages", "Gateway", { auth: "apiKey", websiteUrl: "https://www.aicodemirror.ai" }),
  preset("fenno-ai", "FennoAI", "https://api.fenno.ai/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://api.fenno.ai" }),
  preset("run-api", "RunAPI", "https://runapi.co", "anthropic-messages", "Gateway", { auth: "apiKey", websiteUrl: "https://runapi.co" }),
  preset("aigo-code", "AiGo Code", "https://api.aigocode.com/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://aigocode.com" }),
  preset("aicoding", "AICoding", "https://api.aicoding.com/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://aicoding.com" }),
  preset("sub-router", "SubRouter", "https://api.subrouter.com/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://subrouter.com" }),
  preset("sub2api", "Sub2API", "https://api.sub2api.com/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://sub2api.com" }),
  preset("cherry-in", "CherryIN", "https://api.cherryin.ai/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://cherryin.ai" }),
  preset("deepbricks", "DeepBricks", "https://api.deepbricks.ai/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://deepbricks.ai" }),
  preset("cubox", "Cubox AI", "https://api.cubox.pro/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://cubox.pro" }),
  preset("ailink", "AILink", "https://api.ailink.pro/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://ailink.pro" }),
  preset("aigoapi", "AIGoAPI", "https://api.aigoapi.com/v1", "openai-completions", "Gateway", { auth: "apiKey", websiteUrl: "https://aigoapi.com" }),
  preset("litellm", "LiteLLM", "http://127.0.0.1:4000/v1", "openai-completions", "Gateway", { auth: "apiKey", discovery: { type: "litellm" }, websiteUrl: "https://litellm.ai" }),
  preset("portkey", "Portkey", "", "openai-completions", "Gateway", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://portkey.ai" }),
  preset("helicone", "Helicone", "", "openai-completions", "Gateway", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://helicone.ai" }),
  preset("kong-ai-gateway", "Kong AI Gateway", "", "openai-completions", "Gateway", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://konghq.com" }),
  preset("cloudflare-ai-gateway", "Cloudflare AI Gateway", "", "openai-completions", "Gateway", { auth: "apiKey", requiresBaseUrl: true, websiteUrl: "https://developers.cloudflare.com/ai-gateway/" }),
  preset("azure-api-management", "Azure API Management", "", "openai-completions", "Gateway", { auth: "apiKey", requiresBaseUrl: true }),

  // 4. Local Execution
  preset("ollama", "Ollama", "http://127.0.0.1:11434/v1", "openai-responses", "Local", { auth: "none", discovery: { type: "ollama" }, websiteUrl: "https://ollama.com" }),
  preset("lm-studio", "LM Studio", "http://127.0.0.1:1234/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "lm-studio" }, websiteUrl: "https://lmstudio.ai" }),
  preset("llama-cpp", "llama.cpp", "http://127.0.0.1:8080/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "llama.cpp" } }),
  preset("vllm", "vLLM", "http://127.0.0.1:8000/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "openai-models-list" } }),
  preset("localai", "LocalAI", "http://127.0.0.1:8080/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "openai-models-list" } }),
  preset("open-webui", "Open WebUI", "http://127.0.0.1:3000/api", "openai-completions", "Local", { auth: "apiKey", requiresBaseUrl: true }),
  preset("jan", "Jan", "http://127.0.0.1:1337/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "openai-models-list" } }),
  preset("fastchat", "FastChat", "http://127.0.0.1:8000/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "openai-models-list" } }),
  preset("text-generation-webui", "Text Generation WebUI", "", "openai-completions", "Local", { auth: "none", requiresBaseUrl: true }),
  preset("koboldcpp", "KoboldCpp", "", "openai-completions", "Local", { auth: "none", requiresBaseUrl: true }),
  preset("tabbyapi", "TabbyAPI", "", "openai-completions", "Local", { auth: "apiKey", requiresBaseUrl: true }),
  preset("tgi", "Text Generation Inference", "", "openai-completions", "Local", { auth: "none", requiresBaseUrl: true }),
  preset("sglang", "SGLang", "http://127.0.0.1:30000/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "openai-models-list" } }),
  preset("apple-foundation-models", "Apple Foundation Models", "http://127.0.0.1:10000/v1", "openai-completions", "Local", { auth: "none", discovery: { type: "apple-foundation-models" } }),

  // 5. Template
  preset("openai-compatible", "OpenAI-compatible", "https://api.example.com/v1", "openai-completions", "Template", { auth: "apiKey", discovery: { type: "openai-models-list" } }),
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
