import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Toaster, toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
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
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Settings2,
  Sparkles,
  Trash2,
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
import { CommandPalette } from "./components/command-palette";
import { SnapshotTimeline } from "./components/snapshot-timeline";
import { YamlPreview } from "./components/yaml-preview";
import { ConflictDialog, ConfirmDialog, SavePreviewDialog, ShortcutsDialog, type PendingSave } from "./components/save-flow";
import { IconButtonTip, StyledSelect } from "./components/ui-primitives";
import { ThemeSwitch } from "./components/theme-switch";
import { initTheme, type ThemeChoice } from "./theme";

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
    models: { value: { providers: { openrouter: { baseUrl: "https://openrouter.ai/api/v1", api: "openai-completions", auth: "apiKey", apiKey: "OPENROUTER_API_KEY", models: [{ id: "openai/gpt-4.1", name: "GPT-4.1", reasoning: true, contextWindow: 128000, maxTokens: 16384 }] } } }, raw: "# OMP model providers\nproviders:\n  openrouter:\n    baseUrl: \"https://openrouter.ai/api/v1\"\n    api: openai-completions\n    # auth resolves the key via the secret bridge\n    auth: apiKey\n    models:\n      - id: openai/gpt-4.1\n        name: \"GPT-4.1\"\n        contextWindow: 128000\n        maxTokens: 16384\n", path: "~/.omp/agent/models.yml", hash: "demo", exists: true, legacy: false, diagnostics: [{ code: "provider.api-unknown", severity: "warning", message: "api \"openai-completions\" 不在已知列表中，但运行时扩展可能注册它。" }, { code: "provider.apiKey-fragile-command", severity: "info", message: "apiKey 是明文而非 !command 引用；GUI 会先加密入库，但 CLI 路径不受此约束。" }] },
    settings: { value: { modelRoles: { default: "openrouter/openai/gpt-4.1", slow: "@default" } }, raw: "modelRoles:\n  default: openrouter/openai/gpt-4.1\n  slow: \"@default\"\n", path: "~/.omp/agent/config.yml", hash: "demo-settings", exists: true, legacy: false, diagnostics: [] },
    diagnostics: [{ severity: "info", code: "demo", message: "浏览器预览模式：当前数据为示例配置" }],
  });
  const get = (id: string) => (memory[id] ??= makeConfig(id));
  return {
    getInfo: async () => ({ version: "0.1.0-demo", platform: "browser", installation: { executable: "omp", version: "demo", supported: true } }),
    setTheme: async () => undefined,
    listProfiles: async () => [get("default").profile, { id: "work", name: "work", kind: "named", agentDir: "~/.omp/profiles/work/agent" }],
    loadProfile: async (id: string) => get(id),
    preview: async (id: string, patch: ConfigPatch) => {
      // The mock has no YAML writer; re-applying the patch to a clone and rendering both sides as
      // JSON is enough to exercise the diff dialog in the browser preview.
      const before = get(id);
      const after = JSON.parse(JSON.stringify(before)) as EffectiveConfig;
      if (patch.provider) {
        const existing = after.models.value.providers[patch.provider.id] ?? {};
        after.models.value.providers[patch.provider.id] = { ...existing, baseUrl: patch.provider.baseUrl, api: patch.provider.api, models: patch.provider.models };
      }
      if (patch.roleAssignments) {
        const nextRoles: Record<string, string> = { ...(after.settings.value.modelRoles ?? {}) };
        for (const [role, selector] of Object.entries(patch.roleAssignments)) {
          if (selector === null || selector === "") delete nextRoles[role];
          else nextRoles[role] = selector;
        }
        after.settings.value.modelRoles = nextRoles;
      }
      if (patch.settings) {
        const s = after.settings.value;
        if (patch.settings.modelProviderOrder) s.modelProviderOrder = patch.settings.modelProviderOrder;
        if (patch.settings.enabledModels) s.enabledModels = patch.settings.enabledModels;
        if (patch.settings.disabledProviders) s.disabledProviders = patch.settings.disabledProviders;
        if (patch.settings.defaultThinkingLevel) s.defaultThinkingLevel = patch.settings.defaultThinkingLevel;
      }
      return {
        preview: { profile: before.profile, models: after.models.value, settings: after.settings.value, diagnostics: [], expectedModelsHash: before.models.hash, expectedSettingsHash: before.settings.hash, legacyMigrationApproved: true },
        modelsText: JSON.stringify(after.models.value, null, 2),
        settingsText: JSON.stringify(after.settings.value, null, 2),
      };
    },
    listSnapshots: async (profileId: string) => [1, 2].map((hoursAgo) => ({
      id: `demo-${hoursAgo}`, profile: profileId, createdAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
      modelsPath: "~/.omp/agent/models.yml", settingsPath: "~/.omp/agent/config.yml",
    })),
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
    listSessions: async () => ({
      sessions: [
        { id: "demo-session-1", profile: "default", title: "重构 provider 配置加载", model: "gpt-5", provider: "openai", messageCount: 12, requestCount: 6, tokens: { input: 18420, output: 5210 }, cost: 0.0842, failures: 0, stale: false, fileSize: 48211, startedAt: "2026-08-21T13:42:00Z", lastActiveAt: "2026-08-21T14:08:00Z" },
        { id: "demo-session-2", profile: "default", title: "排查缓存命中率为 0", model: "llama-3.3-70b", provider: "groq", messageCount: 6, requestCount: 4, tokens: { input: 9210, output: 1840 }, cost: 0.0118, failures: 1, stale: true, fileSize: 19840, startedAt: "2026-08-20T09:10:00Z", lastActiveAt: "2026-08-20T09:48:00Z" },
      ],
      nextCursor: undefined,
    }),
    readSessionMessages: async (_profileId, _sessionId) => ({
      messages: [
        { id: "m1", role: "system", text: "Session started with model openai/gpt-5", timestamp: "2026-08-21T13:42:00Z" },
        { id: "m2", role: "user", text: "帮我重构 provider 配置的加载逻辑，现在每次都重新解析整个文件。", timestamp: "2026-08-21T13:42:12Z" },
        { id: "m3", role: "assistant", model: "gpt-5", provider: "openai", status: "stop", text: "好的。当前 `loadProfile` 每次都调用 `yaml.parse`，可以缓存解析后的 Document。建议这样改：\n\n```ts\nconst cached = this.cache.get(path);\nif (cached && cached.sha === sha) return cached.doc;\n```\n\n这样在外部文件未变时跳过解析。", timestamp: "2026-08-21T13:43:05Z" },
        { id: "m4", role: "user", text: "缓存失效时呢？", timestamp: "2026-08-21T13:44:20Z" },
        { id: "m5", role: "assistant", model: "gpt-5", provider: "openai", status: "stop", text: "哈希不匹配就重新解析并替换缓存项。commitPatch 已经在写入前重算哈希，所以缓存和磁盘永远一致。", timestamp: "2026-08-21T13:44:58Z", truncated: true },
      ],
      hasMore: false, nextCursor: undefined,
    }),
    usageSummary: async () => {
      // Demo data: two models across two providers over several days, so the trend chart and the
      // in-row sparklines have something to draw. Numbers are illustrative, not from a real machine.
      const dayBucket = (key: string, requests: number, cost: number, input: number, output: number, cacheRead = 0, reasoning = 0) => ({
        key, requests, failures: 0, tokens: { input, output, cacheRead, cacheWrite: 0, reasoning, total: input + output + cacheRead + reasoning }, recordedCost: cost, computedCost: 0, pricedRequests: 0,
      });
      const modelDays = [
        dayBucket("2026-08-15", 38, 0.42, 920_000, 310_000, 640_000, 120_000),
        dayBucket("2026-08-16", 52, 0.61, 1_240_000, 402_000, 780_000, 180_000),
        dayBucket("2026-08-17", 29, 0.31, 710_000, 240_000, 510_000, 90_000),
        dayBucket("2026-08-18", 61, 0.74, 1_510_000, 488_000, 960_000, 210_000),
        dayBucket("2026-08-19", 44, 0.52, 1_080_000, 360_000, 720_000, 150_000),
        dayBucket("2026-08-20", 73, 0.88, 1_720_000, 540_000, 1_080_000, 260_000),
        dayBucket("2026-08-21", 58, 0.69, 1_380_000, 450_000, 880_000, 200_000),
      ];
      const groqDays = [
        dayBucket("2026-08-18", 12, 0.04, 180_000, 60_000),
        dayBucket("2026-08-19", 8, 0.03, 120_000, 40_000),
        dayBucket("2026-08-20", 19, 0.07, 260_000, 90_000),
      ];
      const sum = (days: typeof modelDays) => days.reduce((acc, day) => {
        acc.requests += day.requests;
        for (const k of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "total"] as const) acc.tokens[k] += day.tokens[k];
        acc.recordedCost += day.recordedCost;
        return acc;
      }, { requests: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 }, recordedCost: 0 });
      const openaiSum = sum(modelDays);
      const groqSum = sum(groqDays);
      return {
        report: {
          totals: { key: "total", requests: openaiSum.requests + groqSum.requests, failures: 3, tokens: { ...openaiSum.tokens, total: openaiSum.tokens.total + groqSum.tokens.total }, recordedCost: openaiSum.recordedCost + groqSum.recordedCost, computedCost: 0, pricedRequests: 0, firstAt: "2026-08-15T08:00:00Z", lastAt: "2026-08-21T22:00:00Z" },
          byModel: [
            { key: "openai/gpt-5", ...openaiSum, failures: 2, computedCost: 0, pricedRequests: 0 },
            { key: "groq/llama-3.3-70b", ...groqSum, failures: 1, computedCost: 0, pricedRequests: 0 },
          ],
          byProvider: [
            { key: "openai", ...openaiSum, failures: 2, computedCost: 0, pricedRequests: 0 },
            { key: "groq", ...groqSum, failures: 1, computedCost: 0, pricedRequests: 0 },
          ],
          byDay: modelDays.map((day) => ({ ...day, requests: day.requests + (groqDays.find((g) => g.key === day.key)?.requests ?? 0) })),
          byModelByDay: { "openai/gpt-5": modelDays, "groq/llama-3.3-70b": groqDays },
          byProviderByDay: { openai: modelDays, groq: groqDays },
          unpriced: ["openai/gpt-5", "groq/llama-3.3-70b"],
        },
        indexedEntries: 420,
        invalidLines: 0,
        pricedModels: 0,
        overrides: {},
      };
    },
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

/**
 * OMP filters its model catalog by `enabledModels`; a role pointing at a filtered model silently
 * no-ops (the incident class this guard exists for). String rules glob: a rule containing `/`
 * matches `provider/model`, a bare rule matches the model id.
 */
function makeEnabledFilter(rules: Array<string | Record<string, unknown>> | undefined): (providerId: string, modelId: string) => boolean {
  if (!rules?.length) return () => true;
  const matchers = rules
    .filter((rule): rule is string => typeof rule === "string")
    .map((rule) => {
      const pattern = new RegExp(`^${rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      return rule.includes("/")
        ? (providerId: string, modelId: string) => pattern.test(`${providerId}/${modelId}`)
        : (_providerId: string, modelId: string) => pattern.test(modelId);
    });
  return (providerId, modelId) => matchers.some((match) => match(providerId, modelId));
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
  const [profileTab, setProfileTab] = useState<"settings" | "project" | "snapshots" | "omp" | "oauth">("settings");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [conflictDetail, setConflictDetail] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmAsk, setConfirmAsk] = useState<{ title: string; message: string; confirmLabel: string; danger?: boolean; action: () => void } | null>(null);
  const [catalog, setCatalog] = useState<ProviderPreset[]>([]);
  const [providerOrder, setProviderOrder] = useState("");
  const [enabledModels, setEnabledModels] = useState("");
  const [disabledProviders, setDisabledProviders] = useState("");
  const [defaultThinkingLevel, setDefaultThinkingLevel] = useState<SettingsThinkingLevel>("auto");
  const [updatingOmp, setUpdatingOmp] = useState(false);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>("system");
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
  const enabledFilter = useMemo(() => makeEnabledFilter(config?.settings.value.enabledModels), [config]);

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
    setThemeChoice(initTheme());
    void api.getInfo().then((info) => setReadOnlyReason(info.installation.supported ? null : info.installation.reason ?? "当前 OMP 版本不受支持")).catch(() => undefined);
    void api.listProfiles().then((items) => {
      setProfiles(items);
      void load(items[0]?.id ?? "default");
    });
    void api.listCatalog().then((items) => setCatalog(items as ProviderPreset[])).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap; load() closes over the initial profileId by design
  }, []);

  useEffect(() => {
    function isTyping(target: EventTarget | null): boolean {
      return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    }
    function onKeyDown(event: KeyboardEvent): void {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (rolesDirty || settingsDirty) void saveDirty();
      } else if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      } else if (mod && /^[1-7]$/.test(event.key)) {
        event.preventDefault();
        const ids = Object.keys(sectionLabels) as Array<typeof section>;
        const target = ids[Number(event.key) - 1];
        if (target) { setSection(target); setFormOpen(false); setDrawerOpen(false); }
      } else if (event.key === "?" && !isTyping(event.target)) {
        event.preventDefault();
        setHelpOpen(true);
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
    const id = form.id.trim();
    try {
      let apiKeyValue: string | null | undefined = form.auth === "none" ? null : config.models.value.providers[id]?.apiKey;
      let auth = form.auth;
      if (form.key.trim()) {
        const credential = await api.secretPut({ label: `${id} API key`, value: form.key.trim() });
        apiKeyValue = `!${credential.command}`;
        auth = "apiKey";
      }
      const models = buildModels(modelEntries).map((model) => ({ ...model, api: model.api ?? form.api }));
      await requestSave(`保存供应商 ${id}`, {
        provider: {
          id,
          baseUrl: form.baseUrl.trim(),
          api: form.api,
          auth,
          apiKey: apiKeyValue,
          headers: parseHeaders(form.headers),
          compat: parseObjectJson("Compat", form.compat),
          modelOverrides: parseModelOverrides(form.overrides),
          models,
          ...(form.discoveryType ? { discovery: { type: form.discoveryType } } : {}),
          authHeader: form.authHeader,
          disableStrictTools: form.disableStrictTools,
          ...(form.transport.trim() ? { transport: form.transport.trim() } : {}),
          remoteCompaction: parseObjectJson("Remote compaction", form.remoteCompaction),
          cost: parseCost(form.cost),
        },
      }, () => {
        setSelectedProviderId(id);
        setFormOpen(false);
        setDrawerOpen(true);
        notify({ tone: "success", text: `已保存 ${id} → models.yml` });
      });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  function removeProvider(): void {
    if (!config || !selectedProviderId) return;
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? "当前配置为只读" });
      return;
    }
    const target = selectedProviderId;
    setConfirmAsk({
      title: `删除供应商 ${target}`,
      message: "该供应商及其模型将从 models.yml 移除；原配置保留在写入前快照中，可从快照时间线恢复。",
      confirmLabel: "删除",
      danger: true,
      action: () => {
        void requestSave(`删除供应商 ${target}`, { removeProviderId: target }, () => {
          setSelectedProviderId(Object.keys(config?.models.value.providers ?? {}).find((id) => id !== target) ?? null);
          setFormOpen(false);
          notify({ tone: "success", text: `已从 models.yml 移除 ${target}` });
        });
      },
    });
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

  function isConflictError(message: string): boolean {
    return message.includes("Configuration changed outside OMP Switch");
  }

  function handleSaveError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (isConflictError(message)) setConflictDetail(message.replace(/^Error invoking remote method '[^']+':\s*/, ""));
    else notify({ tone: "error", text: message });
  }

  /**
   * Two-step save. Every commit first shows a preview of the exact text both files would receive;
   * `commitPatch` re-plans and re-guards at confirm time, so an edit that lands between preview
   * and confirm still fails safely instead of overwriting.
   */
  async function requestSave(title: string, patch: ConfigPatch, done?: () => void): Promise<void> {
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? "当前配置为只读" });
      return;
    }
    if (config?.models.legacy) {
      setConfirmAsk({
        title: "迁移旧 models.json",
        message: "检测到旧 models.json。继续将写入 models.yml；旧文件会保留在写入前快照中。",
        confirmLabel: "继续并迁移",
        action: () => { void runSave(title, { ...patch, confirmLegacyMigration: true }, done); },
      });
      return;
    }
    await runSave(title, patch, done);
  }

  async function runSave(title: string, patch: ConfigPatch, done?: () => void): Promise<void> {
    setBusy(true);
    try {
      const preview = await api.preview(profileId, patch);
      setPendingSave({
        title,
        beforeModels: config?.models.raw ?? "",
        beforeSettings: config?.settings.raw ?? "",
        afterModels: preview.modelsText,
        afterSettings: preview.settingsText,
        commit: async () => {
          const result = await api.save(profileId, patch);
          applyConfig(result.config);
          setSnapshot(result.snapshot);
          done?.();
        },
      });
    } catch (error) {
      handleSaveError(error);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPendingSave(): Promise<void> {
    if (!pendingSave) return;
    setBusy(true);
    try {
      await pendingSave.commit();
      setPendingSave(null);
    } catch (error) {
      setPendingSave(null);
      handleSaveError(error);
    } finally {
      setBusy(false);
    }
  }

  function saveRoles(): Promise<void> {
    return requestSave("保存角色映射", { roleAssignments: roles }, () => notify({ tone: "success", text: "角色映射已写入 config.yml" }));
  }

  function saveSettings(): Promise<void> {
    return requestSave("保存设置", { settings: settingsPatch() }, () => notify({ tone: "success", text: "设置已写入 config.yml" }));
  }

  function settingsPatch(): NonNullable<ConfigPatch["settings"]> {
    return {
      modelProviderOrder: providerOrder.split(",").map((value) => value.trim()).filter(Boolean),
      enabledModels: parseEnabledModelRules(enabledModels),
      disabledProviders: parseDisabledProviderRules(disabledProviders),
      defaultThinkingLevel,
    };
  }

  /** One commit when both areas are dirty, otherwise whichever is — this is what Ctrl+S runs. */
  function saveDirty(): Promise<void> {
    if (rolesDirty && settingsDirty) return requestSave("保存角色与设置", { roleAssignments: roles, settings: settingsPatch() }, () => notify({ tone: "success", text: "角色与设置已写入 config.yml" }));
    if (rolesDirty) return saveRoles();
    if (settingsDirty) return saveSettings();
    return Promise.resolve();
  }

  /**
   * Only switching profile actually loses edits (load() overwrites editor state); switching
   * sections keeps them in memory, so no guard there — the confirm would be both naggy and wrong.
   */
  function confirmDiscardThen(action: () => void): void {
    if (!rolesDirty && !settingsDirty) { action(); return; }
    setConfirmAsk({
      title: "放弃未保存的改动？",
      message: "有未保存的角色或设置改动，切换 Profile 将丢失这些改动。文件本身不受影响。",
      confirmLabel: "放弃并切换",
      danger: true,
      action,
    });
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
  // Nav groups, so the seven modules read as three sections instead of a flat list. The order of
  // groups and items matches the sectionLabels keys; the grouping is presentational only.
  const navGroups: Array<{ title: string; items: Array<keyof typeof sectionLabels> }> = [
    { title: "配置", items: ["models", "roles"] },
    { title: "内容", items: ["prompts", "skills", "sessions"] },
    { title: "运维", items: ["usage", "gateway"] },
  ];

  return (
    <Tooltip.Provider delayDuration={350}>
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Sparkles size={16} /></div>
          <div className="brand-name">OMP Switch</div>
        </div>
        <div className="topbar-center">
          <button className="profile-chip" title="打开 Profile" onClick={() => { setProfileTab("settings"); setProfileDrawerOpen(true); setDrawerOpen(true); }}>
            <span className="status-led" />{profiles.find((profile) => profile.id === profileId)?.name ?? profileId}<ChevronDown size={14} />
          </button>
          <button className={`status-chip ${readOnly ? "warning" : errorDiagnostics.length ? "danger" : "ok"}`} onClick={() => { setDiagnosticsOpen(true); setDrawerOpen(true); }}>
            <ShieldCheck size={14} />{healthLabel}
          </button>
        </div>
        <div className="topbar-actions">
            <IconButtonTip label="刷新"><button className="icon-button" onClick={() => void load(profileId)} disabled={busy}><RefreshCw size={17} className={busy ? "spin" : ""} /></button></IconButtonTip>
            <IconButtonTip label="创建快照"><button className="icon-button" onClick={() => void createSnapshot()} disabled={busy}><ArchiveRestore size={17} /></button></IconButtonTip>
            <ThemeSwitch value={themeChoice} onChange={setThemeChoice} />
            <button className="primary-button compact" title="保存全部未保存改动 (Ctrl+S)" onClick={() => void saveDirty()} disabled={busy || readOnly || (!rolesDirty && !settingsDirty)}><Save size={15} />保存</button>
        </div>
      </header>

      <main className="app-body">
        <aside className="left-rail">
          <div className="rail-profile">
            <span className="rail-label">PROFILE</span>
            <StyledSelect
              value={profileId}
              onValueChange={(next) => confirmDiscardThen(() => { setProfileId(next); void load(next); })}
              options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
              ariaLabel="选择 Profile"
            />
            <span className="path-note" title={config?.profile.agentDir}>{config?.profile.agentDir ?? "读取中"}</span>
          </div>
          <nav className="section-nav" aria-label="模块">
            {navGroups.map((group) => <div className="nav-group" key={group.title}>
              <span className="nav-group-title">{group.title}</span>
              {group.items.map((item) => (
                <button key={item} className={section === item ? "active" : ""} onClick={() => { setSection(item); setFormOpen(false); setDrawerOpen(false); }}>
                  <span className="nav-icon">{item === "models" ? <CloudDownload size={16} /> : item === "roles" ? <Users size={16} /> : item === "prompts" ? <FileCheck2 size={16} /> : item === "skills" ? <Sparkles size={16} /> : item === "sessions" ? <Activity size={16} /> : item === "usage" ? <Coins size={16} /> : <ShieldCheck size={16} />}</span>
                  <span>{sectionLabels[item]}</span>
                  {item === "models" ? <span className="nav-count">{providers.length}</span> : null}
                  {item === "roles" && rolesDirty ? <span className="nav-dot" title="有未保存的角色改动" /> : null}
                </button>
              ))}
            </div>)}
          </nav>
          <div className="rail-footer">
            <button className="rail-action" onClick={() => { setDiagnosticsOpen(true); setDrawerOpen(true); }}><CircleAlert size={15} />诊断<span>{errorDiagnostics.length}</span></button>
            <button className="rail-action" onClick={() => { setProfileTab("settings"); setProfileDrawerOpen(true); setDrawerOpen(true); }}><Settings2 size={15} />Profile{settingsDirty ? <span className="nav-dot" title="设置有未保存改动" /> : null}</button>
          </div>
        </aside>

        <section className="workspace-main">
          <div className="section-view" key={section}>
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
              {filteredProviders.length === 0 ? <div className="empty-workspace"><span className="empty-glyph"><CloudDownload size={30} /></span><strong>{providers.length ? "没有匹配的供应商" : "还没有供应商"}</strong><span className="empty-desc">{providers.length ? "调整筛选条件，或新增一个供应商。" : "新增第一个供应商，开始管理你的 OMP 模型目录。"}</span><div className="empty-actions"><button className="primary-button" onClick={beginAdd} disabled={readOnly}><Plus size={15} />新增供应商</button></div></div> : null}
              <div className="provider-stack">
                {filteredProviders.map(([id, provider]) => {
                  const expanded = expandedProviders[id] ?? false;
                  const models = providerModels(provider);
                  const coverage = models.filter((model) => enabledFilter(id, model.id ?? "")).length;
                  return <article className="provider-card" key={id}>
                    <div className="provider-card-head">
                      <button
                        className="provider-card-toggle"
                        onClick={() => setExpandedProviders((current) => ({ ...current, [id]: !expanded }))}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "收起" : "展开"} ${id} 的模型列表`}
                      >
                        <span className="provider-led" />
                        <span className="provider-title"><strong>{id}</strong><small>{provider.api ?? "custom"}</small></span>
                        <span className="provider-model-count">{models.length}</span>
                        <ChevronDown size={16} className={`provider-chevron${expanded ? " open" : ""}`} />
                      </button>
                      <IconButtonTip label={`编辑 ${id}`}>
                        <button className="provider-edit" aria-label={`编辑 ${id}`} onClick={() => editProvider(id)}><Pencil size={15} /></button>
                      </IconButtonTip>
                    </div>
                    <div className={`model-list-wrap${expanded ? " open" : ""}`}>
                      <div className="model-list-clip">
                        <div className="provider-meta-bar">
                          <span className="provider-meta-endpoint mono" title={provider.baseUrl ?? ""}>{provider.baseUrl ?? "无端点"}</span>
                          <span className="provider-meta-sep">·</span>
                          <span className={`provider-meta-status ${provider.auth === "none" ? "ok" : provider.apiKey ? "ok" : "warn"}`}>{provider.auth === "none" ? "无需密钥" : provider.apiKey ? "已配置密钥" : "未配置密钥"}</span>
                          {models.length > 0 && coverage < models.length ? <>
                            <span className="provider-meta-sep">·</span>
                            <span className="provider-meta-coverage warn-line" title="enabledModels 未完全覆盖此供应商，OMP 会将未覆盖的模型过滤出目录">{coverage === 0 ? "未启用" : `启用 ${coverage}/${models.length}`}</span>
                          </> : null}
                        </div>
                        <div className="model-list">
                          {models.map((model) => <div
                            className="model-row"
                            key={model.id}
                          >
                            <span className="model-name"><strong>{model.name ?? model.id}</strong><small>{model.id}</small></span>
                            <span className="model-api">{model.api ?? provider.api ?? "—"}</span>
                            <span className="model-context">{typeof model.contextWindow === "number" ? model.contextWindow.toLocaleString() : "—"}</span>
                            <span className="capabilities"><span className={model.reasoning ? "capability on" : "capability"}>{model.reasoning ? "思考" : "标准" }</span><span className="capability">{model.input?.includes("image") ? "视觉" : "文本"}</span></span>
                            <QuickAssign roles={roleIds} assignments={roles} providerId={id} modelId={model.id ?? ""} providerIds={providerIds} onAssign={(roleId) => assignModelToRole(roleId, id, model.id ?? "")} onOpenRoles={() => { setSection("roles"); setFormOpen(false); setDrawerOpen(false); }} />
                          </div>)}
                          {models.length === 0 ? <div className="model-empty">暂无模型 · 点击「编辑」添加</div> : null}
                        </div>
                      </div>
                    </div>
                  </article>;
                })}
              </div>
            </>
          ) : section === "roles" ? <RolesModule providers={providers} roleIds={roleIds} roles={roles} baseline={savedRoles} readOnly={readOnly} busy={busy} onRoleChange={setRoleValue} onSave={() => void saveDirty()} isEnabled={enabledFilter} />
            : section === "prompts" ? <SurfaceModule api={api} profileId={profileId} kind="prompt" readOnly={readOnly} onNotice={notify} />
            : section === "skills" ? <SurfaceModule api={api} profileId={profileId} kind="skill" readOnly={readOnly} onNotice={notify} />
              : section === "sessions" ? <SessionsModule api={api} profileId={profileId} onNotice={notify} />
              : section === "usage" ? <UsageModule api={api} profileId={profileId} onNotice={notify} />
                : <GatewayModule api={api} profileId={profileId} readOnly={readOnly} onNotice={notify} providers={providers} />}
          </div>
        </section>

        <AnimatePresence>
          {(drawerOpen || formOpen || profileDrawerOpen || diagnosticsOpen) ? <motion.aside
            className="detail-drawer"
            key="detail-drawer"
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 32 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
          >
          <div className="drawer-head"><div><span className="eyebrow">{profileDrawerOpen ? "PROFILE" : diagnosticsOpen ? "DIAGNOSTICS" : formOpen ? (editingProviderId ? "编辑" : "新增") : "PROVIDER"}</span><h2>{profileDrawerOpen ? profileId : diagnosticsOpen ? "诊断" : formOpen ? (editingProviderId ?? "新供应商") : selectedProviderId ?? "详情"}</h2></div><button className="icon-button" title="关闭" onClick={() => { setDrawerOpen(false); setFormOpen(false); setProfileDrawerOpen(false); setDiagnosticsOpen(false); }}><X size={17} /></button></div>

          {profileDrawerOpen ? <div className="drawer-body profile-drawer">
            <div className="profile-tabs" role="tablist">
              <button role="tab" aria-selected={profileTab === "settings"} className={profileTab === "settings" ? "active" : ""} onClick={() => setProfileTab("settings")}><Settings2 size={14} />设置</button>
              <button role="tab" aria-selected={profileTab === "project"} className={profileTab === "project" ? "active" : ""} onClick={() => setProfileTab("project")}><FolderOpen size={14} />项目</button>
              <button role="tab" aria-selected={profileTab === "snapshots"} className={profileTab === "snapshots" ? "active" : ""} onClick={() => setProfileTab("snapshots")}><ArchiveRestore size={14} />快照</button>
              <button role="tab" aria-selected={profileTab === "omp"} className={profileTab === "omp" ? "active" : ""} onClick={() => setProfileTab("omp")}><RefreshCw size={14} />OMP</button>
              <button role="tab" aria-selected={profileTab === "oauth"} className={profileTab === "oauth" ? "active" : ""} onClick={() => setProfileTab("oauth")}><KeyRound size={14} />OAuth</button>
            </div>
            {profileTab === "settings" ? <>
            <div className="drawer-section"><div className="drawer-section-title"><span>角色</span><Users size={15} /></div><span className="muted-line">模型角色的分配已移至独立的「角色」页面，可直接按供应商选择模型。</span><div className="drawer-actions"><button className="secondary-button" onClick={() => { setSection("roles"); setProfileDrawerOpen(false); setDrawerOpen(false); }}><Users size={15} />打开角色页</button></div></div>
            <div className="drawer-section"><div className="drawer-section-title"><span>选择</span>{settingsDirty ? <span className="heading-dirty">未保存</span> : <Settings2 size={15} />}</div><label className="module-field"><span>Provider 顺序</span><input value={providerOrder} onChange={(event) => setProviderOrder(event.target.value)} placeholder="openrouter, openai" /></label><label className="module-field"><span>启用模型</span><textarea value={enabledModels} onChange={(event) => setEnabledModels(event.target.value)} rows={3} placeholder={"provider/*\n[{\"path\":\"~/work\",\"models\":[\"provider/model\"]}]"} /></label><label className="module-field"><span>禁用 Provider</span><textarea value={disabledProviders} onChange={(event) => setDisabledProviders(event.target.value)} rows={2} placeholder={"ollama, native"} /></label><label className="module-field"><span>默认思考</span><StyledSelect value={defaultThinkingLevel} onValueChange={(next) => setDefaultThinkingLevel(next as SettingsThinkingLevel)} options={SETTINGS_THINKING_LEVELS.map((level) => ({ value: level, label: level }))} ariaLabel="默认思考等级" mono /></label><button className="primary-button full-width" onClick={() => void saveSettings()} disabled={busy || readOnly || !settingsDirty}><Save size={15} />保存设置</button></div>
            </> : null}
            {profileTab === "project" ? <div className="drawer-section"><div className="drawer-section-title"><span>项目覆盖</span><FolderOpen size={15} /></div><ProjectOverlayBadge api={api} profileId={profileId} onNotice={notify} /></div> : null}
            {profileTab === "snapshots" ? <div className="drawer-section"><div className="drawer-section-title"><span>快照</span><ArchiveRestore size={15} /></div><div className="drawer-actions"><button className="secondary-button" onClick={() => void createSnapshot()} disabled={busy}><ArchiveRestore size={15} />创建快照</button></div><SnapshotTimeline api={api} profileId={profileId} busy={busy} onRestored={(restored, snap) => { applyConfig(restored); setSnapshot(snap); }} onNotice={notify} /><span className="muted-line">{snapshot ? `最近一次写入 ${formatDate(snapshot.createdAt)}` : "写入前自动创建快照，最多保留 30 个"}</span></div> : null}
            {profileTab === "omp" ? <>
            <div className="drawer-section"><div className="drawer-section-title"><span>OMP</span><RefreshCw size={15} /></div><div className="drawer-actions"><button className="secondary-button" onClick={() => void updateOmp()} disabled={busy || updatingOmp || readOnly}><RefreshCw size={14} className={updatingOmp ? "spin" : ""} />更新</button><button className="secondary-button" onClick={() => void exportCatalog()} disabled={busy}><Download size={14} />目录</button></div></div>
            <details className="yaml-preview"><summary>原始 YAML</summary><YamlPreview files={[{ name: "models.yml", content: config?.models.raw || "# models.yml 未创建" }, { name: "config.yml", content: config?.settings.raw || "# config.yml 未创建" }]} /></details>
            </> : null}
            {profileTab === "oauth" ? <div className="drawer-section"><div className="drawer-section-title"><span>OAuth</span><KeyRound size={16} /></div><div className="drawer-actions"><button className="secondary-button" onClick={() => void checkAuth("openai-codex", "status")} disabled={busy}>Codex</button><button className="secondary-button" onClick={() => void checkAuth("anthropic", "status")} disabled={busy}>Anthropic</button></div>{authResult ? <span className="muted-line">{authResult}</span> : null}</div> : null}
          </div> : null}

          {diagnosticsOpen ? (() => {
            const diags = config?.diagnostics ?? [];
            const errors = diags.filter((d) => d.severity === "error");
            const warnings = diags.filter((d) => d.severity === "warning");
            const infos = diags.filter((d) => d.severity === "info");
            const groups: Array<{ key: "error" | "warning" | "info"; label: string; items: typeof diags }> = [
              { key: "error", label: "错误", items: errors },
              { key: "warning", label: "警告", items: warnings },
              { key: "info", label: "信息", items: infos },
            ].filter((g) => g.items.length > 0) as Array<{ key: "error" | "warning" | "info"; label: string; items: typeof diags }>;
            return <div className="drawer-body">
              <div className="diag-summary">
                <div className="diag-summary-status">
                  <span className={`status-led ${errors.length ? "danger" : warnings.length ? "warn" : "ok"}`} />
                  <strong>{errors.length ? "存在问题" : warnings.length ? "有警告" : "配置正常"}</strong>
                </div>
                <div className="diag-summary-counts">
                  <span className={`diag-count ${errors.length ? "danger" : ""}`}><strong>{errors.length}</strong>错误</span>
                  <span className={`diag-count ${warnings.length ? "warn" : ""}`}><strong>{warnings.length}</strong>警告</span>
                  <span className="diag-count"><strong>{infos.length}</strong>信息</span>
                </div>
              </div>
              {diags.length === 0 ? <span className="muted-line diag-empty">暂无诊断。写入前会自动校验，遇到问题会在此列出。</span> : groups.map((group) => <div className="diag-group" key={group.key}>
                <div className="diag-group-title">{group.label}<span className="status-chip neutral">{group.items.length}</span></div>
                {group.items.map((item, index) => <div className="diagnostic-row" key={`${item.code}-${index}`}><span className={`diag-icon ${item.severity}`}><CircleAlert size={14} /></span><span><strong>{item.code}</strong><small>{item.message}</small></span></div>)}
              </div>)}
            </div>;
          })() : null}


          {!profileDrawerOpen && !diagnosticsOpen && formOpen ? <div className="drawer-body form-drawer">
            <div className="form-group">
              <div className="form-group-title"><span>身份</span></div>
              <label className="module-field"><span>预设</span><StyledSelect value={form.id} onValueChange={(next) => choosePreset(next)} options={[{ value: "", label: "自定义" }, ...(catalog.length ? catalog : FALLBACK_PRESETS).map((preset) => ({ value: preset.id, label: preset.label }))]} ariaLabel="选择预设" /></label>
              <div className="form-two"><label className="module-field"><span>ID</span><input readOnly={Boolean(editingProviderId)} value={form.id} onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))} placeholder="openrouter" /></label><label className="module-field"><span>API</span><input list="omp-api-options" value={form.api} onChange={(event) => setForm((current) => ({ ...current, api: event.target.value }))} /><datalist id="omp-api-options"><option value="openai-completions" /><option value="openai-responses" /><option value="anthropic-messages" /><option value="openai-codex-responses" /></datalist></label></div>
            </div>
            <div className="form-group">
              <div className="form-group-title"><span>连接</span></div>
              <label className="module-field"><span>Endpoint</span><input value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1" /></label>
              <div className="form-two"><label className="module-field"><span>认证方式</span><StyledSelect value={form.auth} onValueChange={(next) => setForm((current) => ({ ...current, auth: next }))} options={[{ value: "apiKey", label: "apiKey" }, { value: "none", label: "none" }, { value: "oauth", label: "oauth" }]} ariaLabel="认证方式" mono /></label><label className="module-field"><span>密钥</span><input type="password" value={form.key} onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))} placeholder="留空保留" /></label></div>
              <span className="form-group-hint">OMP 以 <code className="inline-code">!command</code> 形式读取密钥；密钥经 DPAPI 加密存入本地凭据库，永远不会写入 OMP 配置文件。</span>
            </div>
            <div className="form-group">
              <div className="form-group-title"><span>模型</span><button className="icon-button" title="添加模型" onClick={() => setModelEntries((current) => [...current, createModelEditorEntry()])}><Plus size={15} /></button></div>
              <div className="model-editor">{modelEntries.map((entry, index) => <div className="model-editor-card" key={`${entry.raw.id}-${index}`}><div className="model-editor-row"><input aria-label={`模型 ${index + 1} ID`} value={entry.id} onChange={(event) => updateModelEntry(index, { id: event.target.value })} placeholder="Model ID" /><input aria-label={`模型 ${index + 1} 名称`} value={entry.name} onChange={(event) => updateModelEntry(index, { name: event.target.value })} placeholder="名称" /><input aria-label={`模型 ${index + 1} Context`} inputMode="numeric" value={entry.contextWindow} onChange={(event) => updateModelEntry(index, { contextWindow: event.target.value })} placeholder="Context" /><input aria-label={`模型 ${index + 1} Max output`} inputMode="numeric" value={entry.maxTokens} onChange={(event) => updateModelEntry(index, { maxTokens: event.target.value })} placeholder="Max" /><label className="check-line"><input type="checkbox" checked={entry.reasoning} onChange={(event) => updateModelEntry(index, { reasoning: event.target.checked })} />思考</label><label className="check-line"><input type="checkbox" checked={entry.vision} onChange={(event) => updateModelEntry(index, { vision: event.target.checked })} />视觉</label><button className="icon-button subtle danger" title="删除模型" onClick={() => setModelEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div><details className="model-advanced"><summary>高级</summary><div className="model-advanced-grid"><label>API<input value={entry.api} onChange={(event) => updateModelEntry(index, { api: event.target.value })} placeholder="继承 Provider" /></label><label>Transport<input value={entry.transport} onChange={(event) => updateModelEntry(index, { transport: event.target.value })} placeholder="pi-native" /></label><label>图片解码<input value={entry.imageInputDecoder} onChange={(event) => updateModelEntry(index, { imageInputDecoder: event.target.value })} placeholder="stb" /></label><label>Headers<textarea value={entry.headers} onChange={(event) => updateModelEntry(index, { headers: event.target.value })} rows={2} placeholder='{"X-Client":"omp-switch"}' /></label><label>Compat<textarea value={entry.compat} onChange={(event) => updateModelEntry(index, { compat: event.target.value })} rows={2} /></label><label>远程压缩<textarea value={entry.remoteCompaction} onChange={(event) => updateModelEntry(index, { remoteCompaction: event.target.value })} rows={2} placeholder='{"enabled":true}' /></label><label>Cost<textarea value={entry.cost} onChange={(event) => updateModelEntry(index, { cost: event.target.value })} rows={2} placeholder='{"input":0.1,"output":0.4}' /></label></div></details></div>)}{!modelEntries.length ? <span className="muted-line">暂无模型 · 点击右上「+」添加</span> : null}</div>
            </div>
            <div className="form-group">
              <button className="drawer-disclosure form-group-disclosure" onClick={() => setAdvancedOpen((value) => !value)}><span>Provider 高级</span><ChevronDown size={15} className={advancedOpen ? "rotate-open" : ""} /></button>{advancedOpen ? <div className="advanced-fields"><div className="form-two"><label className="module-field"><span>发现</span><StyledSelect value={form.discoveryType} onValueChange={(next) => setForm((current) => ({ ...current, discoveryType: next }))} options={[{ value: "", label: "手动" }, { value: "openai-models-list", label: "OpenAI" }, { value: "ollama", label: "Ollama" }, { value: "llama.cpp", label: "llama.cpp" }, { value: "lm-studio", label: "LM Studio" }, { value: "proxy", label: "Proxy" }, { value: "litellm", label: "LiteLLM" }]} ariaLabel="模型发现方式" /></label><label className="module-field"><span>Transport</span><input value={form.transport} onChange={(event) => setForm((current) => ({ ...current, transport: event.target.value }))} placeholder="pi-native" /></label></div><div className="form-two"><label className="check-line"><input type="checkbox" checked={form.authHeader} onChange={(event) => setForm((current) => ({ ...current, authHeader: event.target.checked }))} />Auth header</label><label className="check-line"><input type="checkbox" checked={form.disableStrictTools} onChange={(event) => setForm((current) => ({ ...current, disableStrictTools: event.target.checked }))} />宽松工具</label></div><label className="module-field"><span>Headers</span><textarea value={form.headers} onChange={(event) => setForm((current) => ({ ...current, headers: event.target.value }))} rows={3} placeholder='{"X-Client":"omp-switch"}' /></label><label className="module-field"><span>Compat</span><textarea value={form.compat} onChange={(event) => setForm((current) => ({ ...current, compat: event.target.value }))} rows={3} /></label><label className="module-field"><span>Overrides</span><textarea value={form.overrides} onChange={(event) => setForm((current) => ({ ...current, overrides: event.target.value }))} rows={3} /></label><label className="module-field"><span>远程压缩</span><textarea value={form.remoteCompaction} onChange={(event) => setForm((current) => ({ ...current, remoteCompaction: event.target.value }))} rows={3} placeholder='{"enabled":true,"endpoint":"https://..."}' /></label><label className="module-field"><span>Cost</span><textarea value={form.cost} onChange={(event) => setForm((current) => ({ ...current, cost: event.target.value }))} rows={2} placeholder='{"input":0.1,"output":0.4}' /></label></div> : null}
            </div>
            <div className="drawer-actions form-submit-actions"><button className="secondary-button" onClick={() => void fetchModels()} disabled={busy}><CloudDownload size={15} />测试并发现</button><button className="primary-button" onClick={() => void saveProvider()} disabled={busy || readOnly}><Save size={15} />保存</button></div>
          </div> : null}


          {!profileDrawerOpen && !diagnosticsOpen && !formOpen && selectedProvider ? <div className="drawer-body"><div className="drawer-section"><div className="drawer-section-title"><span>连接</span><span className="status-chip ok">{selectedProvider.auth === "none" ? "无需密钥" : selectedProvider.apiKey ? "已配置" : "未配置"}</span></div><div className="detail-grid"><span>API</span><strong>{selectedProvider.api ?? "custom"}</strong><span>Endpoint</span><strong className="mono break">{selectedProvider.baseUrl ?? "—"}</strong><span>Auth</span><strong>{selectedProvider.auth ?? "apiKey"}</strong></div><div className="drawer-actions"><button className="primary-button" onClick={() => editProvider(selectedProviderId!)}><Sparkles size={15} />编辑</button><button className="icon-button danger" title="删除供应商" onClick={() => void removeProvider()} disabled={busy || readOnly}><Trash2 size={15} /></button></div></div><div className="drawer-section"><div className="drawer-section-title"><span>模型</span><span className="status-chip neutral">{selectedModels.length}</span></div>{selectedModels.map((model) => <div className="mini-model" key={model.id}><strong>{model.name ?? model.id}</strong><span>{model.id}</span></div>)}</div></div> : null}
          </motion.aside> : null}
        </AnimatePresence>
      </main>
      <SavePreviewDialog pending={pendingSave} busy={busy} onClose={() => setPendingSave(null)} onConfirm={() => void confirmPendingSave()} />
      <ConflictDialog detail={conflictDetail} busy={busy} onClose={() => setConflictDetail(null)} onReload={() => { setConflictDetail(null); void load(profileId); }} />
      <ConfirmDialog open={Boolean(confirmAsk)} title={confirmAsk?.title ?? ""} message={confirmAsk?.message ?? ""} confirmLabel={confirmAsk?.confirmLabel ?? "确认"} danger={confirmAsk?.danger} busy={busy} onClose={() => setConfirmAsk(null)} onConfirm={() => { const ask = confirmAsk; setConfirmAsk(null); ask?.action(); }} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        sections={(Object.keys(sectionLabels) as Array<typeof section>).map((id) => ({ id, label: sectionLabels[id] }))}
        profiles={profiles}
        providers={providers.map(([id, provider]) => ({ id, modelCount: providerModels(provider).length }))}
        activeProfileId={profileId}
        onNavigate={(id) => { setSection(id as typeof section); setFormOpen(false); setDrawerOpen(false); }}
        onSwitchProfile={(id) => confirmDiscardThen(() => { setProfileId(id); void load(id); })}
        onSelectProvider={(id) => { setSection("models"); setSelectedProviderId(id); setExpandedProviders((current) => ({ ...current, [id]: true })); setFormOpen(false); setDrawerOpen(true); }}
        actions={[
          { id: "new-provider", label: "新建供应商", run: beginAdd },
          { id: "save-all", label: "保存全部未保存改动", run: () => { void saveDirty(); } },
          { id: "snapshot", label: "创建快照", run: () => { void createSnapshot(); } },
          { id: "reload", label: "重新加载当前 Profile", run: () => { void load(profileId); } },
          { id: "help", label: "快捷键说明", run: () => setHelpOpen(true) },
        ]}
      />
      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <Toaster position="bottom-right" theme="system" closeButton toastOptions={{ classNames: { info: "toast-info" } }} />
    </div>
    </Tooltip.Provider>
  );
}
