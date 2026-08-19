import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import {
  ConfigPatch,
  CatalogBundle,
  Diagnostic,
  GatewayPool,
  GatewayServer,
  OmpSurfaceAdapter,
  OmpInstallation,
  OmpFilesystemAdapter,
  PricingTable,
  ProjectContext,
  Snapshot,
  buildPricingTable,
  collectReferencedCredentialIds,
  detectOmpInstallation,
  describeOverlayPrecedence,
  discoverModels,
  findProjectOverlay,
  generateGatewayToken,
  getProfilePaths,
  indexSessionDirectory,
  summarizeUsage,
  listProviderPresets,
  mergeCatalogBundle,
  parseJsonCliArguments,
  runJsonCli,
  validateGatewayPool,
  validateCatalogBundle,
} from "@omp-switch/core";
import { MetadataStore } from "./metadata-store";
import { createSecretCommand, provisionSecretBridge } from "./secret-bridge";
import { SecretStoreService } from "./secret-store";

const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let adapter: OmpFilesystemAdapter;
let secrets: SecretStoreService;
let metadata: MetadataStore;
let surfaces: OmpSurfaceAdapter;
let gateway: GatewayServer | null = null;
let gatewayProfileId = "default";
let projectRoot = process.cwd();
let projectRootExplicit = false;
const currentDir = import.meta.dirname;
const configuredUserDataDir = process.env.OMP_SWITCH_DATA_DIR?.trim();
if (configuredUserDataDir) app.setPath("userData", path.resolve(configuredUserDataDir));

function makeAdapter(): void {
  adapter = new OmpFilesystemAdapter({
    homeDir: os.homedir(),
    snapshotDir: path.join(app.getPath("userData"), "snapshots"),
    installation: detectOmpInstallation(),
    pathEnv: process.env,
  });
}

/**
 * The gateway relays paid credentials, so it must not be reachable by any local process that simply
 * knows the port. The token is persisted like OMP persists its own: 0600 file, 0700 parent.
 */
async function loadGatewayToken(): Promise<string> {
  const tokenDir = path.join(app.getPath("userData"), "gateway");
  const tokenPath = path.join(tokenDir, "gateway.token");
  try {
    const existing = (await readFile(tokenPath, "utf8")).trim();
    if (existing) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const token = generateGatewayToken();
  await mkdir(tokenDir, { recursive: true, mode: 0o700 });
  await writeFile(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return token;
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
  mainWindow.on("closed", () => { mainWindow = null; });
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
  ipcMain.handle("omp:discover", (_event, options: { baseUrl: string; apiKey?: string; headers?: Record<string, string>; timeoutMs?: number; type?: "ollama" | "llama.cpp" | "lm-studio" | "openai-models-list" | "proxy" | "litellm" }) => discoverModels(options));
  ipcMain.handle("catalog:list", (_event, query?: string) => {
    const overrides = metadata.getPreference<import("@omp-switch/core").ProviderPreset[]>("catalog.entries") ?? [];
    const merged = mergeCatalogBundle(listProviderPresets(""), { version: 1, source: "local", entries: overrides });
    const normalized = typeof query === "string" ? query.trim().toLowerCase() : "";
    return merged.filter((entry) => !normalized || `${entry.id} ${entry.label} ${entry.category ?? ""}`.toLowerCase().includes(normalized));
  });
  ipcMain.handle("catalog:import", async (_event, input: unknown) => {
    const bundle = validateCatalogBundle(input);
    const current = metadata.getPreference<import("@omp-switch/core").ProviderPreset[]>("catalog.entries") ?? [];
    const merged = mergeCatalogBundle(current, bundle);
    await metadata.setPreference("catalog.entries", merged);
    return { version: 1, source: "local", entries: merged } satisfies CatalogBundle;
  });
  ipcMain.handle("catalog:export", () => ({ version: 1, source: "local", entries: metadata.getPreference<import("@omp-switch/core").ProviderPreset[]>("catalog.entries") ?? [] } satisfies CatalogBundle));
  ipcMain.handle("project:overlay", (_event, profileId: string = "default") => resolveProjectContext(profileId));
  ipcMain.handle("project:choose-root", async (_event, profileId: string = "default") => {
    const result = await dialog.showOpenDialog({
      title: "选择项目目录",
      properties: ["openDirectory"],
      defaultPath: projectRoot,
    });
    if (result.canceled || !result.filePaths[0]) return resolveProjectContext(profileId);
    await setProjectRoot(result.filePaths[0]);
    return resolveProjectContext(profileId);
  });

  ipcMain.handle("surface:list", (_event, profileId: string, kind: "prompt" | "skill") => surfaces.list(adapterProfile(profileId), kind));
  ipcMain.handle("surface:read", async (_event, profileId: string, kind: "prompt" | "skill", name: string) => {
    const entry = (await surfaces.list(adapterProfile(profileId), kind)).find((candidate) => candidate.name === name);
    if (!entry) throw new Error("Surface entry was not found");
    return surfaces.read(entry);
  });
  ipcMain.handle("surface:write", (_event, profileId: string, kind: "prompt" | "skill", name: string, content: string) => surfaces.write(adapterProfile(profileId), kind, name, content));
  ipcMain.handle("surface:delete", (_event, profileId: string, kind: "prompt" | "skill", name: string) => surfaces.remove(adapterProfile(profileId), kind, name));
  ipcMain.handle("surface:export", (_event, profileId: string) => surfaces.exportBundle(adapterProfile(profileId)));
  ipcMain.handle("surface:import", (_event, profileId: string, bundle) => surfaces.importBundle(adapterProfile(profileId), bundle));
  ipcMain.handle("session:index", async (_event, profileId: string) => {
    const profile = adapterProfile(profileId);
    const result = await indexSessionDirectory(path.join(profile.agentDir, "sessions"), profile.id);
    await metadata.replaceSessionIndex(profile.id, result.entries);
    return result;
  });
  ipcMain.handle("session:list", (_event, profileId: string) => metadata.listSessionIndex(profileId));
  ipcMain.handle("session:raw", async (_event, profileId: string, id: string) => {
    const entry = metadata.listSessionIndex(profileId).find((candidate) => (candidate.sourceKey ?? candidate.id) === id || candidate.id === id);
    if (!entry) throw new Error("Session event was not found");
    const source = await readFile(entry.filePath);
    return source.subarray(entry.offset, entry.offset + entry.length).toString("utf8");
  });
  ipcMain.handle("usage:summary", async (_event, profileId: string = "default", options: { from?: string; to?: string; reindex?: boolean } = {}) => {
    const profile = adapterProfile(profileId);
    let entries = metadata.listSessionIndex(profileId);
    let invalidLines = 0;
    // Index on demand: a dashboard that shows nothing until the user finds the Sessions tab and
    // presses refresh is not a dashboard.
    if (options.reindex || entries.length === 0) {
      const scanned = await indexSessionDirectory(path.join(profile.agentDir, "sessions"), profileId);
      await metadata.replaceSessionIndex(profileId, scanned.entries);
      entries = scanned.entries;
      invalidLines = scanned.invalidLines;
    }
    const config = await adapter.loadProfile(profile);
    const overrides = metadata.getPreference<PricingTable>("usage.pricing") ?? {};
    const pricing = buildPricingTable(config.models.value, overrides);
    return {
      report: summarizeUsage(entries, { pricing, from: options.from, to: options.to }),
      indexedEntries: entries.length,
      invalidLines,
      pricedModels: Object.keys(pricing).length,
      overrides,
    };
  });
  ipcMain.handle("usage:set-price", async (_event, key: string, price: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | null) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[^\s]{1,160}$/.test(key)) throw new Error("Pricing key must be provider/model");
    const overrides = { ...(metadata.getPreference<PricingTable>("usage.pricing") ?? {}) };
    if (price === null) delete overrides[key];
    else {
      for (const value of Object.values(price)) {
        if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
          throw new Error("Prices must be finite non-negative numbers per million tokens");
        }
      }
      overrides[key] = price;
    }
    await metadata.setPreference("usage.pricing", overrides);
    return overrides;
  });
  ipcMain.handle("gateway:list", (_event, profileId?: string) => metadata.listGatewayPools(profileId));
  ipcMain.handle("gateway:save", async (_event, pool: GatewayPool) => {
    validateGatewayPool(pool);
    await metadata.saveGatewayPool(pool);
    return pool;
  });
  ipcMain.handle("gateway:status", () => ({
    running: gateway?.running ?? false,
    port: gateway?.running ? (metadata.getPreference<number>("gateway.port") ?? 46831) : null,
    upstreams: gateway?.getStats() ?? [],
  }));

  ipcMain.handle("gateway:start", async (_event, profileId: string) => startGateway(profileId));
  ipcMain.handle("gateway:stop", async () => {
    await gateway?.stop();
    gateway = null;
  });
  ipcMain.handle("omp:update", (_event, profileId: string = "default") => runOmpUpdate(profileId));
  ipcMain.handle("secret:put", async (_event, input: { id?: string; label: string; value: string }) => {
    const id = input.id?.trim() || `credential-${crypto.randomUUID()}`;
    if (!isSafeCredentialId(id)) throw new Error("Credential ID contains unsupported characters");
    const command = await buildSecretCommand(id);
    await secrets.put(id, input.label, input.value);
    return { id, command };
  });
  ipcMain.handle("secret:status", (_event, id: string) => secrets.status(id));
  ipcMain.handle("secret:delete", async (_event, id: string, force?: boolean) => {
    // A credential still referenced by a config or a gateway pool would break that provider
    // silently, so report the references instead of deleting behind the user's back.
    const references = await findCredentialReferences(id);
    if (references.length > 0 && !force) return { deleted: false, references };
    await secrets.remove(id);
    return { deleted: true, references };
  });
  ipcMain.handle("secret:orphans", async (_event, profileId: string = "default") => findOrphanCredentials(profileId));

  ipcMain.handle("omp:auth-status", async (_event, provider: string) => runOmpAuth(provider, "status"));
  ipcMain.handle("omp:auth-login", async (_event, provider: string) => runOmpAuth(provider, "login"));
  ipcMain.handle("app:open-folder", (_event, folder: string) => shell.openPath(folder));
}

async function getOmpGatewayToken(): Promise<string> {
  const executable = adapter.installation.executable;
  if (!executable) throw new Error("OMP executable was not found");
  const result = await execFileAsync(executable, ["auth-gateway", "token", "--json"], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const output = `${result.stdout}${result.stderr}`.trim();
  try {
    const parsed = JSON.parse(output) as { token?: unknown };
    if (typeof parsed.token === "string" && parsed.token) return parsed.token;
  } catch {
    // Older OMP versions may return the token as plain text.
  }
  if (!output || /\s/.test(output)) throw new Error("OMP auth-gateway did not return a usable token");
  return output;
}

async function startGateway(profileId: string): Promise<{ running: boolean; port: number; token: string }> {
  const pools = metadata.listGatewayPools(profileId).filter((pool) => pool.enabled);
  if (pools.length === 0) throw new Error("No enabled gateway pools exist for this profile");
  const port = pools[0]?.port ?? metadata.getPreference<number>("gateway.port") ?? 46831;
  gatewayProfileId = profileId;
  const token = await loadGatewayToken();
  if (!gateway) {
    gateway = new GatewayServer({
      resolve: async (upstream) => {
        const currentConfig = await adapter.loadProfile(adapterProfile(gatewayProfileId));
        const provider = currentConfig.models.value.providers[upstream.providerId];
        if (upstream.kind === "omp-auth-gateway") {
          return { baseUrl: process.env.OMP_AUTH_GATEWAY_URL?.trim() || "http://127.0.0.1:4000", apiKey: await getOmpGatewayToken() };
        }
        if (!provider?.baseUrl) throw new Error(`Gateway provider ${upstream.providerId} does not have a baseUrl`);
        if (!upstream.credentialId) throw new Error(`Gateway provider ${upstream.providerId} needs an OMP Switch credential`);
        return { baseUrl: provider.baseUrl, apiKey: await secrets.get(upstream.credentialId), headers: provider.headers };
      },
    }, pools, { token });
  } else {
    gateway.setPools(pools);
  }
  const boundPort = await gateway.start(port);
  await metadata.setPreference("gateway.port", boundPort);
  return { running: true, port: boundPort, token };
}

async function runOmpUpdate(profileId = "default"): Promise<{ ok: boolean; output: string; installation: OmpInstallation; snapshot?: Snapshot }> {
  const executable = adapter.installation.executable;
  if (!executable) return { ok: false, output: "OMP executable was not found", installation: adapter.installation };
  try {
    const profile = adapterProfile(profileId);
    const snapshot = await adapter.createSnapshot(await adapter.loadProfile(profile));
    await metadata.addSnapshot(snapshot as unknown as Record<string, unknown>);
    const result = await execFileAsync(executable, ["update"], { windowsHide: true, timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 });
    makeAdapter();
    return { ok: true, output: `${result.stdout}${result.stderr}`.trim(), installation: adapter.installation, snapshot };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error), installation: adapter.installation };
  }
}

/** Where a credential id is still in use, so deleting it does not silently break a provider. */
async function findCredentialReferences(credentialId: string): Promise<string[]> {
  const references: string[] = [];
  for (const profile of await adapter.listProfiles()) {
    const config = await adapter.loadProfile(profile).catch(() => null);
    if (config && collectReferencedCredentialIds(config.models.value).has(credentialId)) {
      references.push(`profile ${profile.id} models.yml`);
    }
  }
  for (const pool of metadata.listGatewayPools()) {
    for (const upstream of pool.upstreams) {
      if (upstream.credentialId === credentialId) references.push(`gateway pool ${pool.id}/${upstream.id}`);
    }
  }
  return references;
}

/** Vault entries no config references any more, typically left behind by a removed provider. */
async function findOrphanCredentials(profileId: string): Promise<Array<{ id: string; label: string }>> {
  const config = await adapter.loadProfile(adapterProfile(profileId));
  const referenced = collectReferencedCredentialIds(config.models.value);
  for (const pool of metadata.listGatewayPools()) {
    for (const upstream of pool.upstreams) {
      if (upstream.credentialId) referenced.add(upstream.credentialId);
    }
  }
  const orphans: Array<{ id: string; label: string }> = [];
  for (const entry of await secrets.list()) {
    if (!referenced.has(entry.id)) orphans.push(entry);
  }
  return orphans;
}

function adapterProfile(profileId: string) {
  const paths = getProfilePaths(os.homedir(), profileId, process.env);
  return { id: profileId, name: profileId === "default" ? "Default" : profileId, kind: profileId === "default" ? "default" as const : "named" as const, agentDir: paths.agentDir };
}

/**
 * Project `.omp` lookups start here. A packaged GUI's `process.cwd()` is wherever the shortcut was
 * launched from, so it is only ever a guess until the user confirms a directory.
 */
async function setProjectRoot(root: string): Promise<void> {
  const resolved = path.resolve(root);
  if (!(await stat(resolved).then((entry) => entry.isDirectory()).catch(() => false))) {
    throw new Error("Project root must be an existing directory");
  }
  projectRoot = resolved;
  projectRootExplicit = true;
  await metadata.setPreference("project.root", resolved);
  surfaces = new OmpSurfaceAdapter({ projectRoot: resolved });
}

async function resolveProjectContext(profileId: string): Promise<ProjectContext> {
  const overlay = await findProjectOverlay(projectRoot, { homeDir: os.homedir() });
  let precedence: Diagnostic[] = [];
  if (overlay) {
    const config = await adapter.loadProfile(adapterProfile(profileId));
    precedence = describeOverlayPrecedence(overlay, config.settings.value);
  }
  return { root: projectRoot, explicit: projectRootExplicit, overlay, precedence };
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

async function buildSecretCommand(id: string): Promise<string> {
  const bundledBridgePath = app.isPackaged
    ? path.join(process.resourcesPath, "secret-bridge", "omp-switch-secret.exe")
    : path.join(app.getAppPath(), "native", "secret-bridge", "publish", "omp-switch-secret.exe");
  const userDataDir = app.getPath("userData");
  const bridgePath = await provisionSecretBridge(bundledBridgePath, userDataDir, app.getVersion());
  return createSecretCommand(bridgePath, id, userDataDir);
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.omp.switch");
  secrets = new SecretStoreService(app.getPath("userData"));
  metadata = new MetadataStore(app.getPath("userData"));
  await metadata.init();
  const storedRoot = metadata.getPreference<string>("project.root");
  if (storedRoot && await stat(storedRoot).then((entry) => entry.isDirectory()).catch(() => false)) {
    projectRoot = storedRoot;
    projectRootExplicit = true;
  }
  surfaces = new OmpSurfaceAdapter({ projectRoot });
  makeAdapter();
  registerIpc();
  const secretIndex = process.argv.indexOf("--secret-get");
  if (secretIndex >= 0 && process.argv[secretIndex + 1]) {
    await handleSecretGet(process.argv[secretIndex + 1]);
    return;
  }
  const jsonIndex = process.argv.indexOf("--json");
  if (jsonIndex >= 0) {
    try {
      const command = parseJsonCliArguments(process.argv.slice(jsonIndex + 1));
      const response = await runJsonCli(command, { adapter, profile: adapterProfile });
      await writeCliLine(process.stdout, JSON.stringify(response));
      app.exit(response.ok ? 0 : 1);
    } catch (error) {
      await writeCliLine(process.stderr, error instanceof Error ? error.message : String(error));
      app.exit(2);
    }
    return;
  }
  const gatewayIndex = process.argv.indexOf("--gateway");
  if (gatewayIndex >= 0) {
    const profile = process.argv[gatewayIndex + 1] || "default";
    const started = await startGateway(profile);
    // The token itself is not printed: stderr can be redirected into logs. Point at the 0600 file.
    await writeCliLine(process.stderr, `Gateway listening on 127.0.0.1:${started.port}; bearer token in ${path.join(app.getPath("userData"), "gateway", "gateway.token")}`);
    return;
  }
  await createWindow();
});

app.on("window-all-closed", () => {
  // Keep the loopback gateway alive after the GUI closes; it can be stopped from a later GUI session or process exit.
  if (gateway?.running) return;
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  // Releases the metadata sqlite handle; on Windows the file stays locked otherwise.
  metadata?.close();
});

app.on("activate", () => {
  if (!mainWindow) void createWindow();
});
