import { contextBridge, ipcRenderer } from "electron";
import type { ConfigPatch, DiscoveryResult, EffectiveConfig, GatewayPool, ManagedSurfaceEntry, ProfileRef, SessionIndexEntry, Snapshot, SurfaceBundle } from "@omp-switch/core";

const api = {
  getInfo: () => ipcRenderer.invoke("app:info"),
  listProfiles: (): Promise<ProfileRef[]> => ipcRenderer.invoke("omp:list-profiles"),
  loadProfile: (profileId: string): Promise<EffectiveConfig> => ipcRenderer.invoke("omp:load-profile", profileId),
  save: (profileId: string, patch: ConfigPatch) => ipcRenderer.invoke("omp:save", profileId, patch),
  snapshot: (profileId: string): Promise<Snapshot> => ipcRenderer.invoke("omp:snapshot", profileId),
  restore: (snapshot: Snapshot) => ipcRenderer.invoke("omp:restore", snapshot),
  restoreLatest: (profileId: string) => ipcRenderer.invoke("omp:restore-latest", profileId),
  discover: (options: { baseUrl: string; apiKey?: string; headers?: Record<string, string>; timeoutMs?: number; type?: "ollama" | "llama.cpp" | "lm-studio" | "openai-models-list" | "proxy" | "litellm" }): Promise<DiscoveryResult> => ipcRenderer.invoke("omp:discover", options),
  listCatalog: (query?: string) => ipcRenderer.invoke("catalog:list", query),
  importCatalog: (bundle: unknown) => ipcRenderer.invoke("catalog:import", bundle),
  exportCatalog: () => ipcRenderer.invoke("catalog:export"),
  projectOverlay: (profileId = "default") => ipcRenderer.invoke("project:overlay", profileId),
  chooseProjectRoot: (profileId = "default") => ipcRenderer.invoke("project:choose-root", profileId),

  listSurface: (profileId: string, kind: "prompt" | "skill"): Promise<ManagedSurfaceEntry[]> => ipcRenderer.invoke("surface:list", profileId, kind),
  readSurface: (profileId: string, kind: "prompt" | "skill", name: string): Promise<string> => ipcRenderer.invoke("surface:read", profileId, kind, name),
  writeSurface: (profileId: string, kind: "prompt" | "skill", name: string, content: string): Promise<ManagedSurfaceEntry> => ipcRenderer.invoke("surface:write", profileId, kind, name, content),
  deleteSurface: (profileId: string, kind: "prompt" | "skill", name: string): Promise<void> => ipcRenderer.invoke("surface:delete", profileId, kind, name),
  exportSurfaces: (profileId: string): Promise<SurfaceBundle> => ipcRenderer.invoke("surface:export", profileId),
  importSurfaces: (profileId: string, bundle: SurfaceBundle): Promise<ManagedSurfaceEntry[]> => ipcRenderer.invoke("surface:import", profileId, bundle),
  indexSessions: (profileId: string) => ipcRenderer.invoke("session:index", profileId),
  listSessions: (profileId: string): Promise<SessionIndexEntry[]> => ipcRenderer.invoke("session:list", profileId),
  readSession: (profileId: string, id: string): Promise<string> => ipcRenderer.invoke("session:raw", profileId, id),
  listGatewayPools: (profileId?: string): Promise<GatewayPool[]> => ipcRenderer.invoke("gateway:list", profileId),
  saveGatewayPool: (pool: GatewayPool): Promise<GatewayPool> => ipcRenderer.invoke("gateway:save", pool),
  gatewayStatus: () => ipcRenderer.invoke("gateway:status"),
  startGateway: (profileId: string) => ipcRenderer.invoke("gateway:start", profileId),
  stopGateway: () => ipcRenderer.invoke("gateway:stop"),
  updateOmp: (profileId = "default") => ipcRenderer.invoke("omp:update", profileId),
  secretPut: (input: { id?: string; label: string; value: string }): Promise<{ id: string; command: string }> => ipcRenderer.invoke("secret:put", input),
  secretStatus: (id: string) => ipcRenderer.invoke("secret:status", id),
  secretDelete: (id: string, force?: boolean) => ipcRenderer.invoke("secret:delete", id, force),
  secretOrphans: (profileId = "default") => ipcRenderer.invoke("secret:orphans", profileId),

  authStatus: (provider: string) => ipcRenderer.invoke("omp:auth-status", provider),
  authLogin: (provider: string) => ipcRenderer.invoke("omp:auth-login", provider),
  openFolder: (folder: string) => ipcRenderer.invoke("app:open-folder", folder),
};

contextBridge.exposeInMainWorld("ompSwitch", api);
