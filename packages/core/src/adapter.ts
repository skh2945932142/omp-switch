import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  CommitResult,
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
import { discoverProfileNames, getProfilePaths, toProfileRef } from "./paths";
import { assertFileExpectation, FileExpectation, loadStructuredConfig, patchModelsYaml, patchSettingsYaml, sha256File, sha256Text, writeTextAtomic } from "./yaml-config";
import { validateModelsDocument, validateSettingsDocument } from "./validation";

const emptyModels = (): ModelsDocument => ({ providers: {} });
const emptySettings = (): SettingsDocument => ({});

export interface AdapterOptions {
  homeDir: string;
  snapshotDir: string;
  installation?: OmpInstallation;
}

export interface OmpAdapter {
  detectInstallation(): Promise<OmpInstallation>;
  listProfiles(): Promise<ProfileRef[]>;
  loadProfile(profile: ProfileRef): Promise<EffectiveConfig>;
  validate(config: EffectiveConfig): Diagnostic[];
  planPatch(config: EffectiveConfig, patch: ConfigPatch): PatchPreview;
  commitPatch(config: EffectiveConfig, preview: PatchPreview): Promise<CommitResult>;
  createSnapshot(config: EffectiveConfig): Promise<Snapshot>;
}

export class OmpFilesystemAdapter implements OmpAdapter {
  readonly homeDir: string;
  readonly snapshotDir: string;
  readonly installation: OmpInstallation;

  constructor(options: AdapterOptions) {
    this.homeDir = options.homeDir;
    this.snapshotDir = options.snapshotDir;
    this.installation = options.installation ?? { executable: null, version: null, supported: true };
  }

  async detectInstallation(): Promise<OmpInstallation> {
    return this.installation;
  }

  async listProfiles(): Promise<ProfileRef[]> {
    return discoverProfileNames(this.homeDir).map((name) => toProfileRef(this.homeDir, name));
  }

  async loadProfile(profile: ProfileRef): Promise<EffectiveConfig> {
    const paths = getProfilePaths(this.homeDir, profile.id);
    const [models, settings] = await Promise.all([
      loadStructuredConfig(paths.modelsCandidates, emptyModels()),
      loadStructuredConfig(paths.settingsCandidates, emptySettings()),
    ]);
    const diagnostics = [
      ...models.diagnostics,
      ...settings.diagnostics,
      ...validateModelsDocument(models.value),
      ...validateSettingsDocument(settings.value),
    ];
    if (models.legacy) diagnostics.push({ severity: "info", code: "models.legacy", message: "Legacy models.json detected; save will create models.yml after confirmation" });
    if (!this.installation.supported) diagnostics.push({ severity: "warning", code: "omp.version", message: this.installation.reason ?? "Unknown Oh My Pi version" });
    return { profile, paths, models, settings, diagnostics };
  }

  validate(config: EffectiveConfig): Diagnostic[] {
    return [
      ...config.models.diagnostics,
      ...config.settings.diagnostics,
      ...validateModelsDocument(config.models.value),
      ...validateSettingsDocument(config.settings.value),
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
    const diagnostics = [...validateModelsDocument(models), ...validateSettingsDocument(settings)];
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
    return snapshot;
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
    await writeTextAtomic(modelsPath, modelsText, modelsExpected);
    try {
      await writeTextAtomic(settingsPath, settingsText, settingsExpected);
    } catch (error) {
      if (await sha256File(modelsPath) === sha256Text(modelsText)) {
        await this.restoreSnapshotFile(snapshot, modelsPath, snapshot.modelsWriteExisted).catch(() => undefined);
      }
      throw error;
    }
    return { snapshot, config: await this.loadProfile(config.profile) };
  }

  async restoreSnapshot(snapshot: Snapshot): Promise<void> {
    const dir = path.join(this.snapshotDir, snapshot.profile, snapshot.id);
    await this.restoreSnapshotFile(snapshot, snapshot.modelsPath, snapshot.modelsExisted, dir);
    const modelsWritePath = snapshot.modelsWritePath
      ?? (snapshot.modelsPath.endsWith(".json") ? path.join(path.dirname(snapshot.modelsPath), "models.yml") : undefined);
    if (modelsWritePath && modelsWritePath !== snapshot.modelsPath) {
      await this.restoreSnapshotFile(snapshot, modelsWritePath, snapshot.modelsWriteExisted ?? false, dir);
    }
    await this.restoreSnapshotFile(snapshot, snapshot.settingsPath, snapshot.settingsExisted, dir);
  }

  private modelsWritePath(config: EffectiveConfig): string {
    return config.models.legacy ? getProfilePaths(this.homeDir, config.profile.id).modelsCandidates[0] : config.models.path;
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

function applyOptionalField(
  target: Record<string, unknown>,
  key: "apiKey" | "headers" | "compat" | "modelOverrides",
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
