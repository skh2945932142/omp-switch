import type { ConfigPatch, DiscoveryResult, EffectiveConfig, ProfileRef, Snapshot } from "@omp-switch/core";

interface OmpSwitchApi {
  getInfo(): Promise<{ version: string; platform: string; installation: { executable: string | null; version: string | null; supported: boolean; reason?: string } }>;
  listProfiles(): Promise<ProfileRef[]>;
  loadProfile(profileId: string): Promise<EffectiveConfig>;
  save(profileId: string, patch: ConfigPatch): Promise<{ snapshot: Snapshot; config: EffectiveConfig }>;
  snapshot(profileId: string): Promise<Snapshot>;
  restore(snapshot: Snapshot): Promise<EffectiveConfig>;
  restoreLatest(profileId: string): Promise<{ snapshot: Snapshot; config: EffectiveConfig }>;
  discover(options: { baseUrl: string; apiKey?: string; headers?: Record<string, string>; timeoutMs?: number }): Promise<DiscoveryResult>;
  secretPut(input: { id?: string; label: string; value: string }): Promise<{ id: string; command: string }>;
  secretStatus(id: string): Promise<{ exists: boolean; label: string; masked: string }>;
  secretDelete(id: string): Promise<void>;
  authStatus(provider: string): Promise<{ ok: boolean; output: string; error?: string }>;
  authLogin(provider: string): Promise<{ ok: boolean; output: string; error?: string }>;
  openFolder(folder: string): Promise<string>;
}

declare global {
  interface Window {
    ompSwitch?: OmpSwitchApi;
  }
}

export {};
