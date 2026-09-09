import type {
  ConfigPatch,
  DiscoveryResult,
  EffectiveConfig,
  PatchPreview,
  Snapshot,
} from "@omp-switch/core";
import { applyConfigPatch } from "@omp-switch/core";
import i18n from "./i18n";

export function createMockApi(): NonNullable<Window["ompSwitch"]> {
  const memory: Record<string, EffectiveConfig> = {};
  const makeConfig = (profileId: string): EffectiveConfig => ({
    profile: {
      id: profileId,
      name: profileId === "default" ? "Default" : profileId,
      kind: profileId === "default" ? "default" : "named",
      agentDir: `~/.omp/${profileId === "default" ? "agent" : `profiles/${profileId}/agent`}`,
    },
    paths: {
      profile: profileId,
      agentDir: `~/.omp/${profileId === "default" ? "agent" : `profiles/${profileId}/agent`}`,
      modelsCandidates: [],
      settingsCandidates: [],
    },
    models: {
      value: {
        providers: {
          openrouter: {
            baseUrl: "https://openrouter.ai/api/v1",
            api: "openai-completions",
            auth: "apiKey",
            apiKey: "OPENROUTER_API_KEY",
            models: [
              {
                id: "openai/gpt-4.1",
                name: "GPT-4.1",
                reasoning: true,
                contextWindow: 128000,
                maxTokens: 16384,
              },
            ],
          },
        },
      },
      raw: "# OMP model providers\nproviders:\n  openrouter:\n    baseUrl: \"https://openrouter.ai/api/v1\"\n    api: openai-completions\n    # auth resolves the key via the secret bridge\n    auth: apiKey\n    models:\n      - id: openai/gpt-4.1\n        name: \"GPT-4.1\"\n        contextWindow: 128000\n        maxTokens: 16384\n",
      path: "~/.omp/agent/models.yml",
      hash: "demo",
      exists: true,
      legacy: false,
      diagnostics: [],
    },
    settings: {
      value: { modelRoles: { default: "openrouter/openai/gpt-4.1", slow: "@default" } },
      raw: "modelRoles:\n  default: openrouter/openai/gpt-4.1\n  slow: \"@default\"\n",
      path: "~/.omp/agent/config.yml",
      hash: "demo-settings",
      exists: true,
      legacy: false,
      diagnostics: [],
    },
    diagnostics: [],
  });

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
    getInfo: async () => ({
      version: "0.5.3",
      platform: typeof navigator !== "undefined" && /linux/i.test(navigator.platform) ? "linux" : "win32",
      installation: {
        executable: "omp",
        version: "omp/18.0.3",
        supported: true,
        schemaMajor: 18,
        schemaStatus: "supported",
      },
    }),
    setTheme: async () => undefined,
    listProfiles: async () => [
      { id: "default", name: "Default", kind: "default", agentDir: "~/.omp/agent" },
      { id: "work", name: "Work Profile", kind: "named", agentDir: "~/.omp/profiles/work/agent" },
    ],
    loadProfile: async (id: string) => get(id),
    preview: async (id: string, patch: ConfigPatch) => {
      const config = get(id);
      const isRemoval = Boolean(patch.removeProviderId);
      const isPreferredOnly = Boolean(patch.settings?.modelProviderOrder && !patch.provider && !patch.roleAssignments);
      const modelsText = isPreferredOnly
        ? config.models.raw
        : isRemoval
          ? "# OMP model providers\nproviders: {}\n"
          : config.models.raw + (patch.provider ? `\n  # ${patch.provider.id} patched\n` : "");
      const settingsText =
        config.settings.raw +
        (patch.roleAssignments
          ? `\n# roles updated: ${Object.keys(patch.roleAssignments).join(", ")}\n`
          : "") +
        (patch.settings?.modelProviderOrder
          ? `\n# provider order: ${patch.settings.modelProviderOrder.join(", ")}\n`
          : "");

      const previewObj: PatchPreview = {
        profile: config.profile,
        models: config.models.value,
        settings: config.settings.value,
        diagnostics: [],
        expectedModelsHash: config.models.hash,
        expectedSettingsHash: config.settings.hash,
        legacyMigrationApproved: false,
      };

      return {
        preview: previewObj,
        modelsText,
        settingsText,
      };
    },
    listSnapshots: async (profileId: string) =>
      [1, 2].map((hoursAgo) => ({
        id: `demo-${hoursAgo}`,
        profile: profileId,
        createdAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
        modelsPath: "~/.omp/agent/models.yml",
        settingsPath: "~/.omp/agent/config.yml",
      })),
    save: async (id: string, patch: ConfigPatch) => {
      // Delegate to the adapter's own merge semantics so the demo cannot drift from the real save.
      const config = get(id);
      const { models, settings } = applyConfigPatch(config, patch);
      config.models.value = models;
      config.settings.value = settings;
      return {
        snapshot: {
          id: "demo-snapshot",
          profile: id,
          createdAt: new Date().toISOString(),
          modelsPath: config.models.path,
          settingsPath: config.settings.path,
        },
        config,
      };
    },
    snapshot: async (id: string) => ({
      id: "demo-snapshot",
      profile: id,
      createdAt: new Date().toISOString(),
      modelsPath: get(id).models.path,
      settingsPath: get(id).settings.path,
    }),
    restore: async (profileId: string, _snapshotId: string, _options?: { force?: boolean }) => get(profileId),
    restoreLatest: async (profileId: string) => ({
      snapshot: {
        id: "demo-snapshot",
        profile: profileId,
        createdAt: new Date().toISOString(),
        modelsPath: get(profileId).models.path,
        settingsPath: get(profileId).settings.path,
      },
      config: get(profileId),
    }),
    discover: async (): Promise<DiscoveryResult> => ({
      endpoint: "https://example.test/v1/models",
      durationMs: 184,
      models: [
        { id: "demo-fast", name: "Demo Fast" },
        { id: "demo-reasoning", name: "Demo Reasoning" },
      ],
    }),
    secretPut: async (input) => ({
      id: input.id ?? "demo-credential",
      command: "omp-switch --secret-get demo-credential",
    }),
    secretStatus: async () => ({ exists: true, label: "Demo credential", masked: "••••••••" }),
    secretDelete: async () => ({ deleted: true, references: [] }),
    secretOrphans: async () => [],
    authStatus: async () => ({ ok: true, output: "No active browser session in demo mode" }),
    authLogin: async () => ({ ok: false, output: "", error: "Run the packaged app to invoke omp auth login" }),
    checkForUpdates: async () => ({
      available: true,
      currentVersion: "0.5.3",
      checkedAt: new Date().toISOString(),
      manifest: {
        version: 1,
        name: "OMP Switch",
        release: "0.5.3",
        url: "https://github.com/skh2945932142/omp-switch/releases/tag/v0.5.3",
        summary: "修复模型供应商模型配置与主工作区中的长模型名与标识截断显示问题",
        publishedAt: new Date().toISOString(),
      },
    }),
    updateStatus: async () => ({ enabled: true, lastCheckAt: new Date().toISOString(), lastResult: null }),
    setUpdateCheckEnabled: async () => undefined,
    openExternal: async () => undefined,
    listCatalog: async () => [],
    importCatalog: async () => ({ version: 1 as const, source: "demo", entries: [] }),
    exportCatalog: async () => ({ version: 1 as const, source: "demo", entries: [] }),
    projectOverlay: async () => ({ root: "D:/demo-project", explicit: false, overlay: null, precedence: [] }),
    chooseProjectRoot: async (_profileId?: string, _title?: string) => ({ root: "D:/demo-project", explicit: true, overlay: null, precedence: [] }),
    listSurface: async () => [],
    readSurface: async () => "",
    writeSurface: async (_profileId, _kind, name) => ({
      id: name,
      name,
      path: name,
      source: "profile" as const,
      enabled: true,
    }),
    deleteSurface: async () => undefined,
    exportSurfaces: async (profileId) => ({ version: 1 as const, profile: profileId, items: [] }),
    importSurfaces: async () => [],
    refreshSessions: async () => ({
      discovered: 0,
      skipped: 0,
      reused: 0,
      changed: 0,
      rebuilt: 0,
      scannedBytes: 0,
      invalidLines: 0,
      errors: 0,
    }),
    listSessions: async () => ({
      sessions: [
        {
          id: "demo-session-1",
          profile: "default",
          title: "重构 provider 配置加载",
          model: "gpt-5",
          provider: "openai",
          messageCount: 12,
          requestCount: 6,
          tokens: { input: 18420, output: 5210 },
          cost: 0.0842,
          failures: 0,
          stale: false,
          fileSize: 48211,
          startedAt: "2026-08-21T13:42:00Z",
          lastActiveAt: "2026-08-21T14:08:00Z",
        },
      ],
      nextCursor: undefined,
    }),
    searchSessionFts: async () => [],
    readSessionMessages: async (_profileId, _sessionId) => ({
      messages: [
        {
          id: "m1",
          role: "system",
          text: "Session started with model openai/gpt-5",
          timestamp: "2026-08-21T13:42:00Z",
        },
      ],
      hasMore: false,
      nextCursor: undefined,
    }),
    usageSummary: async () => ({
      report: {
        totals: {
          key: "total",
          requests: 100,
          failures: 0,
          tokens: { input: 100000, output: 20000, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 120000 },
          recordedCost: 0.5,
          computedCost: 0,
          pricedRequests: 0,
          firstAt: "2026-08-15T08:00:00Z",
          lastAt: "2026-08-21T22:00:00Z",
        },
        byModel: [],
        byProvider: [],
        byDay: [],
        byModelByDay: {},
        byProviderByDay: {},
        unpriced: [],
      },
      indexedEntries: 100,
      invalidLines: 0,
      pricedModels: 0,
      overrides: {},
    }),
    setUsagePrice: async () => ({}),
    listGatewayPools: async () => [],
    saveGatewayPool: async (pool) => pool,
    gatewayStatus: async () => ({ running: false, port: null, upstreams: [] }),
    gatewayHealth: async () => ({}),
    probeGatewayUpstream: async () => ({ ok: true, status: 200, latencyMs: 115 }),
    startGateway: async () => ({ running: true, port: 46831, token: "demo-gateway-token" }),
    stopGateway: async () => undefined,
    updateOmp: async () => ({ ok: false, output: "Demo mode" }),
  };
}

export const api = window.ompSwitch ?? createMockApi();
