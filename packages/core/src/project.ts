import fs from "node:fs/promises";
import path from "node:path";
import type { Diagnostic, ModelsDocument, ProjectOverlay, SettingsDocument } from "./domain";
import { loadStructuredConfig } from "./yaml-config";
import { validateModelsDocument, validateSettingsDocument } from "./validation";

const emptyModels = (): ModelsDocument => ({ providers: {} });
const emptySettings = (): SettingsDocument => ({});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function directoryExists(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export interface ProjectOverlayOptions {
  /**
   * The upward walk stops *before* this directory. Without it the search escapes the project and
   * finds `~/.omp`, which is the user-level config this app already edits — reporting that as a
   * "project overlay" is wrong. OMP bounds its own ancestor walks at the repo root/home boundary.
   */
  homeDir?: string;
}

export async function findProjectOverlay(startDir: string, options: ProjectOverlayOptions = {}): Promise<ProjectOverlay | null> {
  const homeDir = options.homeDir ? path.resolve(options.homeDir) : undefined;
  let current = path.resolve(startDir);
  while (true) {
    if (homeDir && current === homeDir) return null;
    const ompDir = path.join(current, ".omp");
    if (await directoryExists(ompDir)) {
      const [models, settings] = await Promise.all([
        loadStructuredConfig([path.join(ompDir, "models.yml"), path.join(ompDir, "models.yaml")], emptyModels()),
        loadStructuredConfig([path.join(ompDir, "config.yml"), path.join(ompDir, "config.yaml")], emptySettings()),
      ]);
      const diagnostics: Diagnostic[] = [
        ...models.diagnostics,
        ...settings.diagnostics,
        ...validateModelsDocument(models.value),
        ...validateSettingsDocument(settings.value, Object.keys(models.value.providers ?? {})),
      ];
      return { root: current, models, settings, diagnostics };
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Arrays OMP swaps out wholesale between layers instead of concatenating. */
const REPLACED_ARRAY_KEYS = ["enabledModels", "disabledProviders", "modelProviderOrder"] as const;

/**
 * Diagnostics about how a project overlay interacts with the user-level config this app edits.
 * Both effects are invisible in the files themselves, so the user would otherwise see an edit that
 * appears to save correctly and then does nothing.
 */
export function describeOverlayPrecedence(overlay: ProjectOverlay, userSettings: SettingsDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const projectSettings = overlay.settings.value;

  for (const key of REPLACED_ARRAY_KEYS) {
    if (!Array.isArray(projectSettings[key])) continue;
    const userValue = userSettings[key];
    if (!Array.isArray(userValue) || userValue.length === 0) continue;
    diagnostics.push({
      severity: "warning",
      code: "overlay.array-replaced",
      path: key,
      message: `${overlay.root} defines ${key}; OMP replaces the whole array rather than merging, so the ${userValue.length} user-level entries do not apply inside this project`,
    });
  }

  if (Array.isArray(projectSettings.enabledModels) || isRecord(projectSettings.modelRoles)) {
    if (isRecord(projectSettings.modelRoles)) {
      diagnostics.push({
        severity: "info",
        code: "overlay.model-roles",
        message: `${overlay.root} sets its own modelRoles, which OMP reapplies as the authoritative project layer over anything edited here`,
      });
    }
  }

  const roleStorage = projectSettings.modelRoleStorage ?? userSettings.modelRoleStorage;
  if (roleStorage === "project") {
    diagnostics.push({
      severity: "warning",
      code: "overlay.role-storage",
      message: "modelRoleStorage is \"project\", so OMP writes role changes into the project .omp/config.yml; role edits made here target the user-level file and can be shadowed",
    });
  }

  return diagnostics;
}

export function projectOverlayPatch(config: ProjectOverlay): string {
  const models = config.models.raw || "providers: {}\n";
  const settings = config.settings.raw || "{}\n";
  return `# ${config.root}\\.omp\\models.yml\n${models}\n# ${config.root}\\.omp\\config.yml\n${settings}`;
}
