import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Toaster, toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ArrowUp,
  ArchiveRestore,
  Check,
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
  Zap,
} from "lucide-react";
import type {
  CompactionSettings,
  ConfigPatch,
  DiscoveryResult,
  EffectiveConfig,
  OmpModel,
  OmpProvider,
  ProviderPreset,
  ProfileRef,
  SettingsThinkingLevel,
  Snapshot,
  UpdateStatus,
} from "@omp-switch/core";
import { CODE_MODE_VALUES, KNOWN_TOKENIZER_FAMILIES, PERSONALITY_PRESETS, SETTINGS_THINKING_LEVELS, UNEXPECTED_STOP_MODES, UPDATE_CHANNELS, type UnexpectedStopMode, type UpdateChannel, parseRoleSelector } from "@omp-switch/core/validation";
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
import { LocaleSwitch } from "./components/locale-switch";
import { initTheme, type ThemeChoice } from "./theme";
import { initLocale, formatDateTime, type LocaleChoice } from "./locale";
import {
  effectivePreferredProviderId,
  isProviderDisabled,
  mergeProviderApplyDraft,
  providerApplyBlockReason,
  type DisabledProviderRule,
  type ProviderApplyBlockReason,
} from "./provider-selection";
import i18n from "./i18n";

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
  codeMode: string;
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
    codeMode: "",
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
  tokenizer: string;
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
    tokenizer: typeof model.tokenizer === "string" ? model.tokenizer : "",
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
    tokenizer: "",
  };
}

function parseOptionalPositiveInteger(label: string, value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} ${i18n.t("models.positiveIntRequired")}`);
  return parsed;
}

function buildModels(entries: ModelEditorEntry[]): OmpModel[] {
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
    models: { value: { providers: { openrouter: { baseUrl: "https://openrouter.ai/api/v1", api: "openai-completions", auth: "apiKey", apiKey: "OPENROUTER_API_KEY", models: [{ id: "openai/gpt-4.1", name: "GPT-4.1", reasoning: true, contextWindow: 128000, maxTokens: 16384 }] } } }, raw: "# OMP model providers\nproviders:\n  openrouter:\n    baseUrl: \"https://openrouter.ai/api/v1\"\n    api: openai-completions\n    # auth resolves the key via the secret bridge\n    auth: apiKey\n    models:\n      - id: openai/gpt-4.1\n        name: \"GPT-4.1\"\n        contextWindow: 128000\n        maxTokens: 16384\n", path: "~/.omp/agent/models.yml", hash: "demo", exists: true, legacy: false, diagnostics: [] },
    settings: { value: { modelRoles: { default: "openrouter/openai/gpt-4.1", slow: "@default" } }, raw: "modelRoles:\n  default: openrouter/openai/gpt-4.1\n  slow: \"@default\"\n", path: "~/.omp/agent/config.yml", hash: "demo-settings", exists: true, legacy: false, diagnostics: [] },
    diagnostics: [],
  });
  // Translate demo diagnostics at read time so a language switch does not freeze them in zh.
  const get = (id: string) => {
    const config = (memory[id] ??= makeConfig(id));
    config.models.diagnostics = [
      { code: "provider.api-unknown", severity: "warning", message: i18n.t("models.demoApiUnknown") },
      { code: "provider.apiKey-fragile-command", severity: "info", message: i18n.t("models.demoApiKeyFragile") },
    ];
    config.diagnostics = [{ severity: "info", code: "demo", message: i18n.t("models.demoPreviewNotice") }];
    return config;
  };
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
        if (patch.settings.compaction !== undefined) s.compaction = patch.settings.compaction;
        if (patch.settings.extendedContext !== undefined) s.extendedContext = patch.settings.extendedContext;
        if (patch.settings.externalThinking !== undefined) s.externalThinking = patch.settings.externalThinking;
        if (patch.settings.personality !== undefined) s.personality = patch.settings.personality;
        if (patch.settings.images !== undefined) s.images = patch.settings.images;
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
        if (patch.settings.compaction !== undefined) settings.compaction = patch.settings.compaction;
        if (patch.settings.extendedContext !== undefined) settings.extendedContext = patch.settings.extendedContext;
        if (patch.settings.externalThinking !== undefined) settings.externalThinking = patch.settings.externalThinking;
        if (patch.settings.personality !== undefined) settings.personality = patch.settings.personality;
        if (patch.settings.images !== undefined) settings.images = patch.settings.images;
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
    // Mock a pending update so the badge + About drawer are previewable in pnpm preview:renderer.
    checkForUpdates: async () => ({ available: true, currentVersion: "0.4.3", checkedAt: new Date().toISOString(), manifest: { version: 1, name: "OMP Switch", release: "0.4.4", url: "https://github.com/skh2945932142/omp-switch/releases/tag/v0.4.4", summary: "新增签名校验的更新检查；修复 cost.longContext 写入阻断。", publishedAt: new Date().toISOString() } }),
    updateStatus: async () => ({ enabled: true, lastCheckAt: new Date().toISOString(), lastResult: null }),
    setUpdateCheckEnabled: async () => undefined,
    openExternal: async () => undefined,
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

function formatJson(value: unknown): string {
  return value && typeof value === "object" ? JSON.stringify(value, null, 2) : "";
}

/** Editor-facing mirror of the writable config.yml settings, flattened for the form. */
interface SettingsDraft {
  order: string;
  enabled: string;
  disabled: string;
  level: SettingsThinkingLevel;
  compaction: string;
  extendedContext: boolean;
  externalThinking: boolean;
  personality: string;
  imagesUrlsEnabled: string;
  unexpectedStopDetection: string;
  updateChannel: string;
}

/**
 * `images.urls.enabled` is a tri-state in the UI: unset (clear the key), on, off. A boolean form
 * control cannot express "unset", so it is held as the string "" / "true" / "false" and resolved
 * back into `boolean | undefined` in `settingsPatch`.
 */
function triStateFromBool(value: boolean | undefined): string {
  return value === undefined ? "" : value ? "true" : "false";
}

function triStateToBool(value: string): boolean | undefined {
  return value === "" ? undefined : value === "true";
}

function formatEnabledModelRules(value: Array<string | Record<string, unknown>> | undefined): string {
  return (value ?? []).map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n");
}

/** Dirty-check baselines. Key order must not matter, so sort before comparing. */
function rolesSignature(value: Record<string, string>): string {
  return JSON.stringify(Object.keys(value).sort().map((key) => `${key}=${value[key] ?? ""}`));
}

function settingsSignature(payload: SettingsDraft): string {
  return JSON.stringify(payload);
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
    try { parsed = JSON.parse(trimmed); } catch { throw new Error(i18n.t("settings.disabledProvidersJsonInvalid")); }
    if (!Array.isArray(parsed)) throw new Error(i18n.t("settings.disabledProvidersJsonArray"));
    return parsed.map((item) => {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object" && !Array.isArray(item)) return item as Record<string, unknown>;
      throw new Error(i18n.t("settings.disabledProvidersEntry"));
    });
  }
  return trimmed.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean).map((item) => {
    if (!item.startsWith("{")) return item;
    let parsed: unknown;
    try { parsed = JSON.parse(item); } catch { throw new Error(i18n.t("settings.disabledProvidersJsonEntry")); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(i18n.t("settings.disabledProvidersObject"));
    return parsed as Record<string, unknown>;
  });
}

function parseEnabledModelRules(value: string): Array<string | Record<string, unknown>> {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch { throw new Error(i18n.t("settings.enabledModelsJsonInvalid")); }
    if (!Array.isArray(parsed)) throw new Error(i18n.t("settings.enabledModelsJsonArray"));
    return parsed.map((item) => {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object" && !Array.isArray(item)) return item as Record<string, unknown>;
      throw new Error(i18n.t("settings.enabledModelsEntry"));
    });
  }
  return value.split(/\r?\n|,(?=\s*[A-Za-z0-9_.*-]+\/)/).map((item) => item.trim()).filter(Boolean).map((item) => {
    if (!item.startsWith("{")) return item;
    let parsed: unknown;
    try { parsed = JSON.parse(item); } catch { throw new Error(i18n.t("settings.enabledModelsJsonEntry")); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(i18n.t("settings.enabledModelsObject"));
    return parsed as Record<string, unknown>;
  });
}

function parseObjectJson(label: string, value: string): Record<string, unknown> | null {
  if (!value.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(i18n.t("models.validJsonRequired", { label }));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(i18n.t("models.jsonObjectRequired", { label }));
  return parsed as Record<string, unknown>;
}

function parseHeaders(value: string): Record<string, string> | null {
  const parsed = parseObjectJson(i18n.t("models.headersLabel"), value);
  if (!parsed) return null;
  if (Object.values(parsed).some((header) => typeof header !== "string")) throw new Error(i18n.t("models.headersString"));
  return parsed as Record<string, string>;
}

function parseModelOverrides(value: string): Record<string, Record<string, unknown>> | null {
  const parsed = parseObjectJson(i18n.t("models.overridesLabel"), value);
  if (!parsed) return null;
  if (Object.values(parsed).some((override) => !override || typeof override !== "object" || Array.isArray(override))) {
    throw new Error(i18n.t("models.overridesObject"));
  }
  return parsed as Record<string, Record<string, unknown>>;
}

function parseCost(value: string): Record<string, number> | null {
  const parsed = parseObjectJson(i18n.t("models.costLabel"), value);
  if (!parsed) return null;
  if (Object.values(parsed).some((cost) => typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)) throw new Error(i18n.t("models.costNonNegative"));
  return parsed as Record<string, number>;
}

interface AboutSectionProps {
  appVersion: string;
  updateInfo: { enabled: boolean; lastCheckAt: string | null; lastResult: UpdateStatus | null; checking: boolean };
  onCheck: () => void;
  onToggle: (enabled: boolean) => void;
  onDownload: (url: string) => void;
}

function AboutSection({ appVersion, updateInfo, onCheck, onToggle, onDownload }: AboutSectionProps): ReactElement {
  const { t } = useTranslation();
  const result = updateInfo.lastResult;
  return (
    <>
      <div className="drawer-section">
        <div className="drawer-section-title"><span>{t("about.version")}</span><Zap size={15} /></div>
        <div className="detail-grid">
          <span>{t("about.currentVersion")}</span><strong>{appVersion || "—"}</strong>
          <span>{t("about.latestVersion")}</span><strong>{result?.available ? <span className="update-available">{result.manifest.release} ↗</span> : result ? t("about.upToDate") : "—"}</strong>
        </div>
        {result?.available && result.manifest.summary ? <span className="muted-line">{result.manifest.summary}</span> : null}
        {updateInfo.lastCheckAt ? <span className="muted-line">{t("about.lastCheck", { date: formatDateTime(updateInfo.lastCheckAt) })}</span> : null}
        <div className="drawer-actions">
          <button className="secondary-button" onClick={onCheck} disabled={updateInfo.checking}><RefreshCw size={14} className={updateInfo.checking ? "spin" : ""} />{t("about.checkNow")}</button>
          {result?.available ? <button className="primary-button" onClick={() => void onDownload(result.manifest.url)}><Download size={14} />{t("about.download")}</button> : null}
        </div>
      </div>
      <div className="drawer-section">
        <div className="drawer-section-title"><span>{t("about.updateCheck")}</span><ShieldCheck size={15} /></div>
        <label className="check-line"><input type="checkbox" checked={updateInfo.enabled} onChange={(event) => onToggle(event.target.checked)} />{t("about.autoCheck")}</label>
        <span className="muted-line">{t("about.autoCheckHint")}</span>
      </div>
    </>
  );
}

export default function App() {
  const [profiles, setProfiles] = useState<ProfileRef[]>([]);
  const [profileId, setProfileId] = useState("default");
  const [config, setConfig] = useState<EffectiveConfig | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [applyingProviderId, setApplyingProviderId] = useState<string | null>(null);
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
  const [profileTab, setProfileTab] = useState<"settings" | "project" | "snapshots" | "omp" | "oauth" | "about">("settings");
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
  const [compactionJson, setCompactionJson] = useState("");
  const [extendedContext, setExtendedContext] = useState(false);
  const [externalThinking, setExternalThinking] = useState(false);
  const [personality, setPersonality] = useState("default");
  const [imagesUrlsEnabled, setImagesUrlsEnabled] = useState("");
  const [unexpectedStopDetection, setUnexpectedStopDetection] = useState<UnexpectedStopMode>("mechanical");
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>("stable");
  const [updatingOmp, setUpdatingOmp] = useState(false);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>("system");
  const [localeChoice, setLocaleChoiceState] = useState<LocaleChoice>("system");
  const [appVersion, setAppVersion] = useState<string>("");
  const [updateInfo, setUpdateInfo] = useState<{ enabled: boolean; lastCheckAt: string | null; lastResult: UpdateStatus | null; checking: boolean }>({ enabled: true, lastCheckAt: null, lastResult: null, checking: false });
  const catalogInput = useRef<HTMLInputElement>(null);

  const { t, i18n } = useTranslation();

  const providers = config ? Object.entries(config.models.value.providers) : [];
  const selectedProvider = selectedProviderId ? config?.models.value.providers[selectedProviderId] : undefined;
  const selectedModels = useMemo(() => providerModels(selectedProvider), [selectedProvider]);
  const errorDiagnostics = config?.diagnostics.filter((item) => item.severity === "error") ?? [];
  const readOnly = Boolean(readOnlyReason);
  const providerIds = providers.map(([id]) => id);
  const draftProviderOrder = useMemo(
    () => providerOrder.split(",").map((value) => value.trim()).filter(Boolean),
    [providerOrder],
  );
  const preferredProviderId = effectivePreferredProviderId(providerIds, draftProviderOrder);
  const draftDisabledProviders = useMemo<DisabledProviderRule[]>(() => {
    try {
      return parseDisabledProviderRules(disabledProviders);
    } catch {
      // The save path reports the localized parse error; the card stays actionable so the user
      // can discover and correct the invalid draft instead of getting a silent disabled state.
      return [];
    }
  }, [disabledProviders]);
  const roleIds = useMemo(() => {
    const extra = Object.keys(roles).filter((id) => !KNOWN_ROLES.some(([known]) => known === id)).map((id) => [id, ""] as [string, string]);
    return [...KNOWN_ROLES.map(([id, label]) => [id, label] as [string, string]), ...extra];
  }, [roles]);
  const rolesDirty = useMemo(() => rolesSignature(roles) !== rolesSignature(savedRoles), [roles, savedRoles]);
  const settingsDirty = settingsSignature(settingsDraft()) !== savedSettings;
  const enabledFilter = useMemo(() => makeEnabledFilter(config?.settings.value.enabledModels), [config]);

  function settingsDraft(): SettingsDraft {
    return {
      order: providerOrder,
      enabled: enabledModels,
      disabled: disabledProviders,
      level: defaultThinkingLevel,
      compaction: compactionJson,
      extendedContext,
      externalThinking,
      personality,
      imagesUrlsEnabled,
      unexpectedStopDetection,
      updateChannel,
    };
  }

  const notify = useCallback((next: { tone: "success" | "error" | "info"; text: string }) => {
    if (next.tone === "success") toast.success(next.text);
    else if (next.tone === "error") toast.error(next.text, { duration: 8000 });
    else toast.info(next.text);
  }, []);

  /** Single place that mirrors a freshly loaded config into editor state and resets dirty baselines. */
  function applyConfig(next: EffectiveConfig): void {
    const nextRoles = next.settings.value.modelRoles ?? {};
    const s = next.settings.value;
    setConfig(next);
    setRoles(nextRoles);
    setSavedRoles(nextRoles);
    setProviderOrder((s.modelProviderOrder ?? []).join(", "));
    setEnabledModels(formatEnabledModelRules(s.enabledModels));
    setDisabledProviders(formatEnabledModelRules(s.disabledProviders));
    setDefaultThinkingLevel(s.defaultThinkingLevel ?? "auto");
    setCompactionJson(formatJson(s.compaction));
    setExtendedContext(Boolean(s.extendedContext));
    setExternalThinking(Boolean(s.externalThinking));
    setPersonality(typeof s.personality === "string" ? s.personality : "default");
    setImagesUrlsEnabled(triStateFromBool(s.images?.urls?.enabled));
    setUnexpectedStopDetection((s.unexpectedStopDetection as UnexpectedStopMode) ?? "mechanical");
    setUpdateChannel((s.updateChannel as UpdateChannel) ?? "stable");
    setSavedSettings(settingsSignature({
      order: (s.modelProviderOrder ?? []).join(", "),
      enabled: formatEnabledModelRules(s.enabledModels),
      disabled: formatEnabledModelRules(s.disabledProviders),
      level: s.defaultThinkingLevel ?? "auto",
      compaction: formatJson(s.compaction),
      extendedContext: Boolean(s.extendedContext),
      externalThinking: Boolean(s.externalThinking),
      personality: typeof s.personality === "string" ? s.personality : "default",
      imagesUrlsEnabled: triStateFromBool(s.images?.urls?.enabled),
      unexpectedStopDetection: (s.unexpectedStopDetection as UnexpectedStopMode) ?? "mechanical",
      updateChannel: (s.updateChannel as UpdateChannel) ?? "stable",
    }));
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
    setLocaleChoiceState(initLocale());
    void api.getInfo().then((info) => {
      setAppVersion(info.version);
      setReadOnlyReason(info.installation.supported ? null : info.installation.reason ?? t("toasts.ompUnsupported"));
    }).catch(() => undefined);
    void api.listProfiles().then((items) => {
      setProfiles(items);
      void load(items[0]?.id ?? "default");
    });
    void api.listCatalog().then((items) => setCatalog(items as ProviderPreset[])).catch(() => undefined);
    // The update checker runs on the main process; this only reads its cached state so the badge
    // appears without a round-trip. A manual [Check now] re-runs checkForUpdates below.
    void api.updateStatus().then((status) => setUpdateInfo((current) => ({ ...current, enabled: status.enabled, lastCheckAt: status.lastCheckAt, lastResult: status.lastResult }))).catch(() => undefined);
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
      codeMode: typeof provider?.codeMode === "string" ? provider.codeMode : "",
    });
    setModelEntries(providerModels(provider).map(toModelEditorEntry));
    setAdvancedOpen(false);
    setDrawerOpen(true);
    setFormOpen(true);
  }

  async function saveProvider(): Promise<void> {
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? t("toasts.readonlyConfig") });
      return;
    }
    if (!config || !form.id.trim() || !form.baseUrl.trim()) {
      notify({ tone: "error", text: t("providerEditor.providerIdUrlRequired") });
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
      await requestSave(t("providerEditor.saveProvider", { id }), {
        provider: {
          id,
          baseUrl: form.baseUrl.trim(),
          api: form.api,
          auth,
          apiKey: apiKeyValue,
          headers: parseHeaders(form.headers),
          compat: parseObjectJson(i18n.t("models.compatLabel"), form.compat),
          modelOverrides: parseModelOverrides(form.overrides),
          models,
          ...(form.discoveryType ? { discovery: { type: form.discoveryType } } : {}),
          authHeader: form.authHeader,
          disableStrictTools: form.disableStrictTools,
          ...(form.transport.trim() ? { transport: form.transport.trim() } : {}),
          remoteCompaction: parseObjectJson(i18n.t("models.remoteCompactionLabel"), form.remoteCompaction),
          cost: parseCost(form.cost),
          codeMode: form.codeMode.trim() ? form.codeMode.trim() : null,
        },
      }, () => {
        setSelectedProviderId(id);
        setFormOpen(false);
        setDrawerOpen(true);
        notify({ tone: "success", text: t("providerEditor.saved", { id }) });
      });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  function removeProvider(): void {
    if (!config || !selectedProviderId) return;
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? t("toasts.readonlyConfig") });
      return;
    }
    const target = selectedProviderId;
    setConfirmAsk({
      title: t("providerEditor.removeProvider", { target }),
      message: t("providerEditor.removeConfirm"),
      confirmLabel: t("common.delete"),
      danger: true,
      action: () => {
        void requestSave(t("providerEditor.removeProvider", { target }), { removeProviderId: target }, () => {
          setSelectedProviderId(Object.keys(config?.models.value.providers ?? {}).find((id) => id !== target) ?? null);
          setFormOpen(false);
          notify({ tone: "success", text: t("providerEditor.removed", { target }) });
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
      notify({ tone: "success", text: t("providerEditor.discovered", { count: result.models.length, ms: result.durationMs }) });
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
      notify({ tone: "error", text: readOnlyReason ?? t("toasts.readonlyConfig") });
      return;
    }
    if (config?.models.legacy) {
      setConfirmAsk({
        title: t("providerEditor.migrateLegacy"),
        message: t("providerEditor.migrateConfirm"),
        confirmLabel: t("providerEditor.migrateButton"),
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

  /** Immediate save used by compact, low-risk actions such as choosing a preferred provider. */
  async function saveImmediately(patch: ConfigPatch, done?: () => void): Promise<void> {
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? t("toasts.readonlyConfig") });
      return;
    }
    setBusy(true);
    try {
      const result = await api.save(profileId, patch);
      applyConfig(result.config);
      setSnapshot(result.snapshot);
      done?.();
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
    return requestSave(t("settings.saveRoles"), { roleAssignments: roles }, () => notify({ tone: "success", text: t("settings.savedRoles") }));
  }

  function saveSettings(): Promise<void> {
    return requestSave(t("settings.saveSettingsTitle"), { settings: settingsPatch() }, () => notify({ tone: "success", text: t("settings.savedSettings") }));
  }

  function settingsPatch(providerOrderOverride?: string[]): NonNullable<ConfigPatch["settings"]> {
    // An empty compaction string clears the key; a parseable object writes it. A non-empty string
    // that fails to parse throws in parseObjectJson and aborts the save before any filesystem effect.
    const compactionParsed = compactionJson.trim() ? parseObjectJson("compaction", compactionJson) : null;
    // `images` is patched as a full object: the editor only exposes urls.enabled, but the patch must
    // carry the rest of images.* (e.g. autoResize) so the AST diff does not delete keys the user set
    // by hand. Compaction avoids this by round-tripping the whole object through its JSON textarea;
    // images has no such field, so the loaded value is merged here instead.
    const imagesBase = config?.settings.value.images ?? {};
    const urlsEnabled = triStateToBool(imagesUrlsEnabled);
    const images = urlsEnabled === undefined
      ? undefined
      : { ...imagesBase, urls: { ...(typeof imagesBase.urls === "object" && imagesBase.urls ? imagesBase.urls : {}), enabled: urlsEnabled } };
    return {
      modelProviderOrder: providerOrderOverride ?? draftProviderOrder,
      enabledModels: parseEnabledModelRules(enabledModels),
      disabledProviders: parseDisabledProviderRules(disabledProviders),
      defaultThinkingLevel,
      ...(compactionParsed ? { compaction: compactionParsed as CompactionSettings } : {}),
      extendedContext,
      externalThinking,
      personality,
      unexpectedStopDetection,
      updateChannel,
      ...(images ? { images } : {}),
    };
  }

  function providerApplyReason(id: string, provider: OmpProvider): ProviderApplyBlockReason | null {
    return providerApplyBlockReason({
      readOnly,
      disabled: isProviderDisabled(id, draftDisabledProviders, config?.profile.agentDir ?? ""),
      modelCount: providerModels(provider).length,
      auth: provider.auth ?? "apiKey",
      apiKey: provider.apiKey,
    });
  }

  function applyProvider(providerId: string): void {
    const provider = config?.models.value.providers[providerId];
    if (!provider || busy || pendingSave) return;
    const reason = providerApplyReason(providerId, provider);
    if (reason) {
      notify({ tone: "error", text: t(`models.applyBlocked.${reason}`) });
      return;
    }

    let patch: ConfigPatch;
    try {
      const draft = mergeProviderApplyDraft(providerId, draftProviderOrder, settingsDirty ? settingsPatch() : {}, roles, rolesDirty);
      patch = draft;
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return;
    }

    const commit = (nextPatch: ConfigPatch) => {
      setApplyingProviderId(providerId);
      void saveImmediately(nextPatch, () => {
        setApplyingProviderId(null);
        setDrawerOpen(false);
        setFormOpen(false);
        setProfileDrawerOpen(false);
        setDiagnosticsOpen(false);
        notify({ tone: "success", text: t("toasts.providerApplied", { provider: providerId }) });
      }).finally(() => setApplyingProviderId(null));
    };

    if (config.models.legacy) {
      setConfirmAsk({
        title: t("providerEditor.migrateLegacy"),
        message: t("providerEditor.migrateConfirm"),
        confirmLabel: t("providerEditor.migrateButton"),
        action: () => commit({ ...patch, confirmLegacyMigration: true }),
      });
      return;
    }
    commit(patch);
  }

  /** One commit when both areas are dirty, otherwise whichever is — this is what Ctrl+S runs. */
  function saveDirty(): Promise<void> {
    if (rolesDirty && settingsDirty) return requestSave(t("settings.saveRolesAndSettings"), { roleAssignments: roles, settings: settingsPatch() }, () => notify({ tone: "success", text: t("settings.savedRolesAndSettings") }));
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
      title: t("confirm.discardTitle"),
      message: t("confirm.discardMessage"),
      confirmLabel: t("confirm.discardButton"),
      danger: true,
      action,
    });
  }

  /** Quick-assign keeps the role's existing thinking suffix and only swaps the provider/model. */
  function assignModelToRole(roleId: string, providerId: string, modelId: string): void {
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? t("toasts.readonlyConfig") });
      return;
    }
    const existing = (roles[roleId] ?? "").trim();
    const parsed = existing ? parseRoleSelector(existing, providerIds) : null;
    const suffix = parsed?.thinking ? `:${parsed.thinking}` : "";
    setRoles((current) => ({ ...current, [roleId]: `${providerId}/${modelId}${suffix}` }));
    notify({ tone: "info", text: t("toasts.quickAssign", { provider: providerId, model: modelId, role: roleId }) });
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
      notify({ tone: "success", text: t("toasts.snapshotCreated", { date: formatDateTime(next.createdAt) }) });
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
      setAuthResult(result.ok ? `${provider}: ${result.output || t("oauth.done")}` : `${provider}: ${result.error ?? t("oauth.commandFailed")}`);
    } catch (error) {
      setAuthResult(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function updateOmp(): Promise<void> {
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? t("omp.readonlyOmp") });
      return;
    }
    setUpdatingOmp(true);
    try {
      const result = await api.updateOmp(profileId);
      if (!result.ok) {
        notify({ tone: "error", text: result.output || t("omp.updateFailed") });
        return;
      }
      notify({ tone: "success", text: t("omp.updated", { version: result.installation?.version ? ` · ${result.installation.version}` : "" }) });
      await load(profileId);
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setUpdatingOmp(false);
    }
  }

  async function checkForUpdates(manual: boolean): Promise<void> {
    if (manual) setUpdateInfo((current) => ({ ...current, checking: true }));
    try {
      const result = await api.checkForUpdates(manual);
      const status = await api.updateStatus();
      setUpdateInfo({ enabled: status.enabled, lastCheckAt: status.lastCheckAt, lastResult: result ?? status.lastResult, checking: false });
      if (manual && result?.available) notify({ tone: "info", text: t("about.foundNewVersion", { version: result.manifest.release }) });
      else if (manual) notify({ tone: "info", text: t("about.upToDateToast") });
    } catch {
      setUpdateInfo((current) => ({ ...current, checking: false }));
      if (manual) notify({ tone: "info", text: t("about.checkFailed") });
    }
  }

  async function toggleUpdateCheckEnabled(enabled: boolean): Promise<void> {
    await api.setUpdateCheckEnabled(enabled);
    setUpdateInfo((current) => ({ ...current, enabled }));
  }

  async function openDownload(url: string): Promise<void> {
    try {
      await api.openExternal(url);
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
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
      notify({ tone: "success", text: t("toasts.catalogImported", { count: result.entries.length }) });
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
      notify({ tone: "success", text: t("toasts.catalogExported") });
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
  const healthLabel = readOnly ? t("health.readonly") : errorDiagnostics.length > 0 ? t("health.hasIssues") : config?.models.exists ? t("health.connected") : t("health.unconfigured");
  const sectionLabels = { models: t("nav.models"), roles: t("nav.roles"), prompts: t("nav.prompts"), skills: t("nav.skills"), sessions: t("nav.sessions"), usage: t("nav.usage"), gateway: t("nav.gateway") } as const;
  // Nav groups, so the seven modules read as three sections instead of a flat list. The order of
  // groups and items matches the sectionLabels keys; the grouping is presentational only.
  const navGroups: Array<{ title: string; items: Array<keyof typeof sectionLabels> }> = [
    { title: t("nav.groupConfig"), items: ["models", "roles"] },
    { title: t("nav.groupContent"), items: ["prompts", "skills", "sessions"] },
    { title: t("nav.groupOps"), items: ["usage", "gateway"] },
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
          <button className="profile-chip" title={t("common.openProfile")} onClick={() => { setProfileTab("settings"); setProfileDrawerOpen(true); setDrawerOpen(true); }}>
            <span className="status-led" />{profiles.find((profile) => profile.id === profileId)?.name ?? profileId}<ChevronDown size={14} />
          </button>
          <button className={`status-chip ${readOnly ? "warning" : errorDiagnostics.length ? "danger" : "ok"}`} onClick={() => { setDiagnosticsOpen(true); setDrawerOpen(true); }}>
            <ShieldCheck size={14} />{healthLabel}
          </button>
        </div>
        <div className="topbar-actions">
            <IconButtonTip label={t("topbar.refresh")}><button className="icon-button" onClick={() => void load(profileId)} disabled={busy}><RefreshCw size={17} className={busy ? "spin" : ""} /></button></IconButtonTip>
            <IconButtonTip label={t("topbar.createSnapshot")}><button className="icon-button" onClick={() => void createSnapshot()} disabled={busy}><ArchiveRestore size={17} /></button></IconButtonTip>
            <LocaleSwitch value={localeChoice} onChange={setLocaleChoiceState} />
            <ThemeSwitch value={themeChoice} onChange={setThemeChoice} />
            {updateInfo.lastResult?.available ? (
              <button className="icon-button update-badge" title={t("topbar.newVersionAvailable", { version: updateInfo.lastResult.manifest.release })} onClick={() => { setProfileTab("about"); setProfileDrawerOpen(true); setDrawerOpen(true); }}><Zap size={17} /><span className="update-badge-dot" /></button>
            ) : null}
            <button className="primary-button compact" title={t("topbar.saveAll")} onClick={() => void saveDirty()} disabled={busy || readOnly || (!rolesDirty && !settingsDirty)}><Save size={15} />{t("common.save")}</button>
        </div>
      </header>

      <main className="app-body">
        <aside className="left-rail">
          <div className="rail-profile">
            <span className="rail-label">{t("common.profile")}</span>
            <StyledSelect
              value={profileId}
              onValueChange={(next) => confirmDiscardThen(() => { setProfileId(next); void load(next); })}
              options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
              ariaLabel={t("common.openProfile")}
            />
            <span className="path-note" title={config?.profile.agentDir}>{config?.profile.agentDir ?? t("common.loading")}</span>
          </div>
          <nav className="section-nav" aria-label={t("toasts.modulesAria")}>
            {navGroups.map((group) => <div className="nav-group" key={group.title}>
              <span className="nav-group-title">{group.title}</span>
              {group.items.map((item) => (
                <button key={item} className={section === item ? "active" : ""} onClick={() => { setSection(item); setFormOpen(false); setDrawerOpen(false); }}>
                  <span className="nav-icon">{item === "models" ? <CloudDownload size={16} /> : item === "roles" ? <Users size={16} /> : item === "prompts" ? <FileCheck2 size={16} /> : item === "skills" ? <Sparkles size={16} /> : item === "sessions" ? <Activity size={16} /> : item === "usage" ? <Coins size={16} /> : <ShieldCheck size={16} />}</span>
                  <span>{sectionLabels[item]}</span>
                  {item === "models" ? <span className="nav-count">{providers.length}</span> : null}
                  {item === "roles" && rolesDirty ? <span className="nav-dot" title={t("settings.unsaved")} /> : null}
                </button>
              ))}
            </div>)}
          </nav>
          <div className="rail-footer">
            <button className="rail-action" onClick={() => { setDiagnosticsOpen(true); setDrawerOpen(true); }}><CircleAlert size={15} />{t("diagnostics.title")}<span>{errorDiagnostics.length}</span></button>
            <button className="rail-action" onClick={() => { setProfileTab("settings"); setProfileDrawerOpen(true); setDrawerOpen(true); }}><Settings2 size={15} />{t("common.profile")}{settingsDirty ? <span className="nav-dot" title={t("settings.unsaved")} /> : null}</button>
          </div>
        </aside>

        <section className="workspace-main">
          <div className="section-view" key={section}>
          {section === "models" ? (
            <>
              <div className="workspace-heading">
                <div><span className="eyebrow">{profileId}</span><h1>{t("models.heading")}</h1></div>
                <div className="heading-actions">
                  <div className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("models.searchPlaceholder")} aria-label={t("models.searchAria")} /></div>
                  <div className="new-wrap">
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button className="primary-button" disabled={readOnly}><Plus size={16} />{t("models.add")}</button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content className="dd-menu" align="end" sideOffset={6} collisionPadding={10}>
                          <DropdownMenu.Item className="dd-item" onSelect={() => beginAdd()}>{t("models.custom")}</DropdownMenu.Item>
                          <DropdownMenu.Item className="dd-item" onSelect={() => { beginAdd(); notify({ tone: "info", text: t("models.presetHint") }); }}>{t("models.preset")}</DropdownMenu.Item>
                          <DropdownMenu.Item className="dd-item" onSelect={() => catalogInput.current?.click()}>{t("models.importCatalog")}</DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                    <input ref={catalogInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importCatalogFile(event)} />
                  </div>
                </div>
              </div>

              {readOnlyReason ? <div className="inline-status warning"><CircleAlert size={15} /><span>{readOnlyReason}</span></div> : null}
              {filteredProviders.length === 0 ? <div className="empty-workspace"><span className="empty-glyph"><CloudDownload size={30} /></span><strong>{providers.length ? t("models.emptyNoMatch") : t("models.emptyNone")}</strong><span className="empty-desc">{providers.length ? t("models.emptyNoMatchHint") : t("models.emptyNoneHint")}</span><div className="empty-actions"><button className="primary-button" onClick={beginAdd} disabled={readOnly}><Plus size={15} />{t("models.newProvider")}</button></div></div> : null}
              <div className="provider-stack">
                {filteredProviders.map(([id, provider]) => {
                  const expanded = expandedProviders[id] ?? false;
                  const models = providerModels(provider);
                  const coverage = models.filter((model) => enabledFilter(id, model.id ?? "")).length;
                  const preferred = preferredProviderId === id;
                  const applyReason = providerApplyReason(id, provider);
                  const applying = applyingProviderId === id;
                  const applyTooltip = applyReason
                    ? t(`models.applyBlocked.${applyReason}`)
                    : preferred
                      ? t("models.applied")
                      : t("models.applyHint");
                  return <article className={`provider-card${preferred ? " preferred" : ""}${applying ? " applying" : ""}`} key={id}>
                    <div className="provider-card-head">
                      <button
                        className="provider-card-toggle"
                        onClick={() => setExpandedProviders((current) => ({ ...current, [id]: !expanded }))}
                        aria-expanded={expanded}
                        aria-label={t("models.expandAria", { action: expanded ? t("models.collapse") : t("models.expand"), id })}
                      >
                        <span className="provider-led" />
                        <span className="provider-title"><strong>{id}</strong><small>{provider.api ?? "custom"}</small></span>
                        <span className="provider-model-count">{models.length}</span>
                        {preferred ? <span className="provider-preferred-label">{t("models.preferred")}</span> : null}
                        <ChevronDown size={16} className={`provider-chevron${expanded ? " open" : ""}`} />
                      </button>
                      <div className="provider-actions">
                        <IconButtonTip label={applyTooltip}>
                          <span className="provider-action-tip">
                            <button
                              className={`provider-apply${preferred ? " applied" : ""}`}
                              aria-label={applyTooltip}
                              aria-pressed={preferred}
                              disabled={Boolean(applyReason) || preferred || busy || Boolean(pendingSave)}
                              onClick={(event) => { event.stopPropagation(); applyProvider(id); }}
                            >
                              {applying ? <LoaderCircle size={14} className="spin" /> : preferred ? <Check size={14} /> : <ArrowUp size={14} />}
                              <span>{applying ? t("models.applying") : preferred ? t("models.applied") : t("models.apply")}</span>
                            </button>
                          </span>
                        </IconButtonTip>
                        <IconButtonTip label={t("models.editAria", { id })}>
                          <button className="provider-edit" aria-label={t("models.editAria", { id })} onClick={() => editProvider(id)}><Pencil size={15} /></button>
                        </IconButtonTip>
                      </div>
                    </div>
                    <div className={`model-list-wrap${expanded ? " open" : ""}`}>
                      <div className="model-list-clip">
                        <div className="provider-meta-bar">
                          <span className="provider-meta-endpoint mono" title={provider.baseUrl ?? ""}>{provider.baseUrl ?? t("models.noEndpoint")}</span>
                          <span className="provider-meta-sep">·</span>
                          <span className={`provider-meta-status ${provider.auth === "none" ? "ok" : provider.apiKey ? "ok" : "warn"}`}>{provider.auth === "none" ? t("models.noKeyNeeded") : provider.apiKey ? t("models.keyConfigured") : t("models.keyNotConfigured")}</span>
                          {models.length > 0 && coverage < models.length ? <>
                            <span className="provider-meta-sep">·</span>
                            <span className="provider-meta-coverage warn-line" title={t("models.coverageTitle")}>{coverage === 0 ? t("models.coverageNotEnabled") : t("models.coveragePartial", { covered: coverage, total: models.length })}</span>
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
                            <span className="capabilities"><span className={model.reasoning ? "capability on" : "capability"}>{model.reasoning ? t("models.capabilityReasoning") : t("models.capabilityStandard") }</span><span className="capability">{model.input?.includes("image") ? t("models.capabilityVision") : t("models.capabilityText")}</span></span>
                            <QuickAssign roles={roleIds} assignments={roles} providerId={id} modelId={model.id ?? ""} providerIds={providerIds} onAssign={(roleId) => assignModelToRole(roleId, id, model.id ?? "")} onOpenRoles={() => { setSection("roles"); setFormOpen(false); setDrawerOpen(false); }} />
                          </div>)}
                          {models.length === 0 ? <div className="model-empty">{t("models.emptyModels")}</div> : null}
                        </div>
                      </div>
                    </div>
                  </article>;
                })}
              </div>
            </>
          ) : section === "roles" ? <RolesModule providers={providers} roleIds={roleIds} roles={roles} baseline={savedRoles} profileId={profileId} readOnly={readOnly} busy={busy} onRoleChange={setRoleValue} onSave={() => void saveDirty()} isEnabled={enabledFilter} />
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
          <div className="drawer-head"><div><span className="eyebrow">{profileDrawerOpen ? t("common.profile") : diagnosticsOpen ? t("diagnostics.title") : formOpen ? (editingProviderId ? t("providerEditor.edit") : t("providerEditor.new")) : t("providerEditor.provider")}</span><h2>{profileDrawerOpen ? profileId : diagnosticsOpen ? t("diagnostics.title") : formOpen ? (editingProviderId ?? t("providerEditor.newProvider")) : selectedProviderId ?? t("providerEditor.detail")}</h2></div><button className="icon-button" title={t("common.close")} onClick={() => { setDrawerOpen(false); setFormOpen(false); setProfileDrawerOpen(false); setDiagnosticsOpen(false); }}><X size={17} /></button></div>

          {profileDrawerOpen ? <div className="drawer-body profile-drawer">
            <div className="profile-tabs" role="tablist">
              <button role="tab" aria-selected={profileTab === "settings"} className={profileTab === "settings" ? "active" : ""} onClick={() => setProfileTab("settings")}><Settings2 size={14} />{t("settings.tabSettings")}</button>
              <button role="tab" aria-selected={profileTab === "project"} className={profileTab === "project" ? "active" : ""} onClick={() => setProfileTab("project")}><FolderOpen size={14} />{t("settings.tabProject")}</button>
              <button role="tab" aria-selected={profileTab === "snapshots"} className={profileTab === "snapshots" ? "active" : ""} onClick={() => setProfileTab("snapshots")}><ArchiveRestore size={14} />{t("settings.tabSnapshots")}</button>
              <button role="tab" aria-selected={profileTab === "omp"} className={profileTab === "omp" ? "active" : ""} onClick={() => setProfileTab("omp")}><RefreshCw size={14} />{t("settings.tabOmp")}</button>
              <button role="tab" aria-selected={profileTab === "oauth"} className={profileTab === "oauth" ? "active" : ""} onClick={() => setProfileTab("oauth")}><KeyRound size={14} />{t("settings.tabOAuth")}</button>
              <button role="tab" aria-selected={profileTab === "about"} className={profileTab === "about" ? "active" : ""} onClick={() => setProfileTab("about")}><Zap size={14} />{t("settings.tabAbout")}</button>
            </div>
            {profileTab === "settings" ? <>
            <div className="drawer-section"><div className="drawer-section-title"><span>{t("settings.roles")}</span><Users size={15} /></div><span className="muted-line">{t("settings.rolesHint")}</span><div className="drawer-actions"><button className="secondary-button" onClick={() => { setSection("roles"); setProfileDrawerOpen(false); setDrawerOpen(false); }}><Users size={15} />{t("settings.openRolesPage")}</button></div></div>
            <div className="drawer-section"><div className="drawer-section-title"><span>{t("settings.selection")}</span>{settingsDirty ? <span className="heading-dirty">{t("settings.unsaved")}</span> : <Settings2 size={15} />}</div><label className="module-field"><span>{t("settings.providerOrder")}</span><input value={providerOrder} onChange={(event) => setProviderOrder(event.target.value)} placeholder="openrouter, openai" /></label><label className="module-field"><span>{t("settings.enabledModels")}</span><textarea value={enabledModels} onChange={(event) => setEnabledModels(event.target.value)} rows={3} placeholder={"provider/*\n[{\"path\":\"~/work\",\"models\":[\"provider/model\"]}]"} /></label><label className="module-field"><span>{t("settings.disabledProviders")}</span><textarea value={disabledProviders} onChange={(event) => setDisabledProviders(event.target.value)} rows={2} placeholder={"ollama, native"} /></label><label className="module-field"><span>{t("settings.defaultThinking")}</span><StyledSelect value={defaultThinkingLevel} onValueChange={(next) => setDefaultThinkingLevel(next as SettingsThinkingLevel)} options={SETTINGS_THINKING_LEVELS.map((level) => ({ value: level, label: level }))} ariaLabel={t("settings.defaultThinking")} mono /></label></div>
            <div className="drawer-section"><div className="drawer-section-title"><span>{t("settings.behavior")}</span>{settingsDirty ? <span className="heading-dirty">{t("settings.unsaved")}</span> : null}</div><label className="module-field"><span>{t("settings.personality")}</span><StyledSelect value={personality} onValueChange={(next) => setPersonality(next)} options={PERSONALITY_PRESETS.map((preset) => ({ value: preset, label: preset }))} ariaLabel={t("settings.personality")} mono /></label><span className="muted-line">{t("settings.personalityHint")}</span><label className="check-line"><input type="checkbox" checked={extendedContext} onChange={(event) => setExtendedContext(event.target.checked)} />{t("settings.extendedContext")}</label><label className="check-line"><input type="checkbox" checked={externalThinking} onChange={(event) => setExternalThinking(event.target.checked)} />{t("settings.externalThinking")}</label><label className="module-field"><span>{t("settings.imagesUrlMirror")}</span><StyledSelect value={imagesUrlsEnabled} onValueChange={(next) => setImagesUrlsEnabled(next)} options={[{ value: "", label: t("settings.imagesUrlMirrorUnset") }, { value: "true", label: t("settings.imagesUrlMirrorOn") }, { value: "false", label: t("settings.imagesUrlMirrorOff") }]} ariaLabel={t("settings.imagesUrlMirror")} mono /></label><span className="muted-line">{t("settings.imagesUrlHint")}</span><label className="module-field"><span>{t("settings.compaction")}</span><textarea value={compactionJson} onChange={(event) => setCompactionJson(event.target.value)} rows={4} placeholder={'{"asyncEnabled":true,"methodOrder":["remote","snapcompact"]}\n' + t("settings.compactionPlaceholder")} /></label><span className="muted-line">{t("settings.compactionHint")}</span><label className="module-field"><span>{t("settings.unexpectedStop")}</span><StyledSelect value={unexpectedStopDetection} onValueChange={(next) => setUnexpectedStopDetection(next as UnexpectedStopMode)} options={UNEXPECTED_STOP_MODES.map((mode) => ({ value: mode, label: t(`settings.unexpectedStopModes.${mode}`) }))} ariaLabel={t("settings.unexpectedStop")} mono /></label><span className="muted-line">{t("settings.unexpectedStopHint")}</span><label className="module-field"><span>{t("settings.updateChannel")}</span><StyledSelect value={updateChannel} onValueChange={(next) => setUpdateChannel(next as UpdateChannel)} options={UPDATE_CHANNELS.map((ch) => ({ value: ch, label: t(`settings.updateChannels.${ch}`) }))} ariaLabel={t("settings.updateChannel")} mono /></label><span className="muted-line">{t("settings.updateChannelHint")}</span></div>
            <div className="drawer-actions"><button className="primary-button full-width" onClick={() => void saveSettings()} disabled={busy || readOnly || !settingsDirty}><Save size={15} />{t("settings.saveSettings")}</button></div>
            </> : null}
            {profileTab === "project" ? <div className="drawer-section"><div className="drawer-section-title"><span>{t("project.projectOverlay")}</span><FolderOpen size={15} /></div><ProjectOverlayBadge api={api} profileId={profileId} onNotice={notify} /></div> : null}
            {profileTab === "snapshots" ? <div className="drawer-section"><div className="drawer-section-title"><span>{t("settings.tabSnapshots")}</span><ArchiveRestore size={15} /></div><div className="drawer-actions"><button className="secondary-button" onClick={() => void createSnapshot()} disabled={busy}><ArchiveRestore size={15} />{t("snapshots.create")}</button></div><SnapshotTimeline api={api} profileId={profileId} busy={busy} onRestored={(restored, snap) => { applyConfig(restored); setSnapshot(snap); }} onNotice={notify} /><span className="muted-line">{snapshot ? t("snapshots.lastWrite", { date: formatDateTime(snapshot.createdAt) }) : t("snapshots.autoHint")}</span></div> : null}
            {profileTab === "omp" ? <>
            <div className="drawer-section"><div className="drawer-section-title"><span>{t("omp.omp")}</span><RefreshCw size={15} /></div><div className="drawer-actions"><button className="secondary-button" onClick={() => void updateOmp()} disabled={busy || updatingOmp || readOnly}><RefreshCw size={14} className={updatingOmp ? "spin" : ""} />{t("omp.update")}</button><button className="secondary-button" onClick={() => void exportCatalog()} disabled={busy}><Download size={14} />{t("omp.catalog")}</button></div></div>
            <details className="yaml-preview"><summary>{t("omp.rawYaml")}</summary><YamlPreview files={[{ name: "models.yml", content: config?.models.raw || t("omp.modelsNotCreated") }, { name: "config.yml", content: config?.settings.raw || t("omp.settingsNotCreated") }]} /></details>
            </> : null}
            {profileTab === "oauth" ? <div className="drawer-section"><div className="drawer-section-title"><span>{t("settings.tabOAuth")}</span><KeyRound size={16} /></div><div className="drawer-actions"><button className="secondary-button" onClick={() => void checkAuth("openai-codex", "status")} disabled={busy}>Codex</button><button className="secondary-button" onClick={() => void checkAuth("anthropic", "status")} disabled={busy}>Anthropic</button></div>{authResult ? <span className="muted-line">{authResult}</span> : null}</div> : null}
            {profileTab === "about" ? <AboutSection appVersion={appVersion} updateInfo={updateInfo} onCheck={() => void checkForUpdates(true)} onToggle={toggleUpdateCheckEnabled} onDownload={openDownload} /> : null}
          </div> : null}

          {diagnosticsOpen ? (() => {
            const diags = config?.diagnostics ?? [];
            const errors = diags.filter((d) => d.severity === "error");
            const warnings = diags.filter((d) => d.severity === "warning");
            const infos = diags.filter((d) => d.severity === "info");
            const groups: Array<{ key: "error" | "warning" | "info"; label: string; items: typeof diags }> = [
              { key: "error", label: t("diagnostics.error"), items: errors },
              { key: "warning", label: t("diagnostics.warning"), items: warnings },
              { key: "info", label: t("diagnostics.info"), items: infos },
            ].filter((g) => g.items.length > 0) as Array<{ key: "error" | "warning" | "info"; label: string; items: typeof diags }>;
            return <div className="drawer-body">
              <div className="diag-summary">
                <div className="diag-summary-status">
                  <span className={`status-led ${errors.length ? "danger" : warnings.length ? "warn" : "ok"}`} />
                  <strong>{errors.length ? t("diagnostics.hasProblems") : warnings.length ? t("diagnostics.hasWarnings") : t("diagnostics.configOk")}</strong>
                </div>
                <div className="diag-summary-counts">
                  <span className={`diag-count ${errors.length ? "danger" : ""}`}><strong>{errors.length}</strong>{t("diagnostics.countError")}</span>
                  <span className={`diag-count ${warnings.length ? "warn" : ""}`}><strong>{warnings.length}</strong>{t("diagnostics.countWarning")}</span>
                  <span className="diag-count"><strong>{infos.length}</strong>{t("diagnostics.countInfo")}</span>
                </div>
              </div>
              {diags.length === 0 ? <span className="muted-line diag-empty">{t("diagnostics.empty")}</span> : groups.map((group) => <div className="diag-group" key={group.key}>
                <div className="diag-group-title">{group.label}<span className="status-chip neutral">{group.items.length}</span></div>
                {group.items.map((item, index) => <div className="diagnostic-row" key={`${item.code}-${index}`}><span className={`diag-icon ${item.severity}`}><CircleAlert size={14} /></span><span><strong>{item.code}</strong><small>{item.message}</small></span></div>)}
              </div>)}
            </div>;
          })() : null}


          {!profileDrawerOpen && !diagnosticsOpen && formOpen ? <div className="drawer-body form-drawer">
            <div className="form-group">
              <div className="form-group-title"><span>{t("providerEditor.identity")}</span></div>
              <label className="module-field"><span>{t("providerEditor.preset")}</span><StyledSelect value={form.id} onValueChange={(next) => choosePreset(next)} options={[{ value: "", label: t("providerEditor.presetCustom") }, ...(catalog.length ? catalog : FALLBACK_PRESETS).map((preset) => ({ value: preset.id, label: preset.label }))]} ariaLabel={t("providerEditor.preset")} /></label>
              <div className="form-two"><label className="module-field"><span>ID</span><input readOnly={Boolean(editingProviderId)} value={form.id} onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))} placeholder="openrouter" /></label><label className="module-field"><span>API</span><input list="omp-api-options" value={form.api} onChange={(event) => setForm((current) => ({ ...current, api: event.target.value }))} /><datalist id="omp-api-options"><option value="openai-completions" /><option value="openai-responses" /><option value="anthropic-messages" /><option value="openai-codex-responses" /></datalist></label></div>
            </div>
            <div className="form-group">
              <div className="form-group-title"><span>{t("providerEditor.connection")}</span></div>
              <label className="module-field"><span>Endpoint</span><input value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1" /></label>
              <div className="form-two"><label className="module-field"><span>{t("providerEditor.auth")}</span><StyledSelect value={form.auth} onValueChange={(next) => setForm((current) => ({ ...current, auth: next }))} options={[{ value: "apiKey", label: "apiKey" }, { value: "none", label: "none" }, { value: "oauth", label: "oauth" }]} ariaLabel={t("providerEditor.auth")} mono /></label><label className="module-field"><span>{t("providerEditor.apiKey")}</span><input type="password" value={form.key} onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))} placeholder={t("providerEditor.apiKeyKeep")} /></label></div>
              <span className="form-group-hint">{t("providerEditor.apiKeyHint")}</span>
            </div>
            <div className="form-group">
              <div className="form-group-title"><span>{t("providerEditor.models")}</span><button className="icon-button" title={t("providerEditor.addModel")} onClick={() => setModelEntries((current) => [...current, createModelEditorEntry()])}><Plus size={15} /></button></div>
              <div className="model-editor">{modelEntries.map((entry, index) => <div className="model-editor-card" key={`${entry.raw.id}-${index}`}><div className="model-editor-row"><input aria-label={t("models.modelField", { id: index + 1, field: "ID" })} value={entry.id} onChange={(event) => updateModelEntry(index, { id: event.target.value })} placeholder="Model ID" /><input aria-label={t("models.modelField", { id: index + 1, field: t("models.name") })} value={entry.name} onChange={(event) => updateModelEntry(index, { name: event.target.value })} placeholder={t("models.name")} /><input aria-label={t("models.modelField", { id: index + 1, field: "Context" })} inputMode="numeric" value={entry.contextWindow} onChange={(event) => updateModelEntry(index, { contextWindow: event.target.value })} placeholder="Context" /><input aria-label={t("models.modelField", { id: index + 1, field: "Max output" })} inputMode="numeric" value={entry.maxTokens} onChange={(event) => updateModelEntry(index, { maxTokens: event.target.value })} placeholder="Max" /><label className="check-line"><input type="checkbox" checked={entry.reasoning} onChange={(event) => updateModelEntry(index, { reasoning: event.target.checked })} />{t("models.capabilityReasoning")}</label><label className="check-line"><input type="checkbox" checked={entry.vision} onChange={(event) => updateModelEntry(index, { vision: event.target.checked })} />{t("models.capabilityVision")}</label><button className="icon-button subtle danger" title={t("providerEditor.deleteModel")} onClick={() => setModelEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div><details className="model-advanced"><summary>{t("providerEditor.advanced")}</summary><div className="model-advanced-grid"><label>{t("providerEditor.api")}<input value={entry.api} onChange={(event) => updateModelEntry(index, { api: event.target.value })} placeholder={t("providerEditor.inheritProvider")} /></label><label>Transport<input value={entry.transport} onChange={(event) => updateModelEntry(index, { transport: event.target.value })} placeholder="pi-native" /></label><label>{t("providerEditor.imageDecoder")}<input value={entry.imageInputDecoder} onChange={(event) => updateModelEntry(index, { imageInputDecoder: event.target.value })} placeholder="stb" /></label><label>Tokenizer<StyledSelect value={entry.tokenizer} onValueChange={(next) => updateModelEntry(index, { tokenizer: next })} options={[{ value: "", label: t("providerEditor.inheritAuto") }, ...Array.from(KNOWN_TOKENIZER_FAMILIES).map((family) => ({ value: family, label: family }))]} ariaLabel={t("models.modelField", { id: index + 1, field: "Tokenizer" })} mono /></label><label>Headers<textarea value={entry.headers} onChange={(event) => updateModelEntry(index, { headers: event.target.value })} rows={2} placeholder='{"X-Client":"omp-switch"}' /></label><label>Compat<textarea value={entry.compat} onChange={(event) => updateModelEntry(index, { compat: event.target.value })} rows={2} /></label><label>{t("models.remoteCompactionLabel")}<textarea value={entry.remoteCompaction} onChange={(event) => updateModelEntry(index, { remoteCompaction: event.target.value })} rows={2} placeholder='{"enabled":true}' /></label><label>Cost<textarea value={entry.cost} onChange={(event) => updateModelEntry(index, { cost: event.target.value })} rows={2} placeholder='{"input":0.1,"output":0.4}' /></label></div></details></div>)}{!modelEntries.length ? <span className="muted-line">{t("providerEditor.emptyModels")}</span> : null}</div>
            </div>
            <div className="form-group">
              <button className="drawer-disclosure form-group-disclosure" onClick={() => setAdvancedOpen((value) => !value)}><span>{t("providerEditor.providerAdvanced")}</span><ChevronDown size={15} className={advancedOpen ? "rotate-open" : ""} /></button>{advancedOpen ? <div className="advanced-fields"><div className="form-two"><label className="module-field"><span>{t("providerEditor.discovery")}</span><StyledSelect value={form.discoveryType} onValueChange={(next) => setForm((current) => ({ ...current, discoveryType: next }))} options={[{ value: "", label: t("providerEditor.discoveryManual") }, { value: "openai-models-list", label: "OpenAI" }, { value: "ollama", label: "Ollama" }, { value: "llama.cpp", label: "llama.cpp" }, { value: "lm-studio", label: "LM Studio" }, { value: "proxy", label: "Proxy" }, { value: "litellm", label: "LiteLLM" }]} ariaLabel={t("providerEditor.discovery")} /></label><label className="module-field"><span>Transport</span><input value={form.transport} onChange={(event) => setForm((current) => ({ ...current, transport: event.target.value }))} placeholder="pi-native" /></label></div><div className="form-two"><label className="check-line"><input type="checkbox" checked={form.authHeader} onChange={(event) => setForm((current) => ({ ...current, authHeader: event.target.checked }))} />Auth header</label><label className="check-line"><input type="checkbox" checked={form.disableStrictTools} onChange={(event) => setForm((current) => ({ ...current, disableStrictTools: event.target.checked }))} />{t("providerEditor.looseTools")}</label></div><label className="module-field"><span>Headers</span><textarea value={form.headers} onChange={(event) => setForm((current) => ({ ...current, headers: event.target.value }))} rows={3} placeholder='{"X-Client":"omp-switch"}' /></label><label className="module-field"><span>Compat</span><textarea value={form.compat} onChange={(event) => setForm((current) => ({ ...current, compat: event.target.value }))} rows={3} /></label><label className="module-field"><span>Overrides</span><textarea value={form.overrides} onChange={(event) => setForm((current) => ({ ...current, overrides: event.target.value }))} rows={3} /></label><label className="module-field"><span>{t("models.remoteCompactionLabel")}</span><textarea value={form.remoteCompaction} onChange={(event) => setForm((current) => ({ ...current, remoteCompaction: event.target.value }))} rows={3} placeholder='{"enabled":true,"endpoint":"https://..."}' /></label><label className="module-field"><span>Cost</span><textarea value={form.cost} onChange={(event) => setForm((current) => ({ ...current, cost: event.target.value }))} rows={2} placeholder='{"input":0.1,"output":0.4}' /></label><label className="module-field"><span>Code Mode</span><StyledSelect value={form.codeMode} onValueChange={(next) => setForm((current) => ({ ...current, codeMode: next }))} options={[{ value: "", label: t("providerEditor.codeModeUnset") }, ...CODE_MODE_VALUES.map((mode) => ({ value: mode, label: mode }))]} ariaLabel="Codex Code Mode" mono /></label></div> : null}
            </div>
            <div className="drawer-actions form-submit-actions"><button className="secondary-button" onClick={() => void fetchModels()} disabled={busy}><CloudDownload size={15} />{t("providerEditor.testAndDiscover")}</button><button className="primary-button" onClick={() => void saveProvider()} disabled={busy || readOnly}><Save size={15} />{t("providerEditor.save")}</button></div>
          </div> : null}


          {!profileDrawerOpen && !diagnosticsOpen && !formOpen && selectedProvider ? <div className="drawer-body"><div className="drawer-section"><div className="drawer-section-title"><span>{t("providerEditor.connection")}</span><span className="status-chip ok">{selectedProvider.auth === "none" ? t("models.noKeyNeeded") : selectedProvider.apiKey ? t("models.keyConfigured") : t("models.keyNotConfigured")}</span></div><div className="detail-grid"><span>API</span><strong>{selectedProvider.api ?? "custom"}</strong><span>Endpoint</span><strong className="mono break">{selectedProvider.baseUrl ?? "—"}</strong><span>Auth</span><strong>{selectedProvider.auth ?? "apiKey"}</strong></div><div className="drawer-actions"><button className="primary-button" onClick={() => editProvider(selectedProviderId!)}><Sparkles size={15} />{t("models.edit")}</button><button className="icon-button danger" title={t("providerEditor.removeProvider", { target: selectedProviderId ?? "" })} onClick={() => void removeProvider()} disabled={busy || readOnly}><Trash2 size={15} /></button></div></div><div className="drawer-section"><div className="drawer-section-title"><span>{t("providerEditor.models")}</span><span className="status-chip neutral">{selectedModels.length}</span></div>{selectedModels.map((model) => <div className="mini-model" key={model.id}><strong>{model.name ?? model.id}</strong><span>{model.id}</span></div>)}</div></div> : null}
          </motion.aside> : null}
        </AnimatePresence>
      </main>
      <SavePreviewDialog pending={pendingSave} busy={busy} onClose={() => setPendingSave(null)} onConfirm={() => void confirmPendingSave()} />
      <ConflictDialog detail={conflictDetail} busy={busy} onClose={() => setConflictDetail(null)} onReload={() => { setConflictDetail(null); void load(profileId); }} />
      <ConfirmDialog open={Boolean(confirmAsk)} title={confirmAsk?.title ?? ""} message={confirmAsk?.message ?? ""} confirmLabel={confirmAsk?.confirmLabel ?? t("common.confirm")} danger={confirmAsk?.danger} busy={busy} onClose={() => setConfirmAsk(null)} onConfirm={() => { const ask = confirmAsk; setConfirmAsk(null); ask?.action(); }} />
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
          { id: "new-provider", label: t("palette.newProvider"), run: beginAdd },
          { id: "save-all", label: t("palette.saveAll"), run: () => { void saveDirty(); } },
          { id: "snapshot", label: t("palette.snapshot"), run: () => { void createSnapshot(); } },
          { id: "reload", label: t("palette.reload"), run: () => { void load(profileId); } },
          { id: "help", label: t("palette.help"), run: () => setHelpOpen(true) },
        ]}
      />
      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <Toaster position="bottom-right" theme="system" closeButton toastOptions={{ classNames: { info: "toast-info" } }} />
    </div>
    </Tooltip.Provider>
  );
}
