import { spawnSync } from "node:child_process";
import type { OmpInstallation, OmpSchemaStatus } from "./domain";

export const WRITABLE_OMP_SCHEMA_MAJORS = new Set([16, 17, 18]);

export function parseOmpVersion(value: string | null | undefined): { version: string | null; major?: number; minor?: number; patch?: number } {
  const version = value?.trim() || null;
  if (!version) return { version: null };
  // `omp --version` prints `omp/17.3.7`, so the version is not necessarily at the start of the line
  // or preceded by whitespace. Accept any non-alphanumeric, non-dot boundary before it; requiring
  // whitespace made the real OMP output unparseable and silently forced the app read-only.
  const match = version.match(/(?:^|[^0-9A-Za-z.])v?(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return { version };
  return { version, major: Number(match[1]), minor: Number(match[2]), patch: match[3] ? Number(match[3]) : undefined };
}

export function classifyOmpInstallation(input: { executable: string | null; version: string | null }): OmpInstallation {
  if (!input.executable) {
    return { ...input, supported: true, schemaStatus: "unknown", reason: "OMP executable was not found; file-based mode is still available" };
  }
  const parsed = parseOmpVersion(input.version);
  if (parsed.major === undefined) {
    return { ...input, supported: false, schemaStatus: "unknown", reason: "OMP version could not be recognized; configuration is read-only" };
  }
  const supported = WRITABLE_OMP_SCHEMA_MAJORS.has(parsed.major);
  const schemaStatus: OmpSchemaStatus = supported ? "supported" : "readonly";
  return {
    ...input,
    schemaMajor: parsed.major,
    supported,
    schemaStatus,
    ...(supported ? {} : { reason: `OMP ${input.version} is outside the supported schema range; configuration is read-only` }),
  };
}

/**
 * Locates the `omp` executable and reads its version. Lives in core rather than the main process so
 * the Electron app and the headless CLI gate writes on exactly the same rule.
 */
export function detectOmpInstallation(): OmpInstallation {
  const locate = process.platform === "win32" ? "where" : "which";
  const found = spawnSync(locate, ["omp"], { encoding: "utf8", windowsHide: true });
  const executable = found.status === 0 ? found.stdout.trim().split(/\r?\n/)[0] : null;
  if (!executable) return classifyOmpInstallation({ executable: null, version: null });
  const probe = spawnSync(executable, ["--version"], { encoding: "utf8", windowsHide: true });
  const version = (probe.stdout || probe.stderr || "").trim().split(/\r?\n/)[0] || null;
  return classifyOmpInstallation({ executable, version });
}
