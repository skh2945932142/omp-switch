import { app, BrowserWindow, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import {
  ConfigPatch,
  OmpFilesystemAdapter,
  Snapshot,
  discoverOpenAIModels,
  getProfilePaths,
} from "@omp-switch/core";
import { MetadataStore } from "./metadata-store";
import { SecretStoreService } from "./secret-store";

const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let adapter: OmpFilesystemAdapter;
let secrets: SecretStoreService;
let metadata: MetadataStore;
const currentDir = import.meta.dirname;
const configuredUserDataDir = process.env.OMP_SWITCH_DATA_DIR?.trim();
const supportedSchemaMajors = new Set([0, 1]);

if (configuredUserDataDir) app.setPath("userData", path.resolve(configuredUserDataDir));

function detectOmp(): { executable: string | null; version: string | null; supported: boolean; reason?: string } {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, ["omp"], { encoding: "utf8", windowsHide: true });
  const executable = result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : null;
  if (!executable) return { executable: null, version: null, supported: true, reason: "OMP executable was not found; file-based mode is still available" };
  const versionResult = spawnSync(executable, ["--version"], { encoding: "utf8", windowsHide: true });
  const version = (versionResult.stdout || versionResult.stderr || "").trim().split(/\r?\n/)[0] || null;
  const match = version?.match(/(?:^|\s)v?(\d+)\.(\d+)(?:\.\d+)?\b/);
  if (!match) return { executable, version, supported: false, reason: "OMP version could not be recognized; configuration is read-only" };
  if (!supportedSchemaMajors.has(Number(match[1]))) {
    return { executable, version, supported: false, reason: `OMP ${version} is outside the supported schema range; configuration is read-only` };
  }
  return { executable, version, supported: true };
}

function makeAdapter(): void {
  const installation = detectOmp();
  adapter = new OmpFilesystemAdapter({
    homeDir: os.homedir(),
    snapshotDir: path.join(app.getPath("userData"), "snapshots"),
    installation,
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#f3f6f4",
    title: "OMP Switch",
    webPreferences: {
      preload: path.join(currentDir, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) await mainWindow.loadURL(rendererUrl);
  else await mainWindow.loadFile(path.join(currentDir, "../renderer/index.html"));
}

function registerIpc(): void {
  ipcMain.handle("app:info", () => ({ version: app.getVersion(), platform: process.platform, installation: adapter.installation }));
  ipcMain.handle("omp:list-profiles", () => adapter.listProfiles());
  ipcMain.handle("omp:load-profile", (_event, profileId: string) => adapter.loadProfile(adapterProfile(profileId)));
  ipcMain.handle("omp:save", async (_event, profileId: string, patch: ConfigPatch) => {
    const profile = adapterProfile(profileId);
    const current = await adapter.loadProfile(profile);
    const preview = adapter.planPatch(current, patch);
    const result = await adapter.commitPatch(current, preview);
    await metadata.addSnapshot(result.snapshot as unknown as Record<string, unknown>);
    return result;
  });
  ipcMain.handle("omp:snapshot", async (_event, profileId: string) => {
    const profile = adapterProfile(profileId);
    const snapshot = await adapter.createSnapshot(await adapter.loadProfile(profile));
    await metadata.addSnapshot(snapshot as unknown as Record<string, unknown>);
    return snapshot;
  });
  ipcMain.handle("omp:restore", async (_event, snapshot: Snapshot) => {
    await adapter.restoreSnapshot(snapshot);
    return adapter.loadProfile(adapterProfile(snapshot.profile));
  });
  ipcMain.handle("omp:restore-latest", async (_event, profileId: string) => {
    const snapshot = metadata.getLatestSnapshot(profileId);
    if (!snapshot) throw new Error("No local snapshot exists for this profile");
    await adapter.restoreSnapshot(snapshot);
    return { snapshot, config: await adapter.loadProfile(adapterProfile(profileId)) };
  });
  ipcMain.handle("omp:discover", (_event, options: { baseUrl: string; apiKey?: string; headers?: Record<string, string>; timeoutMs?: number }) => discoverOpenAIModels(options));
  ipcMain.handle("secret:put", async (_event, input: { id?: string; label: string; value: string }) => {
    const id = input.id?.trim() || `credential-${crypto.randomUUID()}`;
    if (!isSafeCredentialId(id)) throw new Error("Credential ID contains unsupported characters");
    const command = buildSecretCommand(id);
    await secrets.put(id, input.label, input.value);
    return { id, command };
  });
  ipcMain.handle("secret:status", (_event, id: string) => secrets.status(id));
  ipcMain.handle("secret:delete", (_event, id: string) => secrets.remove(id));
  ipcMain.handle("omp:auth-status", async (_event, provider: string) => runOmpAuth(provider, "status"));
  ipcMain.handle("omp:auth-login", async (_event, provider: string) => runOmpAuth(provider, "login"));
  ipcMain.handle("app:open-folder", (_event, folder: string) => shell.openPath(folder));
}

function adapterProfile(profileId: string) {
  const paths = getProfilePaths(os.homedir(), profileId);
  return { id: profileId, name: profileId === "default" ? "Default" : profileId, kind: profileId === "default" ? "default" as const : "named" as const, agentDir: paths.agentDir };
}

async function runOmpAuth(provider: string, action: "status" | "login"): Promise<{ ok: boolean; output: string; error?: string }> {
  const executable = adapter.installation.executable;
  if (!executable) return { ok: false, output: "", error: "OMP executable was not found" };
  if (provider !== "openai-codex" && provider !== "anthropic") return { ok: false, output: "", error: "Unsupported OAuth provider" };
  try {
    if (action === "login") {
      if (process.platform === "win32") {
        const command = `"${executable.replaceAll('"', '\\"')}" auth login ${provider}`;
        const child = spawnSync("cmd.exe", ["/c", "start", "OMP Switch OAuth", "cmd.exe", "/k", command], { windowsHide: false });
        if (child.status !== 0) throw new Error("Unable to open an interactive OMP login terminal");
        return { ok: true, output: "已在单独终端启动 OMP 登录流程" };
      }
      return { ok: false, output: "", error: "Interactive OAuth launch is currently implemented for Windows" };
    }
    const result = await execFileAsync(executable, ["auth", "status", provider], { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    return { ok: true, output: `${result.stdout}${result.stderr}`.trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: "", error: message };
  }
}

function writeCliLine(stream: NodeJS.WriteStream, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(`${value}\n`, (error) => error ? reject(error) : resolve());
  });
}

function isSafeCredentialId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

async function handleSecretGet(id: string): Promise<void> {
  try {
    await writeCliLine(process.stdout, await secrets.get(id));
    app.exit(0);
  } catch (error) {
    await writeCliLine(process.stderr, error instanceof Error ? error.message : String(error));
    app.exit(1);
  }
}

function buildSecretCommand(id: string): string {
  const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`;
  const bridgePath = app.isPackaged
    ? path.join(process.resourcesPath, "secret-bridge", "omp-switch-secret.exe")
    : path.join(app.getAppPath(), "native", "secret-bridge", "publish", "omp-switch-secret.exe");
  if (!existsSync(bridgePath)) throw new Error("The OMP Switch secret bridge is unavailable");
  return `${quote(bridgePath)} --secret-get ${quote(id)} --data-dir ${quote(app.getPath("userData"))}`;
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.omp.switch");
  secrets = new SecretStoreService(app.getPath("userData"));
  metadata = new MetadataStore(app.getPath("userData"));
  await metadata.init();
  makeAdapter();
  registerIpc();
  const secretIndex = process.argv.indexOf("--secret-get");
  if (secretIndex >= 0 && process.argv[secretIndex + 1]) {
    await handleSecretGet(process.argv[secretIndex + 1]);
    return;
  }
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
