export type ProfileKind = "default" | "named";

export interface ProfileRef {
  id: string;
  name: string;
  kind: ProfileKind;
  agentDir: string;
}

export interface ProfilePaths {
  profile: string;
  agentDir: string;
  modelsCandidates: string[];
  settingsCandidates: string[];
}

export interface OmpInstallation {
  executable: string | null;
  version: string | null;
  supported: boolean;
  reason?: string;
}

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
}

export interface OmpModel extends Record<string, unknown> {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
}

export interface OmpProvider extends Record<string, unknown> {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  authHeader?: boolean;
  auth?: "apiKey" | "none" | "oauth" | string;
  disableStrictTools?: boolean;
  discovery?: {
    type?: string;
    timeoutMs?: number;
    [key: string]: unknown;
  };
  modelOverrides?: Record<string, Record<string, unknown>>;
  models?: OmpModel[];
  [key: string]: unknown;
}

export interface ModelsDocument extends Record<string, unknown> {
  providers: Record<string, OmpProvider>;
}

export interface SettingsDocument extends Record<string, unknown> {
  modelRoles?: Record<string, string>;
}

export interface CredentialRef {
  id: string;
  label: string;
}

export interface CredentialStatus {
  exists: boolean;
  label: string;
  masked: string;
}

export interface Snapshot {
  id: string;
  profile: string;
  createdAt: string;
  modelsPath: string;
  settingsPath: string;
  modelsHash?: string;
  settingsHash?: string;
  modelsExisted?: boolean;
  modelsWritePath?: string;
  modelsWriteHash?: string;
  modelsWriteExisted?: boolean;
  settingsExisted?: boolean;
}

export interface LoadedConfig<T> {
  value: T;
  raw: string;
  path: string;
  hash: string;
  exists: boolean;
  legacy: boolean;
  diagnostics: Diagnostic[];
}

export interface EffectiveConfig {
  profile: ProfileRef;
  paths: ProfilePaths;
  models: LoadedConfig<ModelsDocument>;
  settings: LoadedConfig<SettingsDocument>;
  diagnostics: Diagnostic[];
}

export interface ProviderDraft {
  id: string;
  baseUrl: string;
  api: string;
  apiKey?: string | null;
  auth?: string;
  headers?: Record<string, string> | null;
  compat?: Record<string, unknown> | null;
  models: OmpModel[];
  discovery?: OmpProvider["discovery"];
  modelOverrides?: OmpProvider["modelOverrides"] | null;
}

export interface ConfigPatch {
  provider?: ProviderDraft;
  removeProviderId?: string;
  roleAssignments?: Record<string, string | null>;
  confirmLegacyMigration?: boolean;
}

export interface PatchPreview {
  profile: ProfileRef;
  models: ModelsDocument;
  settings: SettingsDocument;
  diagnostics: Diagnostic[];
  expectedModelsHash: string;
  expectedSettingsHash: string;
  legacyMigrationApproved: boolean;
}

export interface CommitResult {
  snapshot: Snapshot;
  config: EffectiveConfig;
}

export interface DiscoveryModel {
  id: string;
  name?: string;
  created?: number;
  ownedBy?: string;
}

export interface DiscoveryResult {
  models: DiscoveryModel[];
  endpoint: string;
  durationMs: number;
}

export class ConfigConflictError extends Error {
  constructor(public readonly filePath: string) {
    super(`Configuration changed outside OMP Switch: ${filePath}`);
    this.name = "ConfigConflictError";
  }
}

export class ConfigValidationError extends Error {
  constructor(public readonly diagnostics: Diagnostic[]) {
    super(diagnostics.map((item) => item.message).join("; "));
    this.name = "ConfigValidationError";
  }
}
