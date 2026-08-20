import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Toaster, toast } from "sonner";
import {
  Activity,
  ArchiveRestore,
  ChevronDown,
  CircleAlert,
  CloudDownload,
  Coins,
  Download,
  FileCheck2,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Settings2,
  Sparkles,
  Trash2,
  RotateCcw,
  Users,
  X,
} from "lucide-react";
import type {
  ConfigPatch,
  DiscoveryResult,
  EffectiveConfig,
  OmpModel,
  OmpProvider,
  ProviderPreset,
  ProfileRef,
  SettingsThinkingLevel,
  Snapshot,
} from "@omp-switch/core";
import { SETTINGS_THINKING_LEVELS, parseRoleSelector } from "@omp-switch/core/validation";
import { GatewayModule, ProjectOverlayBadge, SessionsModule, SurfaceModule } from "./workbench-modules";
import { UsageModule } from "./usage-module";
import { KNOWN_ROLES, RolesModule } from "./roles-module";
import { QuickAssign } from "./components/quick-assign";

const FALLBACK_PRESETS: Array<Pick<ProviderPreset, "id" | "label" | "baseUrl" | "api" | "auth" | "discovery">> = [
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

type FormState = {
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
};

function blankForm(): FormState {
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
  };
}

interface ModelEditorEntry {
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
}

function toModelEditorEntry(model: OmpModel): ModelEditorEntry {
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
  };
}

function createModelEditorEntry(): ModelEditorEntry {
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
  };
}

function parseOptionalPositiveInteger(label: string, value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} 必须是正整数`);
  return parsed;
}

function buildModels(entries: ModelEditorEntry[]): OmpModel[] {
  return entries.map((entry, index) => {
    const id = entry.id.trim();
    if (!id) throw new Error(`模型 ${index + 1} 的 ID 不能为空`);
    const model: OmpModel = { ...entry.raw, id };
    const name = entry.name.trim();
    if (name) model.name = name;
    else delete model.name;
    const contextWindow = parseOptionalPositiveInteger(`模型 ${id} 的 Context`, entry.contextWindow);
    if (contextWindow === undefined) delete model.contextWindow;
    else model.contextWindow = contextWindow;
    const maxTokens = parseOptionalPositiveInteger(`模型 ${id} 的 Max output`, entry.maxTokens);
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
    const compat = parseObjectJson(`模型 ${id} Compat`, entry.compat);
    if (compat) model.compat = compat;
    else delete model.compat;
    const transport = entry.transport.trim();
    if (transport) model.transport = transport;
    else delete model.transport;
    const remoteCompaction = parseObjectJson(`模型 ${id} Remote compaction`, entry.remoteCompaction);
    if (remoteCompaction) model.remoteCompaction = remoteCompaction;
    else delete model.remoteCompaction;
    const cost = parseCost(entry.cost);
    if (cost) model.cost = cost;
    else delete model.cost;
    const imageInputDecoder = entry.imageInputDecoder.trim();
    if (imageInputDecoder) model.imageInputDecoder = imageInputDecoder;
    else delete model.imageInputDecoder;
    return model;
  });
}

function createMockApi(): NonNullable<Window["ompSwitch"]> {
  const memory: Record<string, EffectiveConfig> = {};
  const makeConfig = (profileId: string): EffectiveConfig => ({
    profile: { id: profileId, name: profileId === "default" ? "Default" : profileId, kind: profileId === "default" ? "default" : "named", agentDir: `~/.omp/${profileId === "default" ? "agent" : `profiles/${profileId}/agent`}` },
    paths: {
      profile: profileId,
      agentDir: `~/.omp/${profileId === "default" ? "agent" : `profiles/${profileId}/agent`}`,
      modelsCandidates: [],
      settingsCandidates: [],
    },
    models: { value: { providers: { openrouter: { baseUrl: "https://openrouter.ai/api/v1", api: "openai-completions", auth: "apiKey", apiKey: "OPENROUTER_API_KEY", models: [{ id: "openai/gpt-4.1", name: "GPT-4.1", reasoning: true, contextWindow: 128000, maxTokens: 16384 }] } } }, raw: "", path: "~/.omp/agent/models.yml", hash: "demo", exists: true, legacy: false, diagnostics: [] },
    settings: { value: { modelRoles: { default: "openrouter/openai/gpt-4.1", slow: "@default" } }, raw: "", path: "~/.omp/agent/config.yml", hash: "demo-settings", exists: true, legacy: false, diagnostics: [] },
    diagnostics: [{ severity: "info", code: "demo", message: "浏览器预览模式：当前数据为示例配置" }],
  });
  const get = (id: string) => (memory[id] ??= makeConfig(id));
  return {
    getInfo: async () => ({ version: "0.1.0-demo", platform: "browser", installation: { executable: "omp", version: "demo", supported: true } }),
    listProfiles: async () => [get("default").profile, { id: "work", name: "work", kind: "named", agentDir: "~/.omp/profiles/work/agent" }],
    loadProfile: async (id: string) => get(id),
    save: async (id: string, patch: ConfigPatch) => {
      const config = get(id);
      if (patch.provider) {
        const existing = config.models.value.providers[patch.provider.id] ?? {};
        const next: OmpProvider = { ...existing, baseUrl: patch.provider.baseUrl, api: patch.provider.api, auth: patch.provider.auth, models: patch.provider.models };
        if (patch.provider.apiKey === null) delete next.apiKey;
        else if (patch.provider.apiKey !== undefined) next.apiKey = patch.provider.apiKey;
        if (patch.provider.headers === null) delete next.headers;
        else if (patch.provider.headers !== undefined) next.headers = patch.provider.headers;
        if (patch.provider.compat === null) delete next.compat;
        else if (patch.provider.compat !== undefined) next.compat = patch.provider.compat;
        if (patch.provider.modelOverrides === null) delete next.modelOverrides;
        else if (patch.provider.modelOverrides !== undefined) next.modelOverrides = patch.provider.modelOverrides;
        config.models.value.providers[patch.provider.id] = next;
      }
      if (patch.roleAssignments) {
        const nextRoles: Record<string, string> = { ...(config.settings.value.modelRoles ?? {}) };
        for (const [role, selector] of Object.entries(patch.roleAssignments)) {
          if (selector === null || selector === "") delete nextRoles[role];
          else nextRoles[role] = selector;
        }
        config.settings.value.modelRoles = nextRoles;
      }
      if (patch.settings) {
        const settings = config.settings.value;
        if (patch.settings.modelProviderOrder) settings.modelProviderOrder = patch.settings.modelProviderOrder;
        if (patch.settings.enabledModels) settings.enabledModels = patch.settings.enabledModels;
        if (patch.settings.disabledProviders) settings.disabledProviders = patch.settings.disabledProviders;
        if (patch.settings.defaultThinkingLevel) settings.defaultThinkingLevel = patch.settings.defaultThinkingLevel;
      }
      return { snapshot: { id: "demo-snapshot", profile: id, createdAt: new Date().toISOString(), modelsPath: config.models.path, settingsPath: config.settings.path }, config };
    },
    snapshot: async (id: string) => ({ id: "demo-snapshot", profile: id, createdAt: new Date().toISOString(), modelsPath: get(id).models.path, settingsPath: get(id).settings.path }),
    restore: async (snapshot: Snapshot) => get(snapshot.profile),
    restoreLatest: async (profileId: string) => ({ snapshot: { id: "demo-snapshot", profile: profileId, createdAt: new Date().toISOString(), modelsPath: get(profileId).models.path, settingsPath: get(profileId).settings.path }, config: get(profileId) }),
    discover: async (): Promise<DiscoveryResult> => ({ endpoint: "https://example.test/v1/models", durationMs: 184, models: [{ id: "demo-fast", name: "Demo Fast" }, { id: "demo-reasoning", name: "Demo Reasoning" }] }),
    secretPut: async (input) => ({ id: input.id ?? "demo-credential", command: "omp-switch --secret-get demo-credential" }),
    secretStatus: async () => ({ exists: true, label: "Demo credential", masked: "••••••••" }),
    secretDelete: async () => ({ deleted: true, references: [] }),
    secretOrphans: async () => [],
    authStatus: async () => ({ ok: true, output: "No active browser session in demo mode" }),
    authLogin: async () => ({ ok: false, output: "", error: "Run the packaged app to invoke omp auth login" }),
    listCatalog: async () => [],
    importCatalog: async () => ({ version: 1 as const, source: "demo", entries: [] }),
    exportCatalog: async () => ({ version: 1 as const, source: "demo", entries: [] }),
    projectOverlay: async () => ({ root: "D:/demo-project", explicit: false, overlay: null, precedence: [] }),
    chooseProjectRoot: async () => ({ root: "D:/demo-project", explicit: true, overlay: null, precedence: [] }),

    listSurface: async () => [],
    readSurface: async () => "",
    writeSurface: async (_profileId, _kind, name) => ({ id: name, name, path: name, source: "profile" as const, enabled: true }),
    deleteSurface: async () => undefined,
    exportSurfaces: async (profileId) => ({ version: 1 as const, profile: profileId, items: [] }),
    importSurfaces: async () => [],
    refreshSessions: async () => ({ discovered: 0, skipped: 0, reused: 0, changed: 0, rebuilt: 0, scannedBytes: 0, invalidLines: 0, errors: 0 }),
    listSessions: async () => ({ sessions: [], nextCursor: undefined }),
    readSessionMessages: async () => ({ messages: [], hasMore: false, nextCursor: undefined }),
    usageSummary: async () => ({
      report: {
        totals: { key: "total", requests: 2, failures: 0, tokens: { input: 31816, output: 77, cacheRead: 31744, cacheWrite: 0, reasoning: 34, total: 63637 }, recordedCost: 0.0140212, computedCost: 0, pricedRequests: 0, firstAt: "2026-08-18T10:00:00Z", lastAt: "2026-08-18T12:00:00Z" },
        byModel: [{ key: "demo/demo-1", requests: 2, failures: 0, tokens: { input: 31816, output: 77, cacheRead: 31744, cacheWrite: 0, reasoning: 34, total: 63637 }, recordedCost: 0.0140212, computedCost: 0, pricedRequests: 0 }],
        byProvider: [{ key: "demo", requests: 2, failures: 0, tokens: { input: 31816, output: 77, cacheRead: 31744, cacheWrite: 0, reasoning: 34, total: 63637 }, recordedCost: 0.0140212, computedCost: 0, pricedRequests: 0 }],
        byDay: [{ key: "2026-08-18", requests: 2, failures: 0, tokens: { input: 31816, output: 77, cacheRead: 31744, cacheWrite: 0, reasoning: 34, total: 63637 }, recordedCost: 0.0140212, computedCost: 0, pricedRequests: 0 }],
        unpriced: ["demo/demo-1"],
      },
      indexedEntries: 2,
      invalidLines: 0,
      pricedModels: 0,
      overrides: {},
    }),
    setUsagePrice: async () => ({}),
    listGatewayPools: async () => [],
    saveGatewayPool: async (pool) => pool,
    gatewayStatus: async () => ({ running: false, port: null, upstreams: [] }),
    startGateway: async () => ({ running: true, port: 46831, token: "demo-gateway-token" }),
    stopGateway: async () => undefined,
    updateOmp: async () => ({ ok: false, output: "Demo mode" }),
  };
}

const api = window.ompSwitch ?? createMockApi();

function providerModels(provider?: OmpProvider): OmpModel[] {
  return Array.isArray(provider?.models) ? provider.models : [];
}

function formatDate(value?: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatJson(value: unknown): string {
  return value && typeof value === "object" ? JSON.stringify(value, null, 2) : "";
}

function formatEnabledModelRules(value: Array<string | Record<string, unknown>> | undefined): string {
  return (value ?? []).map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n");
}

/** Dirty-check baselines. Key order must not matter, so sort before comparing. */
function rolesSignature(value: Record<string, string>): string {
  return JSON.stringify(Object.keys(value).sort().map((key) => `${key}=${value[key] ?? ""}`));
}

function settingsSignature(order: string, enabled: string, disabled: string, level: SettingsThinkingLevel): string {
  return JSON.stringify([order, enabled, disabled, level]);
}

/** Provider ids carry no slash, so a bare comma split is unambiguous here. */
function parseDisabledProviderRules(value: string): Array<string | Record<string, unknown>> {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch { throw new Error("禁用 Provider JSON 无效"); }
    if (!Array.isArray(parsed)) throw new Error("禁用 Provider JSON 必须是数组");
    return parsed.map((item) => {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object" && !Array.isArray(item)) return item as Record<string, unknown>;
      throw new Error("禁用 Provider 必须是字符串或 JSON mapping");
    });
  }
  return trimmed.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean).map((item) => {
    if (!item.startsWith("{")) return item;
    let parsed: unknown;
    try { parsed = JSON.parse(item); } catch { throw new Error("禁用 Provider 中的 JSON 对象无效"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("禁用 Provider 对象必须是 JSON mapping");
    return parsed as Record<string, unknown>;
  });
}

function parseEnabledModelRules(value: string): Array<string | Record<string, unknown>> {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch { throw new Error("启用模型规则 JSON 无效"); }
    if (!Array.isArray(parsed)) throw new Error("启用模型规则 JSON 必须是数组");
    return parsed.map((item) => {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object" && !Array.isArray(item)) return item as Record<string, unknown>;
      throw new Error("启用模型规则必须是字符串或 JSON mapping");
    });
  }
  return value.split(/\r?\n|,(?=\s*[A-Za-z0-9_.*-]+\/)/).map((item) => item.trim()).filter(Boolean).map((item) => {
    if (!item.startsWith("{")) return item;
    let parsed: unknown;
    try { parsed = JSON.parse(item); } catch { throw new Error("启用模型规则中的 JSON 对象无效"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("启用模型规则对象必须是 JSON mapping");
    return parsed as Record<string, unknown>;
  });
}

function parseObjectJson(label: string, value: string): Record<string, unknown> | null {
  if (!value.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} 必须是有效 JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} 必须是 JSON 对象`);
  return parsed as Record<string, unknown>;
}

function parseHeaders(value: string): Record<string, string> | null {
  const parsed = parseObjectJson("Headers", value);
  if (!parsed) return null;
  if (Object.values(parsed).some((header) => typeof header !== "string")) throw new Error("Headers 的值必须是字符串");
  return parsed as Record<string, string>;
}

function parseModelOverrides(value: string): Record<string, Record<string, unknown>> | null {
  const parsed = parseObjectJson("Model overrides", value);
  if (!parsed) return null;
  if (Object.values(parsed).some((override) => !override || typeof override !== "object" || Array.isArray(override))) {
    throw new Error("Model overrides 的值必须是 JSON 对象");
  }
  return parsed as Record<string, Record<string, unknown>>;
}

function parseCost(value: string): Record<string, number> | null {
  const parsed = parseObjectJson("Cost", value);
  if (!parsed) return null;
  if (Object.values(parsed).some((cost) => typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)) throw new Error("Cost 的值必须是非负数字");
  return parsed as Record<string, number>;
}

export default function App() {
  const [profiles, setProfiles] = useState<ProfileRef[]>([]);
  const [profileId, setProfileId] = useState("default");
  const [config, setConfig] = useState<EffectiveConfig | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [modelEntries, setModelEntries] = useState<ModelEditorEntry[]>([]);
  const [form, setForm] = useState<FormState>(blankForm);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [savedRoles, setSavedRoles] = useState<Record<string, string>>({});
  const [savedSettings, setSavedSettings] = useState("");
  const [authResult, setAuthResult] = useState<string>("");
  const [section, setSection] = useState<"models" | "roles" | "prompts" | "skills" | "sessions" | "usage" | "gateway">("models");
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const [catalog, setCatalog] = useState<ProviderPreset[]>([]);
  const [providerOrder, setProviderOrder] = useState("");
  const [enabledModels, setEnabledModels] = useState("");
  const [disabledProviders, setDisabledProviders] = useState("");
  const [defaultThinkingLevel, setDefaultThinkingLevel] = useState<SettingsThinkingLevel>("auto");
  const [updatingOmp, setUpdatingOmp] = useState(false);
  const catalogInput = useRef<HTMLInputElement>(null);

  const providers = config ? Object.entries(config.models.value.providers) : [];
  const selectedProvider = selectedProviderId ? config?.models.value.providers[selectedProviderId] : undefined;
  const selectedModels = useMemo(() => providerModels(selectedProvider), [selectedProvider]);
  const errorDiagnostics = config?.diagnostics.filter((item) => item.severity === "error") ?? [];
  const readOnly = Boolean(readOnlyReason);
  const providerIds = providers.map(([id]) => id);
  const roleIds = useMemo(() => {
    const extra = Object.keys(roles).filter((id) => !KNOWN_ROLES.some(([known]) => known === id)).map((id) => [id, ""] as [string, string]);
    return [...KNOWN_ROLES.map(([id, label]) => [id, label] as [string, string]), ...extra];
  }, [roles]);
  const rolesDirty = useMemo(() => rolesSignature(roles) !== rolesSignature(savedRoles), [roles, savedRoles]);
  const settingsDirty = settingsSignature(providerOrder, enabledModels, disabledProviders, defaultThinkingLevel) !== savedSettings;

  const notify = useCallback((next: { tone: "success" | "error" | "info"; text: string }) => {
    if (next.tone === "success") toast.success(next.text);
    else if (next.tone === "error") toast.error(next.text, { duration: 8000 });
    else toast.info(next.text);
  }, []);

  /** Single place that mirrors a freshly loaded config into editor state and resets dirty baselines. */
  function applyConfig(next: EffectiveConfig): void {
    const nextRoles = next.settings.value.modelRoles ?? {};
    setConfig(next);
    setRoles(nextRoles);
    setSavedRoles(nextRoles);
    setProviderOrder((next.settings.value.modelProviderOrder ?? []).join(", "));
    setEnabledModels(formatEnabledModelRules(next.settings.value.enabledModels));
    setDisabledProviders(formatEnabledModelRules(next.settings.value.disabledProviders));
    setDefaultThinkingLevel(next.settings.value.defaultThinkingLevel ?? "auto");
    setSavedSettings(settingsSignature(
      (next.settings.value.modelProviderOrder ?? []).join(", "),
      formatEnabledModelRules(next.settings.value.enabledModels),
      formatEnabledModelRules(next.settings.value.disabledProviders),
      next.settings.value.defaultThinkingLevel ?? "auto",
    ));
  }

  async function load(id: string): Promise<void> {
    setBusy(true);
    try {
      const next = await api.loadProfile(id);
      applyConfig(next);
      const first = Object.keys(next.models.value.providers)[0] ?? null;
      setSelectedProviderId((current) => (current && next.models.value.providers[current] ? current : first));
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void api.getInfo().then((info) => setReadOnlyReason(info.installation.supported ? null : info.installation.reason ?? "当前 OMP 版本不受支持")).catch(() => undefined);
    void api.listProfiles().then((items) => {
      setProfiles(items);
      void load(items[0]?.id ?? "default");
    });
    void api.listCatalog().then((items) => setCatalog(items as ProviderPreset[])).catch(() => undefined);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (rolesDirty || settingsDirty) void saveDirty();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function beginAdd(): void {
    setForm(blankForm());
    setModelEntries([]);
    setEditingProviderId(null);
    setAdvancedOpen(false);
    setDrawerOpen(true);
    setFormOpen(true);
  }

  function editProvider(id: string): void {
    const provider = config?.models.value.providers[id];
    setSelectedProviderId(id);
    setEditingProviderId(id);
    setForm({
      id,
      baseUrl: provider?.baseUrl ?? "",
      api: provider?.api ?? "openai-completions",
      auth: provider?.auth ?? (provider?.apiKey ? "apiKey" : "none"),
      key: "",
      headers: formatJson(provider?.headers),
      compat: formatJson(provider?.compat),
      overrides: formatJson(provider?.modelOverrides),
      discoveryType: typeof provider?.discovery?.type === "string" ? provider.discovery.type : "",
      authHeader: provider?.authHeader ?? true,
      disableStrictTools: Boolean(provider?.disableStrictTools),
      transport: provider?.transport ?? "",
       remoteCompaction: formatJson(provider?.remoteCompaction),
      cost: formatJson(provider?.cost),
    });
    setModelEntries(providerModels(provider).map(toModelEditorEntry));
    setAdvancedOpen(false);
    setDrawerOpen(true);
    setFormOpen(true);
  }

  async function saveProvider(): Promise<void> {
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? "当前配置为只读" });
      return;
    }
    if (!config || !form.id.trim() || !form.baseUrl.trim()) {
      notify({ tone: "error", text: "Provider ID 和 Endpoint URL 都不能为空" });
      return;
    }
    if (config.models.legacy && !window.confirm("检测到旧 models.json。继续将写入 models.yml；旧文件会保留在写入前快照中。")) return;
    setBusy(true);
    try {
      const id = form.id.trim();
      const existing = config.models.value.providers[id];
      const headers = parseHeaders(form.headers);
      const compat = parseObjectJson("Compat", form.compat);
      const modelOverrides = parseModelOverrides(form.overrides);
      const cost = parseCost(form.cost);
      const remoteCompaction = parseObjectJson("Remote compaction", form.remoteCompaction);
      let apiKeyValue: string | null | undefined = form.auth === "none" ? null : existing?.apiKey;
      let auth = form.auth;
      if (form.key.trim()) {
        const credential = await api.secretPut({ label: `${id} API key`, value: form.key.trim() });
        apiKeyValue = `!${credential.command}`;
        auth = "apiKey";
      }
      const models = buildModels(modelEntries).map((model) => ({ ...model, api: model.api ?? form.api }));
      const result = await api.save(profileId, {
        provider: {
          id,
          baseUrl: form.baseUrl.trim(),
          api: form.api,
          auth,
          apiKey: apiKeyValue,
          headers,
          compat,
          modelOverrides,
          models,
          ...(form.discoveryType ? { discovery: { type: form.discoveryType } } : {}),
          authHeader: form.authHeader,
          disableStrictTools: form.disableStrictTools,
          ...(form.transport.trim() ? { transport: form.transport.trim() } : {}),
           remoteCompaction,
          cost,
        },
        confirmLegacyMigration: config.models.legacy,
      });
      setConfig(result.config);
      setSnapshot(result.snapshot);
      setSelectedProviderId(id);
      setFormOpen(false);
      setDrawerOpen(true);
      notify({ tone: "success", text: `已保存 ${id}，快照 ${formatDate(result.snapshot.createdAt)}` });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function removeProvider(): Promise<void> {
    if (!config || !selectedProviderId) return;
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? "当前配置为只读" });
      return;
    }
    if (config.models.legacy && !window.confirm("检测到旧 models.json。继续将写入 models.yml；旧文件会保留在写入前快照中。")) return;
    setBusy(true);
    try {
      const result = await api.save(profileId, { removeProviderId: selectedProviderId, confirmLegacyMigration: config.models.legacy });
      setConfig(result.config);
      setSelectedProviderId(Object.keys(result.config.models.value.providers)[0] ?? null);
      setFormOpen(false);
      notify({ tone: "success", text: "供应商已移除，原配置已创建快照" });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function fetchModels(): Promise<void> {
    if (!form.baseUrl.trim()) return;
    setBusy(true);
    try {
      const result = await api.discover({ baseUrl: form.baseUrl.trim(), apiKey: form.key.trim() || undefined, headers: parseHeaders(form.headers) ?? undefined, type: form.discoveryType as "ollama" | "llama.cpp" | "lm-studio" | "openai-models-list" | "proxy" | "litellm" || undefined });
      setModelEntries(result.models.map((model) => toModelEditorEntry({
        id: model.id,
        name: model.name,
        api: form.api,
        reasoning: /reason|think|o[1-9]/i.test(model.id),
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16384,
      })));
      notify({ tone: "success", text: `发现 ${result.models.length} 个模型，耗时 ${result.durationMs}ms` });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function saveRoles(): Promise<void> {
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? "当前配置为只读" });
      return;
    }
    if (config?.models.legacy && !window.confirm("检测到旧 models.json。继续将写入 models.yml；旧文件会保留在写入前快照中。")) return;
    setBusy(true);
    try {
      const result = await api.save(profileId, { roleAssignments: roles, confirmLegacyMigration: config?.models.legacy });
      applyConfig(result.config);
      setSnapshot(result.snapshot);
      notify({ tone: "success", text: "角色映射已写入 config.yml" });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(): Promise<void> {
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? "当前配置为只读" });
      return;
    }
    if (config?.models.legacy && !window.confirm("检测到旧 models.json。继续将写入 models.yml；旧文件会保留在写入前快照中。")) return;
    setBusy(true);
    try {
      const result = await api.save(profileId, {
        settings: {
          modelProviderOrder: providerOrder.split(",").map((value) => value.trim()).filter(Boolean),
          enabledModels: parseEnabledModelRules(enabledModels),
          disabledProviders: parseDisabledProviderRules(disabledProviders),
          defaultThinkingLevel,
        },
        confirmLegacyMigration: config?.models.legacy,
      });
      applyConfig(result.config);
      setSnapshot(result.snapshot);
      notify({ tone: "success", text: "设置已写入 config.yml" });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  /** One commit when both areas are dirty, otherwise whichever is — this is what Ctrl+S runs. */
  async function saveDirty(): Promise<void> {
    if (readOnly || busy) return;
    if (rolesDirty && settingsDirty) {
      if (config?.models.legacy && !window.confirm("检测到旧 models.json。继续将写入 models.yml；旧文件会保留在写入前快照中。")) return;
      setBusy(true);
      try {
        const result = await api.save(profileId, {
          roleAssignments: roles,
          settings: {
            modelProviderOrder: providerOrder.split(",").map((value) => value.trim()).filter(Boolean),
            enabledModels: parseEnabledModelRules(enabledModels),
            disabledProviders: parseDisabledProviderRules(disabledProviders),
            defaultThinkingLevel,
          },
          confirmLegacyMigration: config?.models.legacy,
        });
        applyConfig(result.config);
        setSnapshot(result.snapshot);
        notify({ tone: "success", text: "角色与设置已写入 config.yml" });
      } catch (error) {
        notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (rolesDirty) await saveRoles();
    else if (settingsDirty) await saveSettings();
  }

  /**
   * Only switching profile actually loses edits (load() overwrites editor state); switching
   * sections keeps them in memory, so no guard there — the confirm would be both naggy and wrong.
   */
  function confirmDiscard(): boolean {
    if (!rolesDirty && !settingsDirty) return true;
    return window.confirm("有未保存的角色或设置改动，切换 Profile 将丢失这些改动。仍要继续？");
  }

  /** Quick-assign keeps the role's existing thinking suffix and only swaps the provider/model. */
  function assignModelToRole(roleId: string, providerId: string, modelId: string): void {
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? "当前配置为只读" });
      return;
    }
    const existing = (roles[roleId] ?? "").trim();
    const parsed = existing ? parseRoleSelector(existing, providerIds) : null;
    const suffix = parsed?.thinking ? `:${parsed.thinking}` : "";
    setRoles((current) => ({ ...current, [roleId]: `${providerId}/${modelId}${suffix}` }));
    notify({ tone: "info", text: `已将 ${providerId}/${modelId} 设为 ${roleId} · 角色页保存后生效` });
  }

  /** "" (clear) removes the key entirely, matching how config.yml represents an unset role. */
  function setRoleValue(role: string, value: string): void {
    setRoles((current) => {
      const next = { ...current };
      if (value === "") delete next[role];
      else next[role] = value;
      return next;
    });
  }

  async function createSnapshot(): Promise<void> {
    setBusy(true);
    try {
      const next = await api.snapshot(profileId);
      setSnapshot(next);
      notify({ tone: "success", text: `已创建本机快照 ${formatDate(next.createdAt)}` });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function restoreLatest(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.restoreLatest(profileId);
      applyConfig(result.config);
      setSnapshot(result.snapshot);
      setSelectedProviderId(Object.keys(result.config.models.value.providers)[0] ?? null);
      notify({ tone: "success", text: "已恢复最近快照" });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function checkAuth(provider: "openai-codex" | "anthropic", action: "status" | "login"): Promise<void> {
    setBusy(true);
    try {
      const result = action === "status" ? await api.authStatus(provider) : await api.authLogin(provider);
      setAuthResult(result.ok ? `${provider}: ${result.output || "已完成"}` : `${provider}: ${result.error ?? "命令失败"}`);
    } catch (error) {
      setAuthResult(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function updateOmp(): Promise<void> {
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? "当前 OMP 为只读" });
      return;
    }
    setUpdatingOmp(true);
    try {
      const result = await api.updateOmp(profileId);
      if (!result.ok) {
        notify({ tone: "error", text: result.output || "OMP 更新失败" });
        return;
      }
      notify({ tone: "success", text: `OMP 已更新${result.installation?.version ? ` · ${result.installation.version}` : ""}` });
      await load(profileId);
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setUpdatingOmp(false);
    }
  }

  async function importCatalogFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      const result = await api.importCatalog(bundle);
      setCatalog(result.entries);
      notify({ tone: "success", text: `已导入 ${result.entries.length} 个预设` });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function exportCatalog(): Promise<void> {
    try {
      const bundle = await api.exportCatalog();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "omp-switch-catalog.json";
      link.click();
      URL.revokeObjectURL(url);
      notify({ tone: "success", text: "目录已导出" });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  function choosePreset(id: string): void {
    const preset = catalog.find((item) => item.id === id) ?? FALLBACK_PRESETS.find((item) => item.id === id || item.label === id);
    if (!preset) return;
    setForm((current) => ({ ...current, id: preset.id, baseUrl: preset.baseUrl, api: preset.api, auth: preset.auth ?? current.auth, discoveryType: preset.discovery?.type ?? "" }));
  }

  function updateModelEntry(index: number, patch: Partial<ModelEditorEntry>): void {
    setModelEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  const filteredProviders = providers.filter(([id, provider]) => {
    const text = `${id} ${provider.api ?? ""} ${provider.baseUrl ?? ""} ${providerModels(provider).map((model) => `${model.id} ${model.name ?? ""}`).join(" ")}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });
  const healthLabel = readOnly ? "只读" : errorDiagnostics.length > 0 ? "有问题" : config?.models.exists ? "已连接" : "未配置";
  const sectionLabels = { models: "模型", roles: "角色", prompts: "提示", skills: "技能", sessions: "会话", usage: "用量", gateway: "网关" } as const;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Sparkles size={16} /></div>
          <div className="brand-name">OMP Switch</div>
        </div>
        <div className="topbar-center">
          <button className="profile-chip" title="打开 Profile" onClick={() => { setProfileDrawerOpen(true); setDrawerOpen(true); }}>
            <span className="status-led" />{profiles.find((profile) => profile.id === profileId)?.name ?? profileId}<ChevronDown size={14} />
          </button>
          <button className={`status-chip ${readOnly ? "warning" : errorDiagnostics.length ? "danger" : "ok"}`} onClick={() => { setDiagnosticsOpen(true); setDrawerOpen(true); }}>
            <ShieldCheck size={14} />{healthLabel}
          </button>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" title="刷新" onClick={() => void load(profileId)} disabled={busy}><RefreshCw size={17} className={busy ? "spin" : ""} /></button>
          <button className="icon-button" title="创建快照" onClick={() => void createSnapshot()} disabled={busy}><ArchiveRestore size={17} /></button>
          <button className="primary-button compact" title="保存全部未保存改动 (Ctrl+S)" onClick={() => void saveDirty()} disabled={busy || readOnly || (!rolesDirty && !settingsDirty)}><Save size={15} />保存</button>
        </div>
      </header>

      <main className="app-body">
        <aside className="left-rail">
          <div className="rail-profile">
            <span className="rail-label">PROFILE</span>
            <select value={profileId} onChange={(event) => { if (!confirmDiscard()) return; setProfileId(event.target.value); void load(event.target.value); }} aria-label="选择 Profile">
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
            <span className="path-note" title={config?.profile.agentDir}>{config?.profile.agentDir ?? "读取中"}</span>
          </div>
          <nav className="section-nav" aria-label="模块">
            {(Object.keys(sectionLabels) as Array<keyof typeof sectionLabels>).map((item) => (
              <button key={item} className={section === item ? "active" : ""} onClick={() => { setSection(item); setFormOpen(false); setDrawerOpen(false); }}>
                <span className="nav-icon">{item === "models" ? <CloudDownload size={16} /> : item === "roles" ? <Users size={16} /> : item === "prompts" ? <FileCheck2 size={16} /> : item === "skills" ? <Sparkles size={16} /> : item === "sessions" ? <Activity size={16} /> : item === "usage" ? <Coins size={16} /> : <ShieldCheck size={16} />}</span>
                <span>{sectionLabels[item]}</span>
                {item === "models" ? <span className="nav-count">{providers.length}</span> : null}
                {item === "roles" && rolesDirty ? <span className="nav-dot" title="有未保存的角色改动" /> : null}
              </button>
            ))}
          </nav>
          <div className="rail-footer">
            <button className="rail-action" onClick={() => { setDiagnosticsOpen(true); setDrawerOpen(true); }}><CircleAlert size={15} />诊断<span>{errorDiagnostics.length}</span></button>
            <button className="rail-action" onClick={() => { setProfileDrawerOpen(true); setDrawerOpen(true); }}><Settings2 size={15} />Profile{settingsDirty ? <span className="nav-dot" title="设置有未保存改动" /> : null}</button>
          </div>
        </aside>

        <section className="workspace-main">
          {section === "models" ? (
            <>
              <div className="workspace-heading">
                <div><span className="eyebrow">{profileId}</span><h1>模型</h1></div>
                <div className="heading-actions">
                  <div className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" aria-label="搜索供应商和模型" /></div>
                  <div className="new-wrap">
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button className="primary-button" disabled={readOnly}><Plus size={16} />新增</button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content className="dd-menu" align="end" sideOffset={6} collisionPadding={10}>
                          <DropdownMenu.Item className="dd-item" onSelect={() => beginAdd()}>自定义</DropdownMenu.Item>
                          <DropdownMenu.Item className="dd-item" onSelect={() => { beginAdd(); notify({ tone: "info", text: "在表单顶部的「预设」中选择" }); }}>预设</DropdownMenu.Item>
                          <DropdownMenu.Item className="dd-item" onSelect={() => catalogInput.current?.click()}>导入目录</DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                    <input ref={catalogInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importCatalogFile(event)} />
                  </div>
                </div>
              </div>

              {readOnlyReason ? <div className="inline-status warning"><CircleAlert size={15} /><span>{readOnlyReason}</span></div> : null}
              {filteredProviders.length === 0 ? <div className="empty-workspace"><CloudDownload size={24} /><strong>{providers.length ? "没有匹配项" : "还没有供应商"}</strong><button className="primary-button" onClick={beginAdd} disabled={readOnly}><Plus size={15} />新增</button></div> : null}
              <div className="provider-stack">
                {filteredProviders.map(([id, provider]) => {
                  const expanded = expandedProviders[id] ?? id === selectedProviderId;
                  const active = id === selectedProviderId;
                  const models = providerModels(provider);
                  return <article className={`provider-card ${active ? "active" : ""}`} key={id}>
                    <button className="provider-card-head" onClick={() => { setSelectedProviderId(id); setDrawerOpen(true); setFormOpen(false); setExpandedProviders((current) => ({ ...current, [id]: !expanded })); }}>
                      <span className="provider-led" />
                      <span className="provider-title"><strong>{id}</strong><small>{provider.api ?? "custom"} · {models.length} 模型</small></span>
                      <span className="provider-endpoint mono">{provider.baseUrl ?? "—"}</span>
                      <span className="row-status">{provider.auth === "none" ? "无需密钥" : provider.apiKey ? "已配置" : "未配置"}</span>
                      {expanded ? <ChevronDown size={16} /> : <ChevronDown size={16} className="rotate-closed" />}
                    </button>
                    {expanded ? <div className="model-list">
                      {models.map((model) => <div
                        className="model-row"
                        key={model.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => { setSelectedProviderId(id); setDrawerOpen(true); }}
                        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedProviderId(id); setDrawerOpen(true); } }}
                      >
                        <span className="model-name"><strong>{model.name ?? model.id}</strong><small>{model.id}</small></span>
                        <span className="model-api">{model.api ?? provider.api ?? "—"}</span>
                        <span className="model-context">{typeof model.contextWindow === "number" ? model.contextWindow.toLocaleString() : "—"}</span>
                        <span className="capabilities"><span className={model.reasoning ? "capability on" : "capability"}>{model.reasoning ? "思考" : "标准" }</span><span className="capability">{model.input?.includes("image") ? "视觉" : "文本"}</span></span>
                        <QuickAssign roles={roleIds} assignments={roles} providerId={id} modelId={model.id ?? ""} providerIds={providerIds} onAssign={(roleId) => assignModelToRole(roleId, id, model.id ?? "")} onOpenRoles={() => { setSection("roles"); setFormOpen(false); setDrawerOpen(false); }} />
                      </div>)}
                      {models.length === 0 ? <div className="model-empty">暂无模型 · 打开抽屉发现</div> : null}
                    </div> : null}
                  </article>;
                })}
              </div>
            </>
          ) : section === "roles" ? <RolesModule providers={providers} roleIds={roleIds} roles={roles} baseline={savedRoles} readOnly={readOnly} busy={busy} onRoleChange={setRoleValue} onSave={() => void saveDirty()} />
            : section === "prompts" ? <SurfaceModule api={api} profileId={profileId} kind="prompt" readOnly={readOnly} onNotice={notify} />
            : section === "skills" ? <SurfaceModule api={api} profileId={profileId} kind="skill" readOnly={readOnly} onNotice={notify} />
              : section === "sessions" ? <SessionsModule api={api} profileId={profileId} onNotice={notify} />
              : section === "usage" ? <UsageModule api={api} profileId={profileId} onNotice={notify} />
                : <GatewayModule api={api} profileId={profileId} readOnly={readOnly} onNotice={notify} providers={providers} />}
        </section>

        {(drawerOpen || formOpen || profileDrawerOpen || diagnosticsOpen) ? <aside className="detail-drawer">
          <div className="drawer-head"><div><span className="eyebrow">{profileDrawerOpen ? "PROFILE" : diagnosticsOpen ? "DIAGNOSTICS" : formOpen ? (editingProviderId ? "编辑" : "新增") : "PROVIDER"}</span><h2>{profileDrawerOpen ? profileId : diagnosticsOpen ? "诊断" : formOpen ? (editingProviderId ?? "新供应商") : selectedProviderId ?? "详情"}</h2></div><button className="icon-button" title="关闭" onClick={() => { setDrawerOpen(false); setFormOpen(false); setProfileDrawerOpen(false); setDiagnosticsOpen(false); }}><X size={17} /></button></div>

          {profileDrawerOpen ? <div className="drawer-body">
            <div className="drawer-section"><div className="drawer-section-title"><span>角色</span><Users size={15} /></div><span className="muted-line">模型角色的分配已移至独立的「角色」页面，可直接按供应商选择模型。</span><div className="drawer-actions"><button className="secondary-button" onClick={() => { setSection("roles"); setProfileDrawerOpen(false); setDrawerOpen(false); }}><Users size={15} />打开角色页</button></div></div>
            <div className="drawer-section"><div className="drawer-section-title"><span>选择</span>{settingsDirty ? <span className="heading-dirty">未保存</span> : <Settings2 size={15} />}</div><label className="module-field"><span>Provider 顺序</span><input value={providerOrder} onChange={(event) => setProviderOrder(event.target.value)} placeholder="openrouter, openai" /></label><label className="module-field"><span>启用模型</span><textarea value={enabledModels} onChange={(event) => setEnabledModels(event.target.value)} rows={3} placeholder={"provider/*\n[{\"path\":\"~/work\",\"models\":[\"provider/model\"]}]"} /></label><label className="module-field"><span>禁用 Provider</span><textarea value={disabledProviders} onChange={(event) => setDisabledProviders(event.target.value)} rows={2} placeholder={"ollama, native"} /></label><label className="module-field"><span>默认思考</span><select value={defaultThinkingLevel} onChange={(event) => setDefaultThinkingLevel(event.target.value as SettingsThinkingLevel)}>{SETTINGS_THINKING_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select></label><button className="primary-button full-width" onClick={() => void saveSettings()} disabled={busy || readOnly || !settingsDirty}><Save size={15} />保存设置</button></div>
            <div className="drawer-section"><div className="drawer-section-title"><span>项目</span><FolderOpen size={15} /></div><ProjectOverlayBadge api={api} profileId={profileId} onNotice={notify} /></div>
            <div className="drawer-section"><div className="drawer-section-title"><span>快照</span><ArchiveRestore size={16} /></div><div className="drawer-actions"><button className="secondary-button" onClick={() => void createSnapshot()} disabled={busy}><ArchiveRestore size={15} />创建</button><button className="secondary-button" onClick={() => void restoreLatest()} disabled={busy}><RotateCcw size={15} />恢复</button></div><span className="muted-line">{snapshot ? formatDate(snapshot.createdAt) : "写入前自动创建"}</span></div>
            <div className="drawer-section"><div className="drawer-section-title"><span>OMP</span><RefreshCw size={15} /></div><div className="drawer-actions"><button className="secondary-button" onClick={() => void updateOmp()} disabled={busy || updatingOmp || readOnly}><RefreshCw size={14} className={updatingOmp ? "spin" : ""} />更新</button><button className="secondary-button" onClick={() => void exportCatalog()} disabled={busy}><Download size={14} />目录</button></div></div>
            <div className="drawer-section"><div className="drawer-section-title"><span>OAuth</span><KeyRound size={16} /></div><div className="drawer-actions"><button className="secondary-button" onClick={() => void checkAuth("openai-codex", "status")} disabled={busy}>Codex</button><button className="secondary-button" onClick={() => void checkAuth("anthropic", "status")} disabled={busy}>Anthropic</button></div>{authResult ? <span className="muted-line">{authResult}</span> : null}</div>
            <details className="yaml-preview"><summary>原始 YAML</summary><pre className="raw-view">{config?.models.raw || "models.yml 未创建"}{"\n\n"}{config?.settings.raw || "config.yml 未创建"}</pre></details>
          </div> : null}

          {diagnosticsOpen ? <div className="drawer-body"><div className="drawer-section"><div className="drawer-section-title"><span>状态</span><span className={`status-chip ${errorDiagnostics.length ? "danger" : "ok"}`}>{errorDiagnostics.length ? "有问题" : "正常"}</span></div>{(config?.diagnostics ?? []).map((item, index) => <div className="diagnostic-row" key={`${item.code}-${index}`}><span className={`diag-icon ${item.severity}`}><CircleAlert size={14} /></span><span><strong>{item.code}</strong><small>{item.message}</small></span></div>)}{!config?.diagnostics.length ? <span className="muted-line">暂无诊断</span> : null}</div></div> : null}


          {!profileDrawerOpen && !diagnosticsOpen && formOpen ? <div className="drawer-body form-drawer">
            <label>预设<select value={form.id} onChange={(event) => choosePreset(event.target.value)}><option value="">自定义</option>{(catalog.length ? catalog : FALLBACK_PRESETS).map((preset) => <option key={`${preset.id}-${preset.label}`} value={preset.id}>{preset.label}</option>)}</select></label>
            <div className="form-two"><label>ID<input readOnly={Boolean(editingProviderId)} value={form.id} onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))} placeholder="openrouter" /></label><label>API<input list="omp-api-options" value={form.api} onChange={(event) => setForm((current) => ({ ...current, api: event.target.value }))} /><datalist id="omp-api-options"><option value="openai-completions" /><option value="openai-responses" /><option value="anthropic-messages" /><option value="openai-codex-responses" /></datalist></label></div>
            <label>Endpoint<input value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1" /></label>
            <div className="form-two"><label>Auth<select value={form.auth} onChange={(event) => setForm((current) => ({ ...current, auth: event.target.value }))}><option value="apiKey">apiKey</option><option value="none">none</option><option value="oauth">oauth</option></select></label><label>密钥<input type="password" value={form.key} onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))} placeholder="留空保留" /></label></div>
            <div className="model-editor"><div className="drawer-section-title"><span>模型</span><button className="icon-button" title="添加模型" onClick={() => setModelEntries((current) => [...current, createModelEditorEntry()])}><Plus size={15} /></button></div>{modelEntries.map((entry, index) => <div className="model-editor-card" key={`${entry.raw.id}-${index}`}><div className="model-editor-row"><input aria-label={`模型 ${index + 1} ID`} value={entry.id} onChange={(event) => updateModelEntry(index, { id: event.target.value })} placeholder="Model ID" /><input aria-label={`模型 ${index + 1} 名称`} value={entry.name} onChange={(event) => updateModelEntry(index, { name: event.target.value })} placeholder="名称" /><input aria-label={`模型 ${index + 1} Context`} inputMode="numeric" value={entry.contextWindow} onChange={(event) => updateModelEntry(index, { contextWindow: event.target.value })} placeholder="Context" /><input aria-label={`模型 ${index + 1} Max output`} inputMode="numeric" value={entry.maxTokens} onChange={(event) => updateModelEntry(index, { maxTokens: event.target.value })} placeholder="Max" /><label className="check-line"><input type="checkbox" checked={entry.reasoning} onChange={(event) => updateModelEntry(index, { reasoning: event.target.checked })} />思考</label><label className="check-line"><input type="checkbox" checked={entry.vision} onChange={(event) => updateModelEntry(index, { vision: event.target.checked })} />视觉</label><button className="icon-button subtle danger" title="删除模型" onClick={() => setModelEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div><details className="model-advanced"><summary>高级</summary><div className="model-advanced-grid"><label>API<input value={entry.api} onChange={(event) => updateModelEntry(index, { api: event.target.value })} placeholder="继承 Provider" /></label><label>Transport<input value={entry.transport} onChange={(event) => updateModelEntry(index, { transport: event.target.value })} placeholder="pi-native" /></label><label>图片解码<input value={entry.imageInputDecoder} onChange={(event) => updateModelEntry(index, { imageInputDecoder: event.target.value })} placeholder="stb" /></label><label>Headers<textarea value={entry.headers} onChange={(event) => updateModelEntry(index, { headers: event.target.value })} rows={2} placeholder='{"X-Client":"omp-switch"}' /></label><label>Compat<textarea value={entry.compat} onChange={(event) => updateModelEntry(index, { compat: event.target.value })} rows={2} /></label><label>远程压缩<textarea value={entry.remoteCompaction} onChange={(event) => updateModelEntry(index, { remoteCompaction: event.target.value })} rows={2} placeholder='{"enabled":true}' /></label><label>Cost<textarea value={entry.cost} onChange={(event) => updateModelEntry(index, { cost: event.target.value })} rows={2} placeholder='{"input":0.1,"output":0.4}' /></label></div></details></div>)}{!modelEntries.length ? <span className="muted-line">暂无模型</span> : null}</div>
            <button className="drawer-disclosure" onClick={() => setAdvancedOpen((value) => !value)}><span>Provider 高级</span><ChevronDown size={15} className={advancedOpen ? "rotate-open" : ""} /></button>{advancedOpen ? <div className="advanced-fields"><div className="form-two"><label>发现<select value={form.discoveryType} onChange={(event) => setForm((current) => ({ ...current, discoveryType: event.target.value }))}><option value="">手动</option><option value="openai-models-list">OpenAI</option><option value="ollama">Ollama</option><option value="llama.cpp">llama.cpp</option><option value="lm-studio">LM Studio</option><option value="proxy">Proxy</option><option value="litellm">LiteLLM</option></select></label><label>Transport<input value={form.transport} onChange={(event) => setForm((current) => ({ ...current, transport: event.target.value }))} placeholder="pi-native" /></label></div><div className="form-two"><label className="check-line"><input type="checkbox" checked={form.authHeader} onChange={(event) => setForm((current) => ({ ...current, authHeader: event.target.checked }))} />Auth header</label><label className="check-line"><input type="checkbox" checked={form.disableStrictTools} onChange={(event) => setForm((current) => ({ ...current, disableStrictTools: event.target.checked }))} />宽松工具</label></div><label>Headers<textarea value={form.headers} onChange={(event) => setForm((current) => ({ ...current, headers: event.target.value }))} rows={3} placeholder='{"X-Client":"omp-switch"}' /></label><label>Compat<textarea value={form.compat} onChange={(event) => setForm((current) => ({ ...current, compat: event.target.value }))} rows={3} /></label><label>Overrides<textarea value={form.overrides} onChange={(event) => setForm((current) => ({ ...current, overrides: event.target.value }))} rows={3} /></label><label>远程压缩<textarea value={form.remoteCompaction} onChange={(event) => setForm((current) => ({ ...current, remoteCompaction: event.target.value }))} rows={3} placeholder='{"enabled":true,"endpoint":"https://..."}' /></label><label>Cost<textarea value={form.cost} onChange={(event) => setForm((current) => ({ ...current, cost: event.target.value }))} rows={2} placeholder='{"input":0.1,"output":0.4}' /></label></div> : null}
            <div className="drawer-actions form-submit-actions"><button className="secondary-button" onClick={() => void fetchModels()} disabled={busy}><CloudDownload size={15} />测试并发现</button><button className="primary-button" onClick={() => void saveProvider()} disabled={busy || readOnly}><Save size={15} />保存</button></div>
          </div> : null}


          {!profileDrawerOpen && !diagnosticsOpen && !formOpen && selectedProvider ? <div className="drawer-body"><div className="drawer-section"><div className="drawer-section-title"><span>连接</span><span className="status-chip ok">{selectedProvider.auth === "none" ? "无需密钥" : selectedProvider.apiKey ? "已配置" : "未配置"}</span></div><div className="detail-grid"><span>API</span><strong>{selectedProvider.api ?? "custom"}</strong><span>Endpoint</span><strong className="mono break">{selectedProvider.baseUrl ?? "—"}</strong><span>Auth</span><strong>{selectedProvider.auth ?? "apiKey"}</strong></div><div className="drawer-actions"><button className="primary-button" onClick={() => editProvider(selectedProviderId!)}><Sparkles size={15} />编辑</button><button className="icon-button danger" title="删除供应商" onClick={() => void removeProvider()} disabled={busy || readOnly}><Trash2 size={15} /></button></div></div><div className="drawer-section"><div className="drawer-section-title"><span>模型</span><span className="status-chip neutral">{selectedModels.length}</span></div>{selectedModels.map((model) => <div className="mini-model" key={model.id}><strong>{model.name ?? model.id}</strong><span>{model.id}</span></div>)}</div></div> : null}
        </aside> : null}
      </main>
      <Toaster position="bottom-right" theme="system" closeButton toastOptions={{ classNames: { info: "toast-info" } }} />
    </div>
  );
}
