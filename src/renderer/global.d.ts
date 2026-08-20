import type { ConfigPatch, DiscoveryResult, EffectiveConfig, GatewayPool, GatewayUpstreamStat, ManagedSurfaceEntry, ModelPrice, PatchPreview, PricingTable, ProfileRef, ProjectContext, ProviderPreset, SessionListPage, SessionMessagePage, SessionRefreshStats, Snapshot, SurfaceBundle, UsageReport } from "@omp-switch/core";

export interface OmpSwitchApi {
  getInfo(): Promise<{ version: string; platform: string; installation: { executable: string | null; version: string | null; supported: boolean; reason?: string; schemaMajor?: number; schemaStatus?: string } }>;
  listProfiles(): Promise<ProfileRef[]>;
  loadProfile(profileId: string): Promise<EffectiveConfig>;
  save(profileId: string, patch: ConfigPatch): Promise<{ snapshot: Snapshot; config: EffectiveConfig }>;
  preview(profileId: string, patch: ConfigPatch): Promise<{ preview: PatchPreview; modelsText: string; settingsText: string }>;
  listSnapshots(profileId: string): Promise<Snapshot[]>;
  snapshot(profileId: string): Promise<Snapshot>;
  restore(snapshot: Snapshot): Promise<EffectiveConfig>;
  restoreLatest(profileId: string): Promise<{ snapshot: Snapshot; config: EffectiveConfig }>;
  discover(options: { baseUrl: string; apiKey?: string; headers?: Record<string, string>; timeoutMs?: number; type?: "ollama" | "llama.cpp" | "lm-studio" | "openai-models-list" | "proxy" | "litellm" }): Promise<DiscoveryResult>;
  listCatalog(query?: string): Promise<ProviderPreset[]>;
  importCatalog(bundle: unknown): Promise<{ version: 1; source: string; entries: ProviderPreset[] }>;
  exportCatalog(): Promise<{ version: 1; source: string; entries: ProviderPreset[] }>;
  projectOverlay(profileId?: string): Promise<ProjectContext>;
  chooseProjectRoot(profileId?: string): Promise<ProjectContext>;

  listSurface(profileId: string, kind: "prompt" | "skill"): Promise<ManagedSurfaceEntry[]>;
  readSurface(profileId: string, kind: "prompt" | "skill", name: string): Promise<string>;
  writeSurface(profileId: string, kind: "prompt" | "skill", name: string, content: string): Promise<ManagedSurfaceEntry>;
  deleteSurface(profileId: string, kind: "prompt" | "skill", name: string): Promise<void>;
  exportSurfaces(profileId: string): Promise<SurfaceBundle>;
  importSurfaces(profileId: string, bundle: SurfaceBundle): Promise<ManagedSurfaceEntry[]>;
  refreshSessions(profileId: string, options?: { rebuild?: boolean }): Promise<SessionRefreshStats>;
  listSessions(profileId: string, options?: { limit?: number; cursor?: string }): Promise<SessionListPage>;
  readSessionMessages(profileId: string, id: string, options?: { cursor?: string }): Promise<SessionMessagePage>;
  usageSummary(profileId?: string, options?: { from?: string; to?: string; reindex?: boolean }): Promise<{
    report: UsageReport;
    indexedEntries: number;
    invalidLines: number;
    pricedModels: number;
    overrides: PricingTable;
  }>;
  setUsagePrice(key: string, price: ModelPrice | null): Promise<PricingTable>;
  listGatewayPools(profileId?: string): Promise<GatewayPool[]>;
  saveGatewayPool(pool: GatewayPool): Promise<GatewayPool>;
  gatewayStatus(): Promise<{ running: boolean; port: number | null; upstreams: GatewayUpstreamStat[] }>;
  startGateway(profileId: string): Promise<{ running: boolean; port: number; token: string }>;
  stopGateway(): Promise<void>;
  updateOmp(profileId?: string): Promise<{ ok: boolean; output: string; installation?: { version: string | null; supported: boolean; reason?: string }; snapshot?: Snapshot }>;
  secretPut(input: { id?: string; label: string; value: string }): Promise<{ id: string; command: string }>;
  secretStatus(id: string): Promise<{ exists: boolean; label: string; masked: string }>;
  secretDelete(id: string, force?: boolean): Promise<{ deleted: boolean; references: string[] }>;
  secretOrphans(profileId?: string): Promise<Array<{ id: string; label: string }>>;

  authStatus(provider: string): Promise<{ ok: boolean; output: string; error?: string }>;
  authLogin(provider: string): Promise<{ ok: boolean; output: string; error?: string }>;
}

declare global {
  interface Window {
    ompSwitch?: OmpSwitchApi;
  }
}

export {};
