import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArchiveRestore,
  Check,
  ChevronDown,
  CircleAlert,
  CloudDownload,
  FileCheck2,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  ConfigPatch,
  DiscoveryResult,
  EffectiveConfig,
  OmpModel,
  OmpProvider,
  ProfileRef,
  Snapshot,
} from "@omp-switch/core";

const ROLES = ["default", "smol", "slow", "vision", "plan", "designer", "commit", "tiny", "task", "advisor"];
const PRESETS = [
  { label: "Custom OpenAI-compatible", id: "", baseUrl: "https://api.example.com/v1", api: "openai-completions" },
  { label: "OpenAI", id: "openai", baseUrl: "https://api.openai.com/v1", api: "openai-responses" },
  { label: "OpenAI Codex", id: "openai", baseUrl: "https://api.openai.com/v1", api: "openai-codex-responses" },
  { label: "Anthropic", id: "anthropic", baseUrl: "https://api.anthropic.com", api: "anthropic-messages" },
  { label: "OpenRouter", id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", api: "openai-completions" },
  { label: "DeepSeek", id: "deepseek", baseUrl: "https://api.deepseek.com/v1", api: "openai-completions" },
  { label: "Groq", id: "groq", baseUrl: "https://api.groq.com/openai/v1", api: "openai-completions" },
  { label: "Together", id: "together", baseUrl: "https://api.together.xyz/v1", api: "openai-completions" },
  { label: "Fireworks", id: "fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", api: "openai-completions" },
  { label: "Ollama local", id: "ollama", baseUrl: "http://127.0.0.1:11434/v1", api: "openai-responses" },
  { label: "LM Studio local", id: "lm-studio", baseUrl: "http://127.0.0.1:1234/v1", api: "openai-completions" },
];

interface ModelEditorEntry {
  raw: OmpModel;
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
  vision: boolean;
}

function toModelEditorEntry(model: OmpModel): ModelEditorEntry {
  return {
    raw: model,
    id: model.id ?? "",
    name: model.name ?? "",
    contextWindow: model.contextWindow?.toString() ?? "",
    maxTokens: model.maxTokens?.toString() ?? "",
    reasoning: Boolean(model.reasoning),
    vision: Boolean(model.input?.includes("image")),
  };
}

function createModelEditorEntry(): ModelEditorEntry {
  return {
    raw: { id: "" },
    id: "",
    name: "",
    contextWindow: "128000",
    maxTokens: "16384",
    reasoning: false,
    vision: false,
  };
}

function parseOptionalPositiveInteger(label: string, value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} 必须是正整数`);
  return parsed;
}

function buildModels(entries: ModelEditorEntry[]): OmpModel[] {
  return entries.map((entry, index) => {
    const id = entry.id.trim();
    if (!id) throw new Error(`模型 ${index + 1} 的 ID 不能为空`);
    const model: OmpModel = { ...entry.raw, id };
    const name = entry.name.trim();
    if (name) model.name = name;
    else delete model.name;
    const contextWindow = parseOptionalPositiveInteger(`模型 ${id} 的 Context`, entry.contextWindow);
    if (contextWindow === undefined) delete model.contextWindow;
    else model.contextWindow = contextWindow;
    const maxTokens = parseOptionalPositiveInteger(`模型 ${id} 的 Max output`, entry.maxTokens);
    if (maxTokens === undefined) delete model.maxTokens;
    else model.maxTokens = maxTokens;
    if (entry.reasoning) model.reasoning = true;
    else delete model.reasoning;
    const input = new Set(Array.isArray(model.input) ? model.input : []);
    input.add("text");
    if (entry.vision) input.add("image");
    else input.delete("image");
    model.input = Array.from(input);
    return model;
  });
}

function createMockApi(): NonNullable<Window["ompSwitch"]> {
  const memory: Record<string, EffectiveConfig> = {};
  const makeConfig = (profileId: string): EffectiveConfig => ({
    profile: { id: profileId, name: profileId === "default" ? "Default" : profileId, kind: profileId === "default" ? "default" : "named", agentDir: `~/.omp/${profileId === "default" ? "agent" : `profiles/${profileId}/agent`}` },
    paths: {
      profile: profileId,
      agentDir: `~/.omp/${profileId === "default" ? "agent" : `profiles/${profileId}/agent`}`,
      modelsCandidates: [],
      settingsCandidates: [],
    },
    models: { value: { providers: { openrouter: { baseUrl: "https://openrouter.ai/api/v1", api: "openai-completions", auth: "apiKey", apiKey: "OPENROUTER_API_KEY", models: [{ id: "openai/gpt-4.1", name: "GPT-4.1", reasoning: true, contextWindow: 128000, maxTokens: 16384 }] } } }, raw: "", path: "~/.omp/agent/models.yml", hash: "demo", exists: true, legacy: false, diagnostics: [] },
    settings: { value: { modelRoles: { default: "openrouter/openai/gpt-4.1", slow: "@default" } }, raw: "", path: "~/.omp/agent/config.yml", hash: "demo-settings", exists: true, legacy: false, diagnostics: [] },
    diagnostics: [{ severity: "info", code: "demo", message: "浏览器预览模式：当前数据为示例配置" }],
  });
  const get = (id: string) => (memory[id] ??= makeConfig(id));
  return {
    getInfo: async () => ({ version: "0.1.0-demo", platform: "browser", installation: { executable: "omp", version: "demo", supported: true } }),
    listProfiles: async () => [get("default").profile, { id: "work", name: "work", kind: "named", agentDir: "~/.omp/profiles/work/agent" }],
    loadProfile: async (id: string) => get(id),
    save: async (id: string, patch: ConfigPatch) => {
      const config = get(id);
      if (patch.provider) {
        const existing = config.models.value.providers[patch.provider.id] ?? {};
        const next: OmpProvider = { ...existing, baseUrl: patch.provider.baseUrl, api: patch.provider.api, auth: patch.provider.auth, models: patch.provider.models };
        if (patch.provider.apiKey === null) delete next.apiKey;
        else if (patch.provider.apiKey !== undefined) next.apiKey = patch.provider.apiKey;
        if (patch.provider.headers === null) delete next.headers;
        else if (patch.provider.headers !== undefined) next.headers = patch.provider.headers;
        if (patch.provider.compat === null) delete next.compat;
        else if (patch.provider.compat !== undefined) next.compat = patch.provider.compat;
        if (patch.provider.modelOverrides === null) delete next.modelOverrides;
        else if (patch.provider.modelOverrides !== undefined) next.modelOverrides = patch.provider.modelOverrides;
        config.models.value.providers[patch.provider.id] = next;
      }
      if (patch.roleAssignments) {
        const nextRoles: Record<string, string> = { ...(config.settings.value.modelRoles ?? {}) };
        for (const [role, selector] of Object.entries(patch.roleAssignments)) {
          if (selector === null || selector === "") delete nextRoles[role];
          else nextRoles[role] = selector;
        }
        config.settings.value.modelRoles = nextRoles;
      }
      return { snapshot: { id: "demo-snapshot", profile: id, createdAt: new Date().toISOString(), modelsPath: config.models.path, settingsPath: config.settings.path }, config };
    },
    snapshot: async (id: string) => ({ id: "demo-snapshot", profile: id, createdAt: new Date().toISOString(), modelsPath: get(id).models.path, settingsPath: get(id).settings.path }),
    restore: async (snapshot: Snapshot) => get(snapshot.profile),
    restoreLatest: async (profileId: string) => ({ snapshot: { id: "demo-snapshot", profile: profileId, createdAt: new Date().toISOString(), modelsPath: get(profileId).models.path, settingsPath: get(profileId).settings.path }, config: get(profileId) }),
    discover: async (): Promise<DiscoveryResult> => ({ endpoint: "https://example.test/v1/models", durationMs: 184, models: [{ id: "demo-fast", name: "Demo Fast" }, { id: "demo-reasoning", name: "Demo Reasoning" }] }),
    secretPut: async (input) => ({ id: input.id ?? "demo-credential", command: "omp-switch --secret-get demo-credential" }),
    secretStatus: async () => ({ exists: true, label: "Demo credential", masked: "••••••••" }),
    secretDelete: async () => undefined,
    authStatus: async () => ({ ok: true, output: "No active browser session in demo mode" }),
    authLogin: async () => ({ ok: false, output: "", error: "Run the packaged app to invoke omp auth login" }),
    openFolder: async () => "",
  };
}

const api = window.ompSwitch ?? createMockApi();

function providerModels(provider?: OmpProvider): OmpModel[] {
  return Array.isArray(provider?.models) ? provider.models : [];
}

function formatDate(value?: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatJson(value: unknown): string {
  return value && typeof value === "object" ? JSON.stringify(value, null, 2) : "";
}

function parseObjectJson(label: string, value: string): Record<string, unknown> | null {
  if (!value.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} 必须是有效 JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} 必须是 JSON 对象`);
  return parsed as Record<string, unknown>;
}

function parseHeaders(value: string): Record<string, string> | null {
  const parsed = parseObjectJson("Headers", value);
  if (!parsed) return null;
  if (Object.values(parsed).some((header) => typeof header !== "string")) throw new Error("Headers 的值必须是字符串");
  return parsed as Record<string, string>;
}

function parseModelOverrides(value: string): Record<string, Record<string, unknown>> | null {
  const parsed = parseObjectJson("Model overrides", value);
  if (!parsed) return null;
  if (Object.values(parsed).some((override) => !override || typeof override !== "object" || Array.isArray(override))) {
    throw new Error("Model overrides 的值必须是 JSON 对象");
  }
  return parsed as Record<string, Record<string, unknown>>;
}

export default function App() {
  const [profiles, setProfiles] = useState<ProfileRef[]>([]);
  const [profileId, setProfileId] = useState("default");
  const [config, setConfig] = useState<EffectiveConfig | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [modelEntries, setModelEntries] = useState<ModelEditorEntry[]>([]);
  const [form, setForm] = useState({ id: "", baseUrl: "https://api.example.com/v1", api: "openai-completions", auth: "apiKey", key: "", headers: "", compat: "", overrides: "" });
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [authResult, setAuthResult] = useState<string>("");

  const providers = config ? Object.entries(config.models.value.providers) : [];
  const selectedProvider = selectedProviderId ? config?.models.value.providers[selectedProviderId] : undefined;
  const selectedModels = useMemo(() => providerModels(selectedProvider), [selectedProvider]);
  const errorDiagnostics = config?.diagnostics.filter((item) => item.severity === "error") ?? [];
  const readOnly = Boolean(readOnlyReason);

  async function load(id: string): Promise<void> {
    setBusy(true);
    try {
      const next = await api.loadProfile(id);
      setConfig(next);
      setRoles(next.settings.value.modelRoles ?? {});
      const first = Object.keys(next.models.value.providers)[0] ?? null;
      setSelectedProviderId((current) => (current && next.models.value.providers[current] ? current : first));
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void api.getInfo().then((info) => setReadOnlyReason(info.installation.supported ? null : info.installation.reason ?? "当前 OMP 版本不受支持")).catch(() => undefined);
    void api.listProfiles().then((items) => {
      setProfiles(items);
      void load(items[0]?.id ?? "default");
    });
  }, []);

  function beginAdd(): void {
    setForm({ id: "", baseUrl: "https://api.example.com/v1", api: "openai-completions", auth: "apiKey", key: "", headers: "", compat: "", overrides: "" });
    setModelEntries([]);
    setEditingProviderId(null);
    setFormOpen(true);
  }

  function editProvider(id: string): void {
    const provider = config?.models.value.providers[id];
    setSelectedProviderId(id);
    setEditingProviderId(id);
    setForm({
      id,
      baseUrl: provider?.baseUrl ?? "",
      api: provider?.api ?? "openai-completions",
      auth: provider?.auth ?? (provider?.apiKey ? "apiKey" : "none"),
      key: "",
      headers: formatJson(provider?.headers),
      compat: formatJson(provider?.compat),
      overrides: formatJson(provider?.modelOverrides),
    });
    setModelEntries(providerModels(provider).map(toModelEditorEntry));
    setFormOpen(true);
  }

  async function saveProvider(): Promise<void> {
    if (readOnly) {
      setNotice({ tone: "error", text: readOnlyReason ?? "当前配置为只读" });
      return;
    }
    if (!config || !form.id.trim() || !form.baseUrl.trim()) {
      setNotice({ tone: "error", text: "Provider ID 和 Endpoint URL 都不能为空" });
      return;
    }
    if (config.models.legacy && !window.confirm("检测到旧 models.json。继续将写入 models.yml；旧文件会保留在写入前快照中。")) return;
    setBusy(true);
    try {
      const id = form.id.trim();
      const existing = config.models.value.providers[id];
      const headers = parseHeaders(form.headers);
      const compat = parseObjectJson("Compat", form.compat);
      const modelOverrides = parseModelOverrides(form.overrides);
      let apiKeyValue: string | null | undefined = form.auth === "none" ? null : existing?.apiKey;
      let auth = form.auth;
      if (form.key.trim()) {
        const credential = await api.secretPut({ label: `${id} API key`, value: form.key.trim() });
        apiKeyValue = `!${credential.command}`;
        auth = "apiKey";
      }
      const models = buildModels(modelEntries).map((model) => ({ ...model, api: model.api ?? form.api }));
      const result = await api.save(profileId, {
        provider: { id, baseUrl: form.baseUrl.trim(), api: form.api, auth, apiKey: apiKeyValue, headers, compat, modelOverrides, models },
        confirmLegacyMigration: config.models.legacy,
      });
      setConfig(result.config);
      setSnapshot(result.snapshot);
      setSelectedProviderId(id);
      setFormOpen(false);
      setNotice({ tone: "success", text: `已保存 ${id}，快照 ${formatDate(result.snapshot.createdAt)}` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function removeProvider(): Promise<void> {
    if (!config || !selectedProviderId) return;
    if (readOnly) {
      setNotice({ tone: "error", text: readOnlyReason ?? "当前配置为只读" });
      return;
    }
    if (config.models.legacy && !window.confirm("检测到旧 models.json。继续将写入 models.yml；旧文件会保留在写入前快照中。")) return;
    setBusy(true);
    try {
      const result = await api.save(profileId, { removeProviderId: selectedProviderId, confirmLegacyMigration: config.models.legacy });
      setConfig(result.config);
      setSelectedProviderId(Object.keys(result.config.models.value.providers)[0] ?? null);
      setNotice({ tone: "success", text: "供应商已移除，原配置已创建快照" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function fetchModels(): Promise<void> {
    if (!form.baseUrl.trim()) return;
    setBusy(true);
    try {
      const result = await api.discover({ baseUrl: form.baseUrl.trim(), apiKey: form.key.trim() || undefined, headers: parseHeaders(form.headers) ?? undefined });
      setModelEntries(result.models.map((model) => toModelEditorEntry({
        id: model.id,
        name: model.name,
        api: form.api,
        reasoning: /reason|think|o[1-9]/i.test(model.id),
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16384,
      })));
      setNotice({ tone: "success", text: `发现 ${result.models.length} 个模型，耗时 ${result.durationMs}ms` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function saveRoles(): Promise<void> {
    if (readOnly) {
      setNotice({ tone: "error", text: readOnlyReason ?? "当前配置为只读" });
      return;
    }
    if (config?.models.legacy && !window.confirm("检测到旧 models.json。继续将写入 models.yml；旧文件会保留在写入前快照中。")) return;
    setBusy(true);
    try {
      const result = await api.save(profileId, { roleAssignments: roles, confirmLegacyMigration: config?.models.legacy });
      setConfig(result.config);
      setSnapshot(result.snapshot);
      setNotice({ tone: "success", text: "角色映射已写入 config.yml" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function createSnapshot(): Promise<void> {
    setBusy(true);
    try {
      const next = await api.snapshot(profileId);
      setSnapshot(next);
      setNotice({ tone: "success", text: `已创建本机快照 ${formatDate(next.createdAt)}` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function restoreLatest(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.restoreLatest(profileId);
      setConfig(result.config);
      setSnapshot(result.snapshot);
      setRoles(result.config.settings.value.modelRoles ?? {});
      setSelectedProviderId(Object.keys(result.config.models.value.providers)[0] ?? null);
      setNotice({ tone: "success", text: "已恢复最近快照" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function checkAuth(provider: "openai-codex" | "anthropic", action: "status" | "login"): Promise<void> {
    setBusy(true);
    try {
      const result = action === "status" ? await api.authStatus(provider) : await api.authLogin(provider);
      setAuthResult(result.ok ? `${provider}: ${result.output || "已完成"}` : `${provider}: ${result.error ?? "命令失败"}`);
    } catch (error) {
      setAuthResult(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function choosePreset(label: string): void {
    const preset = PRESETS.find((item) => item.label === label);
    if (!preset) return;
    setForm((current) => ({ ...current, id: preset.id, baseUrl: preset.baseUrl, api: preset.api }));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Sparkles size={16} /></div>
          <div>
            <div className="brand-name">OMP Switch</div>
            <div className="brand-caption">model control surface</div>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="environment-chip"><ShieldCheck size={14} /> file-authoritative</span>
          <button className="icon-button" title="刷新当前配置" onClick={() => void load(profileId)} disabled={busy}><RefreshCw size={17} className={busy ? "spin" : ""} /></button>
          <button className="icon-button" title="创建快照" onClick={() => void createSnapshot()} disabled={busy}><ArchiveRestore size={17} /></button>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="section-kicker">WORKSPACE</div>
          <div className="profile-select-wrap">
            <select value={profileId} onChange={(event) => { setProfileId(event.target.value); void load(event.target.value); }} aria-label="选择 Profile">
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </div>
          <div className="path-note" title={config?.profile.agentDir}>{config?.profile.agentDir ?? "正在读取 Profile…"}</div>

          <div className="sidebar-divider" />
          <div className="section-heading-row"><div className="section-kicker">PROVIDERS</div><span className="count-badge">{providers.length}</span></div>
          <div className="provider-list">
            {providers.map(([id, provider]) => {
              const active = id === selectedProviderId;
              return <button key={id} className={`provider-row ${active ? "active" : ""}`} onClick={() => { setSelectedProviderId(id); setFormOpen(false); }}>
                <span className="provider-dot" />
                <span className="provider-row-copy"><strong>{id}</strong><small>{provider.api ?? "custom"} · {providerModels(provider).length} models</small></span>
                {active ? <Check size={15} /> : null}
              </button>;
            })}
            {providers.length === 0 ? <div className="empty-sidebar">还没有供应商配置。</div> : null}
          </div>
          <button className="add-provider-button" onClick={beginAdd} disabled={readOnly}><Plus size={16} />添加供应商</button>

          <div className="sidebar-footer">
            <div className="footer-status"><span className="status-led" /> OMP adapter ready</div>
            <div className="footer-status muted"><Activity size={14} /> {config?.models.exists ? "models.yml detected" : "models.yml will be created"}</div>
          </div>
        </aside>

        <section className="content-area">
          <div className="content-heading">
            <div>
              <div className="eyebrow">ACTIVE PROFILE / {profileId.toUpperCase()}</div>
              <h1>Provider control</h1>
              <p>供应商、模型和角色映射都从当前 Profile 的文件层读取。</p>
            </div>
            <div className="heading-meta">
              <span className="file-pill"><FileCheck2 size={14} /> models.yml</span>
              <span className="file-pill"><FileCheck2 size={14} /> config.yml</span>
            </div>
          </div>

          {notice ? <div className={`notice ${notice.tone}`}><span>{notice.tone === "success" ? <Check size={16} /> : <CircleAlert size={16} />}</span><span>{notice.text}</span><button className="notice-close" title="关闭提示" onClick={() => setNotice(null)}><X size={15} /></button></div> : null}

          {readOnlyReason ? <div className="diagnostics-banner"><CircleAlert size={18} /><div><strong>当前配置为只读</strong><span>{readOnlyReason}</span></div></div> : null}

          {errorDiagnostics.length > 0 ? <div className="diagnostics-banner"><CircleAlert size={18} /><div><strong>配置需要处理</strong><span>{errorDiagnostics[0].message}</span></div><button className="text-button" onClick={() => setNotice({ tone: "error", text: errorDiagnostics.map((item) => item.message).join(" · ") })}>查看诊断</button></div> : null}

          <div className="primary-grid">
            <section className="panel provider-panel">
              <div className="panel-heading">
                <div><div className="section-kicker">PROVIDER / MODEL CATALOG</div><h2>{selectedProviderId ?? "选择一个供应商"}</h2></div>
                <div className="panel-actions">
                  {selectedProviderId ? <button className="icon-button subtle" title="编辑供应商" onClick={() => editProvider(selectedProviderId)}><Sparkles size={16} /></button> : null}
                  {selectedProviderId ? <button className="icon-button subtle danger" title="移除供应商" onClick={() => void removeProvider()} disabled={busy || readOnly}><Trash2 size={16} /></button> : null}
                </div>
              </div>
              {selectedProvider ? <>
                <div className="provider-summary">
                  <div><span className="label">API</span><strong>{selectedProvider.api ?? "custom"}</strong></div>
                  <div><span className="label">ENDPOINT</span><strong className="mono">{selectedProvider.baseUrl ?? "—"}</strong></div>
                  <div><span className="label">AUTH</span><strong><KeyRound size={14} /> {selectedProvider.auth ?? "apiKey"}</strong></div>
                </div>
                <div className="model-table-wrap">
                  <table className="model-table"><thead><tr><th>MODEL</th><th>API</th><th>CONTEXT</th><th>CAPABILITIES</th></tr></thead><tbody>
                    {selectedModels.map((model) => <tr key={model.id}><td><strong>{model.name ?? model.id}</strong><small>{model.id}</small></td><td>{model.api ?? selectedProvider.api ?? "—"}</td><td>{typeof model.contextWindow === "number" ? model.contextWindow.toLocaleString() : "—"}</td><td><span className={`capability ${model.reasoning ? "on" : ""}`}>{model.reasoning ? "reasoning" : "standard"}</span><span className="capability">{model.input?.includes("image") ? "vision" : "text"}</span></td></tr>)}
                    {selectedModels.length === 0 ? <tr><td colSpan={4} className="empty-table">该供应商还没有模型。编辑配置或从 endpoint 发现模型。</td></tr> : null}
                  </tbody></table>
                </div>
              </> : <div className="empty-state"><div className="empty-icon"><CloudDownload size={22} /></div><h3>从一个供应商开始</h3><p>添加 OpenAI-compatible endpoint，或者导入已有的 OMP 配置。</p><button className="primary-button" onClick={beginAdd} disabled={readOnly}><Plus size={16} /> 添加供应商</button></div>}
            </section>

            <section className="panel roles-panel">
              <div className="panel-heading"><div><div className="section-kicker">MODEL ROLES</div><h2>Runtime assignments</h2></div><span className="role-count">{Object.keys(roles).length}/10</span></div>
              <div className="role-list">{ROLES.map((role) => <label className="role-row" key={role}><span><strong>{role}</strong><small>{role === "default" ? "主模型" : role === "smol" ? "快速模型" : role === "slow" ? "深度思考" : "运行时角色"}</small></span><input value={roles[role] ?? ""} placeholder={role === "default" ? "provider/model" : "@default"} onChange={(event) => setRoles((current) => ({ ...current, [role]: event.target.value }))} /></label>)}</div>
              <button className="secondary-button full-width" onClick={() => void saveRoles()} disabled={busy || readOnly}><Save size={16} /> 保存角色映射</button>
              <div className="role-footnote">写入当前 Profile 的 <span className="mono">config.yml</span>，不会修改项目级覆盖。</div>
            </section>
          </div>

          <section className="lower-grid">
            <div className="panel diagnostics-panel"><div className="panel-heading"><div><div className="section-kicker">DIAGNOSTICS</div><h2>Config health</h2></div><span className={`health-badge ${errorDiagnostics.length ? "warning" : "ok"}`}>{errorDiagnostics.length ? "attention" : "healthy"}</span></div><div className="diagnostic-list">{(config?.diagnostics ?? []).slice(0, 5).map((item, index) => <div className="diagnostic-row" key={`${item.code}-${index}`}><span className={`diag-icon ${item.severity}`}><CircleAlert size={14} /></span><span><strong>{item.code}</strong><small>{item.message}</small></span></div>)}{(config?.diagnostics ?? []).length === 0 ? <div className="empty-inline">未发现诊断信息。</div> : null}</div></div>
            <div className="panel activity-panel"><div className="panel-heading"><div><div className="section-kicker">LOCAL SAFETY</div><h2>Snapshots & auth</h2></div><ArchiveRestore size={18} /></div><div className="snapshot-line"><div className="snapshot-icon"><ArchiveRestore size={18} /></div><div><strong>{snapshot ? "最新快照已创建" : "写入前自动创建快照"}</strong><small>{snapshot ? `${formatDate(snapshot.createdAt)} · ${snapshot.id}` : "每次保存都会保留可恢复副本"}</small></div></div><div className="snapshot-actions"><button className="secondary-button" onClick={() => void createSnapshot()} disabled={busy}><ArchiveRestore size={16} /> 创建快照</button><button className="secondary-button" onClick={() => void restoreLatest()} disabled={busy}><ArchiveRestore size={16} /> 恢复最近快照</button></div><div className="auth-bridge"><div className="auth-bridge-heading"><KeyRound size={15} /><strong>OAuth bridge</strong></div><div className="auth-actions"><button className="compact-button" onClick={() => void checkAuth("openai-codex", "status")} disabled={busy}>Codex 状态</button><button className="compact-button" onClick={() => void checkAuth("anthropic", "status")} disabled={busy}>Anthropic 状态</button></div><div className="auth-actions"><button className="text-button" onClick={() => void checkAuth("openai-codex", "login")} disabled={busy}>登录 Codex</button><button className="text-button" onClick={() => void checkAuth("anthropic", "login")} disabled={busy}>登录 Anthropic</button></div>{authResult ? <div className="auth-result">{authResult}</div> : null}</div></div>
          </section>
        </section>
      </main>

      {formOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="provider-dialog-title">
            <div className="modal-heading">
              <div>
                <div className="section-kicker">CONFIGURE PROVIDER</div>
                <h2 id="provider-dialog-title">添加或编辑供应商</h2>
              </div>
              <button className="icon-button" title="关闭" onClick={() => setFormOpen(false)}><X size={18} /></button>
            </div>
            <div className="form-grid">
              <label className="wide">
                精选预设
                <select defaultValue="Custom OpenAI-compatible" onChange={(event) => choosePreset(event.target.value)}>
                  {PRESETS.map((preset) => <option key={preset.label} value={preset.label}>{preset.label}</option>)}
                </select>
              </label>
              <label>
                Provider ID
                <input readOnly={Boolean(editingProviderId)} value={form.id} onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))} placeholder="openrouter" />
              </label>
              <label>
                API
                <input list="omp-api-options" value={form.api} onChange={(event) => setForm((current) => ({ ...current, api: event.target.value }))} />
                <datalist id="omp-api-options">
                  <option value="openai-completions" />
                  <option value="openai-responses" />
                  <option value="anthropic-messages" />
                  <option value="google-generative-ai" />
                  <option value="google-vertex" />
                  <option value="azure-openai-responses" />
                  <option value="openai-codex-responses" />
                  <option value="bedrock-converse-stream" />
                  <option value="google-gemini-cli" />
                </datalist>
              </label>
              <label>
                Auth
                <select value={form.auth} onChange={(event) => setForm((current) => ({ ...current, auth: event.target.value }))}>
                  <option value="apiKey">apiKey</option>
                  <option value="none">none</option>
                  <option value="oauth">oauth</option>
                </select>
              </label>
              <label className="wide">
                Endpoint URL
                <input value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1" />
              </label>
              <label className="wide">
                API Key <span className="label-hint">存入系统加密存储</span>
                <input type="password" value={form.key} onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))} placeholder="留空以保留现有引用" />
              </label>
              <div className="wide model-editor">
                <div className="model-editor-heading">
                  <span>Models</span>
                  <button className="icon-button" title="添加模型" onClick={() => setModelEntries((current) => [...current, createModelEditorEntry()])}><Plus size={16} /></button>
                </div>
                {modelEntries.length === 0 ? <div className="model-editor-empty">暂无模型</div> : null}
                {modelEntries.map((entry, index) => (
                  <div className="model-editor-row" key={`${entry.raw.id}-${index}`}>
                    <input aria-label={`模型 ${index + 1} ID`} value={entry.id} onChange={(event) => setModelEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, id: event.target.value } : item))} placeholder="Model ID" />
                    <input aria-label={`模型 ${index + 1} 显示名`} value={entry.name} onChange={(event) => setModelEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder="Display name" />
                    <input aria-label={`模型 ${index + 1} Context`} inputMode="numeric" value={entry.contextWindow} onChange={(event) => setModelEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, contextWindow: event.target.value } : item))} placeholder="Context" />
                    <input aria-label={`模型 ${index + 1} Max output`} inputMode="numeric" value={entry.maxTokens} onChange={(event) => setModelEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, maxTokens: event.target.value } : item))} placeholder="Max output" />
                    <label className="model-toggle"><input type="checkbox" checked={entry.reasoning} onChange={(event) => setModelEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, reasoning: event.target.checked } : item))} />reasoning</label>
                    <label className="model-toggle"><input type="checkbox" checked={entry.vision} onChange={(event) => setModelEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, vision: event.target.checked } : item))} />vision</label>
                    <button className="icon-button subtle danger" title={`移除模型 ${entry.id || index + 1}`} onClick={() => setModelEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
              <label className="wide">
                Headers JSON
                <textarea value={form.headers} onChange={(event) => setForm((current) => ({ ...current, headers: event.target.value }))} rows={3} placeholder='{ "HTTP-Referer": "https://example.com" }' />
              </label>
              <label className="wide">
                Compat JSON
                <textarea value={form.compat} onChange={(event) => setForm((current) => ({ ...current, compat: event.target.value }))} rows={3} placeholder='{ "supportsReasoning": true }' />
              </label>
              <label className="wide">
                Model overrides JSON
                <textarea value={form.overrides} onChange={(event) => setForm((current) => ({ ...current, overrides: event.target.value }))} rows={3} placeholder='{ "gpt-4.1": { "contextWindow": 128000 } }' />
              </label>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => void fetchModels()} disabled={busy}><CloudDownload size={16} /> 从 endpoint 发现</button>
              <div className="modal-actions-right">
                <button className="text-button" onClick={() => setFormOpen(false)}>取消</button>
                <button className="primary-button" onClick={() => void saveProvider()} disabled={busy || readOnly}>{busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} 保存配置</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
