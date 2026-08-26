import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  CommitResult,
  ConfigConflictError,
  ConfigPatch,
  ConfigValidationError,
  Diagnostic,
  EffectiveConfig,
  ModelsDocument,
  OmpInstallation,
  PatchPreview,
  ProfileRef,
  SettingsDocument,
  Snapshot,
} from "./domain";
import { discoverProfileNames, getProfilePaths, OmpPathEnv, resolveOmpPaths, toProfileRef, validateProfileName } from "./paths";
import { assertFileExpectation, FileExpectation, loadStructuredConfig, patchModelsYaml, patchSettingsYaml, sha256File, sha256Text, writeTextAtomic } from "./yaml-config";
import { validateModelsDocument, validateSettingsDocument } from "./validation";

const emptyModels = (): ModelsDocument => ({ providers: {} });
const emptySettings = (): SettingsDocument => ({});

export const DEFAULT_SNAPSHOT_RETENTION = 30;

const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function validateSnapshotId(id: string): string {
  const trimmed = id.trim();
  if (!SNAPSHOT_ID_PATTERN.test(trimmed) || trimmed.includes("..")) {
    throw new Error("Invalid snapshot ID format");
  }
  return trimmed;
}

function isPathInside(parentDir: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(targetPath));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export interface AdapterOptions {
  homeDir: string;
  snapshotDir: string;
  installation?: OmpInstallation;
  /** OMP's own path overrides; pass `process.env` so the app edits the files OMP actually reads. */
  pathEnv?: OmpPathEnv;
  /** How many snapshots to keep per profile; older directories are deleted after each commit. */
  snapshotRetention?: number;
}

export interface RestoreOptions {
  /**
   * Restoring overwrites whatever is on disk now. When false (the default) a file that changed
   * since the snapshot was taken aborts the restore instead of being clobbered.
   */
  force?: boolean;
}

export interface OmpAdapter {
  detectInstallation(): Promise<OmpInstallation>;
  listProfiles(): Promise<ProfileRef[]>;
  loadProfile(profile: ProfileRef): Promise<EffectiveConfig>;
  validate(config: EffectiveConfig): Diagnostic[];
  planPatch(config: EffectiveConfig, patch: ConfigPatch): PatchPreview;
  previewPatch(config: EffectiveConfig, patch: ConfigPatch): { preview: PatchPreview; modelsText: string; settingsText: string };
  commitPatch(config: EffectiveConfig, preview: PatchPreview): Promise<CommitResult>;
  createSnapshot(config: EffectiveConfig): Promise<Snapshot>;
  listSnapshots(profile: ProfileRef): Promise<Snapshot[]>;
  restoreSnapshot(snapshot: Snapshot, options?: RestoreOptions): Promise<void>;
}

export class OmpFilesystemAdapter implements OmpAdapter {
  readonly homeDir: string;
  readonly snapshotDir: string;
  readonly installation: OmpInstallation;
  readonly pathEnv: OmpPathEnv;
  readonly snapshotRetention: number;

  constructor(options: AdapterOptions) {
    this.homeDir = options.homeDir;
    this.snapshotDir = options.snapshotDir;
    this.installation = options.installation ?? { executable: null, version: null, supported: true };
    this.pathEnv = options.pathEnv ?? {
      PI_CONFIG_DIR: process.env.PI_CONFIG_DIR,
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
      OMP_PROFILE: process.env.OMP_PROFILE,
      PI_PROFILE: process.env.PI_PROFILE,
      OMP_MODELS_PATH: process.env.OMP_MODELS_PATH,
    };
    this.snapshotRetention = options.snapshotRetention ?? DEFAULT_SNAPSHOT_RETENTION;
  }

  async detectInstallation(): Promise<OmpInstallation> {
    return this.installation;
  }

  async listProfiles(): Promise<ProfileRef[]> {
    return discoverProfileNames(this.homeDir, this.pathEnv).map((name) => toProfileRef(this.homeDir, name, this.pathEnv));
  }

  async loadProfile(profile: ProfileRef): Promise<EffectiveConfig> {
    const paths = getProfilePaths(this.homeDir, profile.id, this.pathEnv);
    const [models, settings] = await Promise.all([
      loadStructuredConfig(paths.modelsCandidates, emptyModels()),
      loadStructuredConfig(paths.settingsCandidates, emptySettings()),
    ]);
    const diagnostics = [
      ...models.diagnostics,
      ...settings.diagnostics,
      ...validateModelsDocument(models.value),
      ...validateSettingsDocument(settings.value, Object.keys(models.value.providers ?? {})),
    ];
    if (models.legacy) diagnostics.push({ severity: "info", code: "models.legacy", message: "Legacy models.json detected; save will create models.yml after confirmation" });
    if (!this.installation.supported) diagnostics.push({ severity: "warning", code: "omp.version", message: this.installation.reason ?? "Unknown Oh My Pi version" });
    for (const override of resolveOmpPaths(this.homeDir, this.pathEnv).overrides) {
      diagnostics.push({ severity: "info", code: "omp.path-override", message: `${override.variable}=${override.value}: ${override.effect}` });
    }
    return { profile, paths, models, settings, diagnostics };
  }


  validate(config: EffectiveConfig): Diagnostic[] {
    return [
      ...config.models.diagnostics,
      ...config.settings.diagnostics,
      ...validateModelsDocument(config.models.value),
      ...validateSettingsDocument(config.settings.value, Object.keys(config.models.value.providers ?? {})),
    ];
  }

  planPatch(config: EffectiveConfig, patch: ConfigPatch): PatchPreview {
    const models = clone(config.models.value);
    const settings = clone(config.settings.value);
    if (!models.providers || typeof models.providers !== "object") models.providers = {};
    if (patch.removeProviderId) delete models.providers[patch.removeProviderId];
    if (patch.provider) {
      const provider = patch.provider;
      const existing = models.providers[provider.id] ?? {};
      const next = {
        ...existing,
        baseUrl: provider.baseUrl,
        api: provider.api,
        ...(provider.auth !== undefined ? { auth: provider.auth } : {}),
        ...(provider.discovery !== undefined ? { discovery: provider.discovery } : {}),
        models: provider.models,
      };
      applyOptionalField(next, "apiKey", provider.apiKey);
      applyOptionalField(next, "headers", provider.headers);
      applyOptionalField(next, "compat", provider.compat);
      applyOptionalField(next, "modelOverrides", provider.modelOverrides);
      applyOptionalField(next, "authHeader", provider.authHeader);
      applyOptionalField(next, "disableStrictTools", provider.disableStrictTools);
      applyOptionalField(next, "transport", provider.transport);
      applyOptionalField(next, "remoteCompaction", provider.remoteCompaction);
      applyOptionalField(next, "cost", provider.cost);
      applyOptionalField(next, "codeMode", provider.codeMode);
      models.providers[provider.id] = next;
    }
    if (patch.roleAssignments) {
      settings.modelRoles = { ...(settings.modelRoles ?? {}) };
      for (const [role, selector] of Object.entries(patch.roleAssignments)) {
        if (selector === null || selector === "") delete settings.modelRoles[role];
        else settings.modelRoles[role] = selector;
      }
      if (Object.keys(settings.modelRoles).length === 0) delete settings.modelRoles;
    }
    if (patch.settings) {
      for (const [key, value] of Object.entries(patch.settings)) {
        if (value === undefined) continue;
        if (Array.isArray(value) && value.length === 0) delete settings[key];
        else settings[key] = value;
      }
    }
    const diagnostics = [...validateModelsDocument(models), ...validateSettingsDocument(settings, Object.keys(models.providers ?? {}))];
    return {
      profile: config.profile,
      models,
      settings,
      diagnostics,
      expectedModelsHash: config.models.hash,
      expectedSettingsHash: config.settings.hash,
      legacyMigrationApproved: Boolean(patch.confirmLegacyMigration),
    };
  }

  /**
   * Runs the same plan→YAML pipeline `commitPatch` uses but stops before any filesystem
   * effect, returning the exact text each file would receive. The renderer's two-step save
   * shows this as a diff; `commitPatch` re-plans and re-guards at confirm time, so a file
   * that changes between preview and confirm still fails safely instead of overwriting.
   */
  previewPatch(config: EffectiveConfig, patch: ConfigPatch): { preview: PatchPreview; modelsText: string; settingsText: string } {
    const preview = this.planPatch(config, patch);
    // Surface the same refusals commitPatch would, so the caller can explain them in the dialog.
    if (!this.installation.supported) {
      throw new ConfigValidationError([{ severity: "error", code: "omp.version", message: this.installation.reason ?? "Unsupported Oh My Pi version" }]);
    }
    if (config.models.legacy && !preview.legacyMigrationApproved) {
      throw new ConfigValidationError([{ severity: "error", code: "models.legacy-confirmation", message: "Confirm migration before replacing legacy models.json with models.yml" }]);
    }
    const sourceErrors = [...config.models.diagnostics, ...config.settings.diagnostics].filter((item) => item.severity === "error");
    if (sourceErrors.length > 0) throw new ConfigValidationError(sourceErrors);
    const errors = preview.diagnostics.filter((item) => item.severity === "error");
    if (errors.length > 0) throw new ConfigValidationError(errors);
    return {
      preview,
      modelsText: patchModelsYaml(config.models.raw, config.models.value, preview.models),
      settingsText: patchSettingsYaml(config.settings.raw, config.settings.value, preview.settings),
    };
  }

  async createSnapshot(config: EffectiveConfig): Promise<Snapshot> {
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
    const dir = path.join(this.snapshotDir, config.profile.id, id);
    await fs.mkdir(dir, { recursive: true });
    const modelsWritePath = this.modelsWritePath(config);
    const modelsWriteExisted = modelsWritePath === config.models.path ? config.models.exists : await exists(modelsWritePath);
    const modelsHash = await sha256File(config.models.path);
    const modelsWriteHash = modelsWritePath === config.models.path ? modelsHash : await sha256File(modelsWritePath);
    const settingsHash = await sha256File(config.settings.path);
    if (config.models.exists) await fs.copyFile(config.models.path, path.join(dir, path.basename(config.models.path)));
    if (modelsWritePath !== config.models.path && modelsWriteExisted) await fs.copyFile(modelsWritePath, path.join(dir, path.basename(modelsWritePath)));
    if (config.settings.exists) await fs.copyFile(config.settings.path, path.join(dir, path.basename(config.settings.path)));
    const snapshot: Snapshot = {
      id,
      profile: config.profile.id,
      createdAt: new Date().toISOString(),
      modelsPath: config.models.path,
      settingsPath: config.settings.path,
      modelsHash,
      modelsWritePath,
      modelsWriteHash,
      settingsHash,
      modelsExisted: config.models.exists,
      modelsWriteExisted,
      settingsExisted: config.settings.exists,
    };
    await fs.writeFile(path.join(dir, "snapshot.json"), JSON.stringify(snapshot, null, 2), "utf8");
    await this.pruneSnapshots(config.profile.id).catch(() => undefined);
    return snapshot;
  }

  /**
   * Deletes the oldest snapshot directories beyond the retention limit. Ids start with an ISO
   * timestamp, so lexical order is chronological.
   */
  async pruneSnapshots(profileId: string, keep = this.snapshotRetention): Promise<string[]> {
    if (keep <= 0) return [];
    const profileDir = path.join(this.snapshotDir, profileId);
    let entries: string[];
    try {
      entries = (await fs.readdir(profileDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const removable = entries.sort().slice(0, Math.max(0, entries.length - keep));
    for (const id of removable) {
      await fs.rm(path.join(profileDir, id), { recursive: true, force: true });
    }
    return removable;
  }

  async commitPatch(config: EffectiveConfig, preview: PatchPreview): Promise<CommitResult> {
    if (!this.installation.supported) {
      throw new ConfigValidationError([{ severity: "error", code: "omp.version", message: this.installation.reason ?? "Unsupported Oh My Pi version" }]);
    }
    if (config.models.legacy && !preview.legacyMigrationApproved) {
      throw new ConfigValidationError([{ severity: "error", code: "models.legacy-confirmation", message: "Confirm migration before replacing legacy models.json with models.yml" }]);
    }
    const sourceErrors = [...config.models.diagnostics, ...config.settings.diagnostics].filter((item) => item.severity === "error");
    if (sourceErrors.length > 0) throw new ConfigValidationError(sourceErrors);
    const errors = preview.diagnostics.filter((item) => item.severity === "error");
    if (errors.length > 0) throw new ConfigValidationError(errors);
    const modelsText = patchModelsYaml(config.models.raw, config.models.value, preview.models);
    const settingsText = patchSettingsYaml(config.settings.raw, config.settings.value, preview.settings);
    const modelsPath = this.modelsWritePath(config);
    const settingsPath = config.settings.path;
    const modelsExpected = this.modelsWriteExpectation(config, modelsPath);
    const settingsExpected: FileExpectation = { exists: config.settings.exists, hash: config.settings.hash };
    await Promise.all([
      assertFileExpectation(modelsPath, modelsExpected),
      assertFileExpectation(settingsPath, settingsExpected),
    ]);
    const snapshot = await this.createSnapshot(config);
    const committedModelsHash = await writeTextAtomic(modelsPath, modelsText, modelsExpected);
    let committedSettingsHash: string;
    try {
      committedSettingsHash = await writeTextAtomic(settingsPath, settingsText, settingsExpected);
    } catch (error) {
      if (await sha256File(modelsPath) === sha256Text(modelsText)) {
        await this.restoreSnapshotFile(snapshot, modelsPath, snapshot.modelsWriteExisted).catch(() => undefined);
      }
      throw error;
    }
    // Record what this commit wrote so a later restore can tell it apart from an external edit.
    snapshot.committedModelsHash = committedModelsHash;
    snapshot.committedSettingsHash = committedSettingsHash;
    await fs.writeFile(
      path.join(this.snapshotDir, config.profile.id, snapshot.id, "snapshot.json"),
      JSON.stringify(snapshot, null, 2),
      "utf8",
    ).catch(() => undefined);
    return { snapshot, config: await this.loadProfile(config.profile) };
  }

  /**
   * Restores a snapshot. Unless `force` is set, every target file must still hash to what it did
   * when the snapshot was taken; otherwise the restore would silently discard an external edit,
   * which is exactly what `commitPatch` refuses to do.
   */
  async restoreSnapshot(snapshot: Snapshot, options: RestoreOptions = {}): Promise<void> {
    validateProfileName(snapshot.profile);
    validateSnapshotId(snapshot.id);
    const agentDir = getProfilePaths(this.homeDir, snapshot.profile, this.pathEnv).agentDir;
    const dir = path.join(this.snapshotDir, snapshot.profile, snapshot.id);
    const modelsWritePath = snapshot.modelsWritePath
      ?? (snapshot.modelsPath.endsWith(".json") ? path.join(path.dirname(snapshot.modelsPath), "models.yml") : undefined);

    if (!isPathInside(agentDir, snapshot.modelsPath)) {
      throw new Error(`Snapshot modelsPath escapes profile agent directory: ${snapshot.modelsPath}`);
    }
    if (!isPathInside(agentDir, snapshot.settingsPath)) {
      throw new Error(`Snapshot settingsPath escapes profile agent directory: ${snapshot.settingsPath}`);
    }
    if (modelsWritePath && !isPathInside(agentDir, modelsWritePath)) {
      throw new Error(`Snapshot modelsWritePath escapes profile agent directory: ${modelsWritePath}`);
    }

    if (!options.force) {
      await this.assertSnapshotStillApplies(snapshot, modelsWritePath);
    }
    await this.restoreSnapshotFile(snapshot, snapshot.modelsPath, snapshot.modelsExisted, dir);
    if (modelsWritePath && modelsWritePath !== snapshot.modelsPath) {
      await this.restoreSnapshotFile(snapshot, modelsWritePath, snapshot.modelsWriteExisted ?? false, dir);
    }
    await this.restoreSnapshotFile(snapshot, snapshot.settingsPath, snapshot.settingsExisted, dir);
  }

  async listSnapshots(profile: ProfileRef): Promise<Snapshot[]> {
    const profileDir = path.join(this.snapshotDir, profile.id);
    try {
      const entries = await fs.readdir(profileDir, { withFileTypes: true });
      const snapshots: Snapshot[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const snapshotFile = path.join(profileDir, entry.name, "snapshot.json");
        try {
          const content = await fs.readFile(snapshotFile, "utf8");
          const parsed = JSON.parse(content) as Snapshot;
          if (parsed && typeof parsed === "object" && parsed.id) {
            snapshots.push(parsed);
          }
        } catch {
          // ignore unreadable snapshot
        }
      }
      return snapshots.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    } catch {
      return [];
    }
  }

  private async assertSnapshotStillApplies(snapshot: Snapshot, modelsWritePath: string | undefined): Promise<void> {
    const expectations = new Map<string, Set<string | undefined>>();
    const accept = (filePath: string | undefined, ...hashes: Array<string | undefined>): void => {
      if (!filePath) return;
      const allowed = expectations.get(filePath) ?? new Set<string | undefined>();
      for (const hash of hashes) allowed.add(hash);
      expectations.set(filePath, allowed);
    };
    accept(snapshot.modelsPath, snapshot.modelsHash);
    accept(modelsWritePath, snapshot.modelsWriteHash, snapshot.committedModelsHash);
    accept(snapshot.settingsPath, snapshot.settingsHash, snapshot.committedSettingsHash);

    // Snapshots taken before the hash fields existed, and snapshots of a profile that had no files
    // at all, carry nothing to compare against.
    const verifiable = Array.from(expectations.values()).some((allowed) => Array.from(allowed).some((hash) => hash !== undefined));
    if (!verifiable) throw new ConfigConflictError("Snapshot carries no hash information to verify against current files");

    for (const [filePath, allowed] of expectations) {
      if (!allowed.has(await sha256File(filePath))) throw new ConfigConflictError(filePath);
    }
  }

  private modelsWritePath(config: EffectiveConfig): string {
    return config.models.legacy ? getProfilePaths(this.homeDir, config.profile.id, this.pathEnv).modelsCandidates[0] : config.models.path;
  }

  private modelsWriteExpectation(config: EffectiveConfig, modelsPath: string): FileExpectation {
    if (modelsPath === config.models.path) return { exists: config.models.exists, hash: config.models.hash };
    return { exists: false };
  }

  private async restoreSnapshotFile(snapshot: Snapshot, targetPath: string, existed: boolean | undefined, directory?: string): Promise<void> {
    const dir = directory ?? path.join(this.snapshotDir, snapshot.profile, snapshot.id);
    const backup = path.join(dir, path.basename(targetPath));
    if (await exists(backup)) {
      await writeTextAtomic(targetPath, await fs.readFile(backup, "utf8"));
      return;
    }
    if (existed === false) await fs.rm(targetPath, { force: true });
  }
}

/**
 * Credential ids referenced from a models document, read out of the `--secret-get "<id>"` argument
 * of an `!command` apiKey (or header) reference. Deleting a provider leaves its vault entry behind
 * otherwise, and deleting a credential that a config still references breaks that provider silently.
 */
export function collectReferencedCredentialIds(models: ModelsDocument): Set<string> {
  const found = new Set<string>();
  const scan = (value: unknown): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/--secret-get\s+"([A-Za-z0-9][A-Za-z0-9._-]{0,127})"/g)) found.add(match[1]);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) scan(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) scan(item);
    }
  };
  scan(models.providers ?? {});
  return found;
}

function applyOptionalField(
  target: Record<string, unknown>,
  key: "apiKey" | "headers" | "compat" | "modelOverrides" | "authHeader" | "disableStrictTools" | "transport" | "remoteCompaction" | "cost" | "codeMode",
  value: unknown | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null) {
    delete target[key];
    return;
  }
  target[key] = value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
