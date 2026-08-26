import path from "node:path";
import fs from "node:fs";
import { OmpPathOverride, OmpPathResolution, ProfilePaths, ProfileRef } from "./domain";

const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const DEFAULT_PROFILE = "default";

/** The subset of the environment that moves OMP's config paths (docs/config-usage.md). */
export interface OmpPathEnv {
  PI_CONFIG_DIR?: string;
  PI_CODING_AGENT_DIR?: string;
  OMP_PROFILE?: string;
  PI_PROFILE?: string;
  OMP_MODELS_PATH?: string;
}

export function validateProfileName(name: string): string {
  if (name !== DEFAULT_PROFILE && !PROFILE_PATTERN.test(name)) {
    throw new Error("Profile names may contain only letters, numbers, dot, underscore and dash");
  }
  return name;
}

/** `default`, empty and whitespace all select the default profile. */
function normalizeProfileName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === DEFAULT_PROFILE ? DEFAULT_PROFILE : trimmed;
}

/**
 * Resolves the OMP root and active profile the way OMP itself does.
 *
 * - `PI_CONFIG_DIR` relocates the OMP root. OMP documents it both as `~/<PI_CONFIG_DIR>` and as a
 *   relocation of `<config-dir>`, so an absolute value is honored as-is and a relative one is
 *   resolved under the home directory. Both readings agree for the common case.
 * - `OMP_PROFILE` wins over `PI_PROFILE` whenever it is defined, *including when it is empty*.
 */
export function resolveOmpPaths(homeDir: string, env: OmpPathEnv = {}): OmpPathResolution {
  const overrides: OmpPathOverride[] = [];

  const configDir = env.PI_CONFIG_DIR?.trim();
  let ompRoot = path.join(homeDir, ".omp");
  if (configDir) {
    ompRoot = path.isAbsolute(configDir) ? path.resolve(configDir) : path.resolve(homeDir, configDir);
    overrides.push({ variable: "PI_CONFIG_DIR", value: configDir, effect: `OMP root moved to ${ompRoot}` });
  }

  let activeProfile = DEFAULT_PROFILE;
  const fromOmpProfile = normalizeProfileName(env.OMP_PROFILE);
  const fromPiProfile = normalizeProfileName(env.PI_PROFILE);
  if (fromOmpProfile !== undefined) {
    activeProfile = fromOmpProfile;
    overrides.push({ variable: "OMP_PROFILE", value: env.OMP_PROFILE ?? "", effect: `Active profile is ${activeProfile}` });
  } else if (fromPiProfile !== undefined) {
    activeProfile = fromPiProfile;
    overrides.push({ variable: "PI_PROFILE", value: env.PI_PROFILE ?? "", effect: `Active profile is ${activeProfile}` });
  }

  // PI_CODING_AGENT_DIR only moves the agent dir of the default profile; named profiles ignore it.
  const agentDirOverride = env.PI_CODING_AGENT_DIR?.trim();
  if (agentDirOverride && activeProfile === DEFAULT_PROFILE) {
    overrides.push({
      variable: "PI_CODING_AGENT_DIR",
      value: agentDirOverride,
      effect: `Default-profile agent dir moved to ${path.resolve(agentDirOverride)}`,
    });
  }

  const modelsPathOverride = env.OMP_MODELS_PATH?.trim();
  if (modelsPathOverride) {
    overrides.push({
      variable: "OMP_MODELS_PATH",
      value: modelsPathOverride,
      effect: `Models file moved to ${path.resolve(modelsPathOverride)}`,
    });
  }

  return { ompRoot, activeProfile, overrides };
}

export function getProfilePaths(homeDir: string, profileName: string, env: OmpPathEnv = {}): ProfilePaths {
  validateProfileName(profileName);
  const { ompRoot } = resolveOmpPaths(homeDir, env);
  const agentDirOverride = env.PI_CODING_AGENT_DIR?.trim();
  const agentDir = profileName === DEFAULT_PROFILE
    ? (agentDirOverride ? path.resolve(agentDirOverride) : path.join(ompRoot, "agent"))
    : path.join(ompRoot, "profiles", profileName, "agent");
  const modelsPathOverride = env.OMP_MODELS_PATH?.trim();
  const explicitModels = modelsPathOverride ? path.resolve(modelsPathOverride) : null;
  return {
    profile: profileName,
    agentDir,
    modelsCandidates: explicitModels
      ? [explicitModels]
      : [
          path.join(agentDir, "models.yml"),
          path.join(agentDir, "models.yaml"),
          path.join(agentDir, "models.json"),
        ],
    settingsCandidates: [path.join(agentDir, "config.yml"), path.join(agentDir, "config.yaml")],
  };
}

export function listProfileNames(entries: string[], activeProfile = DEFAULT_PROFILE): string[] {
  const names = new Set<string>([DEFAULT_PROFILE]);
  for (const entry of [...entries, activeProfile]) {
    if (!entry || entry === DEFAULT_PROFILE) continue;
    if (PROFILE_PATTERN.test(entry)) names.add(entry);
  }
  return [DEFAULT_PROFILE, ...Array.from(names).filter((name) => name !== DEFAULT_PROFILE).sort()];
}

export function discoverProfileNames(homeDir: string, env: OmpPathEnv = {}): string[] {
  const { ompRoot, activeProfile } = resolveOmpPaths(homeDir, env);
  const profilesDir = path.join(ompRoot, "profiles");
  let entries: string[] = [];
  try {
    entries = fs
      .readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    entries = [];
  }
  // An OMP_PROFILE that has never been written yet still has to be listed, or the app would
  // silently edit the default profile while OMP reads the named one.
  return listProfileNames(entries, activeProfile);
}

export function toProfileRef(homeDir: string, profileName: string, env: OmpPathEnv = {}): ProfileRef {
  const paths = getProfilePaths(homeDir, profileName, env);
  return {
    id: profileName,
    name: profileName === DEFAULT_PROFILE ? "Default" : profileName,
    kind: profileName === DEFAULT_PROFILE ? "default" : "named",
    agentDir: paths.agentDir,
  };
}
