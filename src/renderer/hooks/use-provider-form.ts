import { useState } from "react";
import type { EffectiveConfig, OmpModel, OmpProvider, ProviderPreset, ConfigPatch } from "@omp-switch/core";
import i18n from "../i18n";

export const FALLBACK_PRESETS: Array<Pick<ProviderPreset, "id" | "label" | "baseUrl" | "api" | "auth" | "discovery">> = [
  { label: "Custom OpenAI-compatible", id: "", baseUrl: "https://api.example.com/v1", api: "openai-completions" },
  { label: "OpenAI", id: "openai", baseUrl: "https://api.openai.com/v1", api: "openai-responses" },
  { label: "OpenAI Codex", id: "openai", baseUrl: "https://api.openai.com/v1", api: "openai-codex-responses" },
  { label: "Anthropic", id: "anthropic", baseUrl: "https://api.anthropic.com", api: "anthropic-messages" },
  { label: "OpenRouter", id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", api: "openai-completions" },
  { label: "DeepSeek", id: "deepseek", baseUrl: "https://api.deepseek.com/v1", api: "openai-completions" },
  { label: "Groq", id: "groq", baseUrl: "https://api.groq.com/openai/v1", api: "openai-completions" },
  { label: "Together", id: "together", baseUrl: "https://api.together.xyz/v1", api: "openai-completions" },
  { label: "Fireworks", id: "fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", api: "openai-completions" },
  { label: "Ollama local", id: "ollama", baseUrl: "http://127.0.0.1:11434/v1", api: "openai-responses" },
  { label: "LM Studio local", id: "lm-studio", baseUrl: "http://127.0.0.1:1234/v1", api: "openai-completions" },
];

export type FormState = {
  id: string;
  baseUrl: string;
  api: string;
  auth: string;
  key: string;
  headers: string;
  compat: string;
  overrides: string;
  discoveryType: string;
  authHeader: boolean;
  disableStrictTools: boolean;
  transport: string;
  remoteCompaction: string;
  cost: string;
  codeMode: string;
};

export function blankForm(): FormState {
  return {
    id: "",
    baseUrl: "https://api.example.com/v1",
    api: "openai-completions",
    auth: "apiKey",
    key: "",
    headers: "",
    compat: "",
    overrides: "",
    discoveryType: "openai-models-list",
    authHeader: true,
    disableStrictTools: false,
    transport: "",
    remoteCompaction: "",
    cost: "",
    codeMode: "",
  };
}

export interface ModelEditorEntry {
  raw: OmpModel;
  id: string;
  name: string;
  api: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
  vision: boolean;
  headers: string;
  compat: string;
  transport: string;
  remoteCompaction: string;
  cost: string;
  imageInputDecoder: string;
  tokenizer: string;
}

export function formatJson(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return JSON.stringify(value, null, 2);
}

export function parseHeaders(raw: string): Record<string, string> | undefined {
  if (!raw.trim()) return undefined;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(i18n.t("models.headersMustBeObject"));
  return parsed as Record<string, string>;
}

export function parseObjectJson(label: string, raw: string): Record<string, unknown> | undefined {
  if (!raw.trim()) return undefined;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} ${i18n.t("models.mustBeObject")}`);
  return parsed as Record<string, unknown>;
}

export function parseModelOverrides(raw: string): Record<string, Record<string, unknown>> | undefined {
  if (!raw.trim()) return undefined;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(i18n.t("models.modelOverridesMustBeObject"));
  return parsed as Record<string, Record<string, unknown>>;
}

export function parseCost(raw: string): Record<string, number | Record<string, number>> | undefined {
  if (!raw.trim()) return undefined;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(i18n.t("models.costMustBeObject"));
  return parsed as Record<string, number | Record<string, number>>;
}

export function toModelEditorEntry(model: OmpModel): ModelEditorEntry {
  return {
    raw: model,
    id: model.id ?? "",
    name: model.name ?? "",
    api: model.api ?? "",
    contextWindow: model.contextWindow?.toString() ?? "",
    maxTokens: model.maxTokens?.toString() ?? "",
    reasoning: Boolean(model.reasoning),
    vision: Boolean(model.input?.includes("image")),
    headers: formatJson(model.headers),
    compat: formatJson(model.compat),
    transport: model.transport ?? "",
    remoteCompaction: formatJson(model.remoteCompaction),
    cost: formatJson(model.cost),
    imageInputDecoder: model.imageInputDecoder ?? "",
    tokenizer: typeof model.tokenizer === "string" ? model.tokenizer : "",
  };
}

export function createModelEditorEntry(): ModelEditorEntry {
  return {
    raw: { id: "" },
    id: "",
    name: "",
    api: "",
    contextWindow: "128000",
    maxTokens: "16384",
    reasoning: false,
    vision: false,
    headers: "",
    compat: "",
    transport: "",
    remoteCompaction: "",
    cost: "",
    imageInputDecoder: "",
    tokenizer: "",
  };
}

export function parseOptionalPositiveInteger(label: string, value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} ${i18n.t("models.positiveIntRequired")}`);
  return parsed;
}

export function buildModels(entries: ModelEditorEntry[]): OmpModel[] {
  return entries.map((entry, index) => {
    const id = entry.id.trim();
    if (!id) throw new Error(i18n.t("models.modelIdEmpty", { index: index + 1 }));
    const model: OmpModel = { ...entry.raw, id };
    const name = entry.name.trim();
    if (name) model.name = name;
    else delete model.name;
    const contextWindow = parseOptionalPositiveInteger(i18n.t("models.modelField", { id, field: "Context" }), entry.contextWindow);
    if (contextWindow === undefined) delete model.contextWindow;
    else model.contextWindow = contextWindow;
    const maxTokens = parseOptionalPositiveInteger(i18n.t("models.modelField", { id, field: "Max output" }), entry.maxTokens);
    if (maxTokens === undefined) delete model.maxTokens;
    else model.maxTokens = maxTokens;
    const api = entry.api.trim();
    if (api) model.api = api;
    else delete model.api;
    if (entry.reasoning) model.reasoning = true;
    else delete model.reasoning;
    const input = new Set(Array.isArray(model.input) ? model.input : []);
    input.add("text");
    if (entry.vision) input.add("image");
    else input.delete("image");
    model.input = Array.from(input);
    const headers = parseHeaders(entry.headers);
    if (headers) model.headers = headers;
    else delete model.headers;
    const compat = parseObjectJson(i18n.t("models.modelField", { id, field: "Compat" }), entry.compat);
    if (compat) model.compat = compat;
    else delete model.compat;
    const transport = entry.transport.trim();
    if (transport) model.transport = transport;
    else delete model.transport;
    const remoteCompaction = parseObjectJson(i18n.t("models.modelField", { id, field: "Remote compaction" }), entry.remoteCompaction);
    if (remoteCompaction) model.remoteCompaction = remoteCompaction;
    else delete model.remoteCompaction;
    const cost = parseCost(entry.cost);
    if (cost) model.cost = cost;
    else delete model.cost;
    const imageInputDecoder = entry.imageInputDecoder.trim();
    if (imageInputDecoder) model.imageInputDecoder = imageInputDecoder;
    else delete model.imageInputDecoder;
    const tokenizer = entry.tokenizer.trim();
    if (tokenizer) model.tokenizer = tokenizer;
    else delete model.tokenizer;
    return model;
  });
}

export function providerModels(provider: OmpProvider): OmpModel[] {
  if (Array.isArray(provider.models)) return provider.models;
  return [];
}

export function useProviderForm(catalog: ProviderPreset[]) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [modelEntries, setModelEntries] = useState<ModelEditorEntry[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function openCreateForm() {
    setEditingProviderId(null);
    setForm(blankForm());
    setModelEntries([
      toModelEditorEntry({
        id: "gpt-4.1",
        name: "GPT-4.1",
        reasoning: true,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16384,
      }),
    ]);
    setAdvancedOpen(false);
    setFormOpen(true);
  }

  function openEditForm(providerId: string, provider: OmpProvider) {
    setEditingProviderId(providerId);
    setForm({
      id: providerId,
      baseUrl: provider.baseUrl ?? "",
      api: provider.api ?? "openai-completions",
      auth: provider.auth ?? "apiKey",
      key: "",
      headers: formatJson(provider.headers),
      compat: formatJson(provider.compat),
      overrides: formatJson(provider.modelOverrides),
      discoveryType: provider.discovery?.type ?? "",
      authHeader: provider.authHeader ?? true,
      disableStrictTools: Boolean(provider.disableStrictTools),
      transport: provider.transport ?? "",
      remoteCompaction: formatJson(provider.remoteCompaction),
      cost: formatJson(provider.cost),
      codeMode: provider.codeMode ?? "",
    });
    setModelEntries(providerModels(provider).map(toModelEditorEntry));
    setAdvancedOpen(false);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingProviderId(null);
  }

  function choosePreset(id: string) {
    const preset = catalog.find((item) => item.id === id) ?? FALLBACK_PRESETS.find((item) => item.id === id || item.label === id);
    if (!preset) return;
    setForm((current) => ({
      ...current,
      id: preset.id,
      baseUrl: preset.baseUrl,
      api: preset.api,
      auth: preset.auth ?? current.auth,
      discoveryType: preset.discovery?.type ?? "",
    }));
  }

  function updateModelEntry(index: number, patch: Partial<ModelEditorEntry>) {
    setModelEntries((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  return {
    formOpen,
    setFormOpen,
    editingProviderId,
    form,
    setForm,
    modelEntries,
    setModelEntries,
    advancedOpen,
    setAdvancedOpen,
    openCreateForm,
    openEditForm,
    closeForm,
    choosePreset,
    updateModelEntry,
  };
}
