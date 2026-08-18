import path from "node:path";
import fs from "node:fs";
import { ProfilePaths, ProfileRef } from "./domain";

const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validateProfileName(name: string): string {
  if (name !== "default" && !PROFILE_PATTERN.test(name)) {
    throw new Error("Profile names may contain only letters, numbers, dot, underscore and dash");
  }
  return name;
}

export function getProfilePaths(homeDir: string, profileName: string): ProfilePaths {
  validateProfileName(profileName);
  const ompRoot = path.join(homeDir, ".omp");
  const agentDir = profileName === "default" ? path.join(ompRoot, "agent") : path.join(ompRoot, "profiles", profileName, "agent");
  return {
    profile: profileName,
    agentDir,
    modelsCandidates: [
      path.join(agentDir, "models.yml"),
      path.join(agentDir, "models.yaml"),
      path.join(agentDir, "models.json"),
    ],
    settingsCandidates: [path.join(agentDir, "config.yml"), path.join(agentDir, "config.yaml")],
  };
}

export function listProfileNames(entries: string[]): string[] {
  const names = new Set<string>(["default"]);
  for (const entry of entries) {
    if (!entry || entry === "default") continue;
    if (PROFILE_PATTERN.test(entry)) names.add(entry);
  }
  return ["default", ...Array.from(names).filter((name) => name !== "default").sort()];
}

export function discoverProfileNames(homeDir: string): string[] {
  const profilesDir = path.join(homeDir, ".omp", "profiles");
  let entries: string[] = [];
  try {
    entries = fs
      .readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    entries = [];
  }
  return listProfileNames(entries);
}

export function toProfileRef(homeDir: string, profileName: string): ProfileRef {
  const paths = getProfilePaths(homeDir, profileName);
  return {
    id: profileName,
    name: profileName === "default" ? "Default" : profileName,
    kind: profileName === "default" ? "default" : "named",
    agentDir: paths.agentDir,
  };
}
