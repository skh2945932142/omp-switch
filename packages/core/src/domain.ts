export type ProfileKind = "default" | "named";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "auto";

/**
 * OMP accepts three different thinking-level sets and they are not interchangeable.
 * `defaultThinkingLevel` in config.yml takes everything except `off` (docs/settings.md).
 */
export type SettingsThinkingLevel = Exclude<ThinkingLevel, "off">;

/**
 * A `provider/model:<level>` role suffix takes neither `off` nor `auto` (docs/settings.md).
 * The full `ThinkingLevel` union only applies to OMP's `--model` command-line patterns,
 * which this app does not write.
 */
export type RoleThinkingLevel = Exclude<ThinkingLevel, "off" | "auto">;

export type OmpSchemaStatus = "supported" | "readonly" | "unknown";

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

/** One OMP environment variable that moved the paths this app is about to write. */
export interface OmpPathOverride {
  variable: "PI_CONFIG_DIR" | "PI_CODING_AGENT_DIR" | "OMP_PROFILE" | "PI_PROFILE";
  value: string;
  effect: string;
}

/**
 * Where OMP actually reads config from, after its own environment overrides.
 * Resolved by `resolveOmpPaths`; `overrides` exists so the UI can show the user
 * why the paths are not the plain `~/.omp/agent` default.
 */
export interface OmpPathResolution {
  ompRoot: string;
  activeProfile: string;
  overrides: OmpPathOverride[];
}

export interface OmpInstallation {
  executable: string | null;
  version: string | null;
  supported: boolean;
  reason?: string;
  schemaMajor?: number;
  schemaStatus?: OmpSchemaStatus;
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
  transport?: string;
  remoteCompaction?: RemoteCompactionConfig;
  cost?: Record<string, number>;
  imageInputDecoder?: string;
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
  transport?: string;
  remoteCompaction?: RemoteCompactionConfig;
  cost?: Record<string, number>;
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
  modelProviderOrder?: string[];
  enabledModels?: EnabledModelRule[];
  disabledProviders?: DisabledProviderRule[];
  defaultThinkingLevel?: SettingsThinkingLevel;
}

export interface RemoteCompactionConfig extends Record<string, unknown> {
  enabled?: boolean;
  api?: string;
  endpoint?: string;
  model?: string;
  v2StreamingEnabled?: boolean;
  v2Endpoint?: string;
  streamingEndpoint?: string;
}

export type EnabledModelRule = string | Record<string, unknown>;

/** Same bare-string-or-path-scoped-mapping shape as `enabledModels`, keyed by `providers`. */
export type DisabledProviderRule = string | Record<string, unknown>;

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
  /**
   * Hashes the commit guarded by this snapshot actually wrote. Absent for a standalone snapshot.
   * A restore accepts either these or the pre-write hashes, which is what lets it tell this app's
   * own write apart from an edit made by something else.
   */
  committedModelsHash?: string;
  committedSettingsHash?: string;
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

export interface ProjectOverlay {
  root: string;
  models: LoadedConfig<ModelsDocument>;
  settings: LoadedConfig<SettingsDocument>;
  diagnostics: Diagnostic[];
}

/**
 * The directory project-level `.omp` lookups start from, plus what was found there.
 * A packaged GUI launched from the Start Menu has an arbitrary `process.cwd()`, so the root is a
 * deliberate choice rather than whatever the process happened to start in.
 */
export interface ProjectContext {
  root: string;
  /** False when the root is only a `process.cwd()` guess the user has not confirmed. */
  explicit: boolean;
  overlay: ProjectOverlay | null;
  /** How this overlay overrides the user-level config (array replacement, role storage). */
  precedence: Diagnostic[];
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
  authHeader?: boolean;
  disableStrictTools?: boolean;
  transport?: string;
  remoteCompaction?: RemoteCompactionConfig | null;
  cost?: Record<string, number> | null;
}

export interface ConfigPatch {
  provider?: ProviderDraft;
  removeProviderId?: string;
  roleAssignments?: Record<string, string | null>;
  settings?: Partial<Pick<SettingsDocument, "modelProviderOrder" | "enabledModels" | "disabledProviders" | "defaultThinkingLevel">>;
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
  type?: string;
}

export interface CatalogModel extends OmpModel {
  providerId: string;
  source?: string;
  updatedAt?: string;
}

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  api: string;
  auth?: string;
  discovery?: OmpProvider["discovery"];
  models?: CatalogModel[];
  source: string;
  version: string;
  category?: string;
  requiresBaseUrl?: boolean;
}

export type SurfaceSourceKind = "user" | "profile" | "project" | "plugin" | "external";

export interface ManagedSurfaceEntry {
  id: string;
  name: string;
  path: string;
  source: SurfaceSourceKind;
  enabled: boolean;
  updatedAt?: string;
}

/**
 * Legacy event-level index entry. Kept for migration/tests only; renderer APIs must use
 * SessionSummary so absolute filesystem paths never cross the Electron boundary.
 */
export interface SessionIndexEntry {
  id: string;
  /** Stable local lookup key; keeps duplicate event IDs from different JSONL files distinct. */
  sourceKey?: string;
  profile: string;
  filePath: string;
  offset: number;
  length: number;
  startedAt?: string;
  model?: string;
  provider?: string;
  status?: string;
  usage?: Record<string, number>;
  cost?: number;
}

/** Aggregated, renderer-safe representation of one OMP session file. */
export interface SessionSummary {
  id: string;
  profile: string;
  title?: string;
  startedAt?: string;
  lastActiveAt?: string;
  model?: string;
  provider?: string;
  status?: string;
  messageCount: number;
  requestCount: number;
  failures: number;
  tokens: Record<string, number>;
  cost: number;
  fileSize: number;
  indexedAt?: string;
  stale?: boolean;
  indexStatus?: "ready" | "stale" | "partial" | "error";
}

/** Internal usage row retained per assistant request so usage reports remain exact. */
export interface SessionUsageRecord {
  id: string;
  sessionId: string;
  profile: string;
  startedAt?: string;
  firstAt?: string;
  lastAt?: string;
  model?: string;
  provider?: string;
  status?: string;
  tokens: Record<string, number>;
  cost?: number;
  requestCount: number;
  failures: number;
  sourceKey?: string;
}

export interface SessionMessagePreview {
  id: string;
  role: string;
  timestamp?: string;
  model?: string;
  provider?: string;
  status?: string;
  text: string;
  truncated?: boolean;
}

export interface SessionMessagePage {
  messages: SessionMessagePreview[];
  nextCursor?: string;
  hasMore: boolean;
}

/** Private cache shape: persisted by the main process, never passed to the renderer. */
export interface SessionFileCache {
  id: string;
  profile: string;
  relativePath: string;
  fileSize: number;
  mtimeMs: number;
  headHash: string;
  completeBytes: number;
  invalidLines: number;
  summary: SessionSummary;
  usage: SessionUsageRecord[];
}

export interface SessionRefreshStats {
  phase?: "quick" | "complete";
  discovered: number;
  skipped: number;
  reused: number;
  changed: number;
  rebuilt: number;
  scannedBytes: number;
  invalidLines: number;
  errors: number;
  rootMissing?: boolean;
  diagnostics?: Diagnostic[];
}

export interface SessionRefreshResult {
  caches: SessionFileCache[];
  stats: SessionRefreshStats;
}

export interface SessionListPage {
  sessions: SessionSummary[];
  nextCursor?: string;
}

export interface GatewayUpstream {
  id: string;
  providerId: string;
  modelId: string;
  kind: "secret" | "omp-auth-gateway";
  credentialId?: string;
  enabled: boolean;
}

export interface GatewayPool {
  id: string;
  profile: string;
  virtualModel: string;
  port: number;
  enabled: boolean;
  upstreams: GatewayUpstream[];
}

/** Per-upstream observation recorded while forwarding, surfaced for latency/health display. */
export interface GatewayUpstreamStat {
  poolId: string;
  upstreamId: string;
  lastStatus?: number;
  lastLatencyMs?: number;
  lastAt?: string;
  lastError?: string;
  consecutiveFailures: number;
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
