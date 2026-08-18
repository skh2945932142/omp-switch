import { contextBridge, ipcRenderer } from "electron";
import type { ConfigPatch, DiscoveryResult, EffectiveConfig, ProfileRef, Snapshot } from "@omp-switch/core";

const api = {
  getInfo: () => ipcRenderer.invoke("app:info"),
  listProfiles: (): Promise<ProfileRef[]> => ipcRenderer.invoke("omp:list-profiles"),
  loadProfile: (profileId: string): Promise<EffectiveConfig> => ipcRenderer.invoke("omp:load-profile", profileId),
  save: (profileId: string, patch: ConfigPatch) => ipcRenderer.invoke("omp:save", profileId, patch),
  snapshot: (profileId: string): Promise<Snapshot> => ipcRenderer.invoke("omp:snapshot", profileId),
  restore: (snapshot: Snapshot) => ipcRenderer.invoke("omp:restore", snapshot),
  restoreLatest: (profileId: string) => ipcRenderer.invoke("omp:restore-latest", profileId),
  discover: (options: { baseUrl: string; apiKey?: string; headers?: Record<string, string>; timeoutMs?: number }): Promise<DiscoveryResult> => ipcRenderer.invoke("omp:discover", options),
  secretPut: (input: { id?: string; label: string; value: string }): Promise<{ id: string; command: string }> => ipcRenderer.invoke("secret:put", input),
  secretStatus: (id: string) => ipcRenderer.invoke("secret:status", id),
  secretDelete: (id: string) => ipcRenderer.invoke("secret:delete", id),
  authStatus: (provider: string) => ipcRenderer.invoke("omp:auth-status", provider),
  authLogin: (provider: string) => ipcRenderer.invoke("omp:auth-login", provider),
  openFolder: (folder: string) => ipcRenderer.invoke("app:open-folder", folder),
};

contextBridge.exposeInMainWorld("ompSwitch", api);
