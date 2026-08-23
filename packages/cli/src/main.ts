#!/usr/bin/env node
/**
 * Headless JSON CLI. Unlike the `--json` mode of the packaged GUI, this entry point does not depend
 * on Electron at all, which is what makes it usable on Linux, in Docker, and in CI.
 *
 * It deliberately cannot reach the credential vault: those secrets are sealed with Electron
 * `safeStorage` (DPAPI on Windows) and only the GUI or the native secret bridge can open them. This
 * CLI reads and writes OMP config files, nothing else.
 */
import os from "node:os";
import path from "node:path";
import {
  OmpFilesystemAdapter,
  detectOmpInstallation,
  getProfilePaths,
  parseJsonCliArguments,
  runJsonCli,
} from "@omp-switch/core";

const USAGE = `omp-switch-cli <command> [options]

Commands:
  list                          List profiles
  get       --profile <name>    Print the effective configuration
  validate  --profile <name>    Print diagnostics
  plan      --profile <name> --patch <json>
                                Preview a ConfigPatch plan without applying
  apply     --profile <name> --patch <json>
                                Apply a ConfigPatch
  snapshot  --profile <name>    Create a snapshot of the current files
  snapshots --profile <name>    List existing snapshots

Options:
  --profile <name>              Profile to operate on (default: default)
  --patch <json>                ConfigPatch JSON, required by apply and plan
  -h, --help                    Show this help

Environment:
  OMP_SWITCH_DATA_DIR           Snapshot and metadata location
  PI_CONFIG_DIR, OMP_PROFILE, PI_PROFILE, PI_CODING_AGENT_DIR
                                Honored exactly as OMP honors them

stdout is always a single line of JSON: {"version":1,"ok":true,"data":...} or
{"version":1,"ok":false,"error":{"code":...,"message":...}}.
Exit codes: 0 success, 1 command failure, 2 usage error.

Credentials are not accessible here; use the desktop app to store an API key.`;

/** Mirrors the location the native secret bridge defaults to, so both agree per platform. */
function resolveDataDir(): string {
  const configured = process.env.OMP_SWITCH_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA?.trim() || path.join(os.homedir(), "AppData", "Roaming"), "omp-switch");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "omp-switch");
  }
  return path.join(process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share"), "omp-switch");
}

function write(stream: NodeJS.WriteStream, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(`${value}\n`, (error) => (error ? reject(error) : resolve()));
  });
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    await write(process.stderr, USAGE);
    return argv.length === 0 ? 2 : 0;
  }

  let command;
  try {
    command = parseJsonCliArguments(argv);
  } catch (error) {
    // Usage errors go to stderr so stdout stays pure JSON for every successful shape.
    await write(process.stderr, error instanceof Error ? error.message : String(error));
    return 2;
  }

  const adapter = new OmpFilesystemAdapter({
    homeDir: os.homedir(),
    snapshotDir: path.join(resolveDataDir(), "snapshots"),
    installation: detectOmpInstallation(),
    pathEnv: process.env,
  });

  const response = await runJsonCli(command, {
    adapter,
    profile: (id) => {
      const paths = getProfilePaths(os.homedir(), id, process.env);
      return {
        id,
        name: id === "default" ? "Default" : id,
        kind: id === "default" ? "default" : "named",
        agentDir: paths.agentDir,
      };
    },
  });

  await write(process.stdout, JSON.stringify(response));
  return response.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  async (error) => {
    await write(process.stderr, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    process.exit(2);
  },
);
