import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactElement, ReactNode } from "react";
import {
  Archive,
  Check,
  CircleAlert,
  Download,
  FileCheck2,
  FilePlus2,
  FolderOpen,
  Import,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Save,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  GatewayPool,
  GatewayUpstream,
  GatewayUpstreamStat,
  ManagedSurfaceEntry,
  OmpProvider,
  SessionMessagePreview,
  SessionSummary,
  SessionRefreshStats,
  SurfaceBundle,
} from "@omp-switch/core";
import { ModelPicker } from "./components/model-picker";
import { StyledSelect } from "./components/ui-primitives";

type AppApi = NonNullable<Window["ompSwitch"]>;
type Notice = { tone: "success" | "error" | "info"; text: string };

interface CommonProps {
  api: AppApi;
  profileId: string;
  readOnly: boolean;
  onNotice: (notice: Notice) => void;
}

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function triggerDownload(filename: string, content: string, type = "application/json"): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ModuleHeading({ title, count, children }: { title: string; count?: number; children?: ReactNode }): ReactElement {
  return <div className="workspace-heading module-heading"><div><span className="eyebrow">PROFILE</span><h1>{title}{typeof count === "number" ? <span className="heading-count">{count}</span> : null}</h1></div><div className="heading-actions">{children}</div></div>;
}

export function SurfaceModule({ api, profileId, kind, readOnly, onNotice }: CommonProps & { kind: "prompt" | "skill" }): ReactElement {
  const [entries, setEntries] = useState<ManagedSurfaceEntry[]>([]);
  const [selected, setSelected] = useState<ManagedSurfaceEntry | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const label = kind === "prompt" ? "提示" : "技能";

  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      const next = await api.listSurface(profileId, kind);
      setEntries(next);
      if (selected) {
        const current = next.find((entry) => entry.id === selected.id);
        if (!current) {
          setSelected(null);
          setEditing(false);
        } else setSelected(current);
      }
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [profileId, kind]);

  async function openEntry(entry: ManagedSurfaceEntry): Promise<void> {
    setLoading(true);
    try {
      setSelected(entry);
      setName(entry.name);
      setContent(await api.readSurface(profileId, kind, entry.name));
      setEditing(false);
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  function beginNew(): void {
    setSelected(null);
    setName("");
    setContent("");
    setEditing(true);
  }

  async function saveEntry(): Promise<void> {
    if (readOnly) return onNotice({ tone: "error", text: "当前 Profile 为只读" });
    if (!name.trim()) return onNotice({ tone: "error", text: `${label}名称不能为空` });
    setLoading(true);
    try {
      const saved = await api.writeSurface(profileId, kind, name.trim(), content);
      await refresh();
      setSelected(saved);
      setName(saved.name);
      setEditing(false);
      onNotice({ tone: "success", text: `${label}已保存` });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function removeEntry(): Promise<void> {
    if (!selected || selected.source !== "profile") return;
    if (!window.confirm(`删除${label}「${selected.name}」？`)) return;
    setLoading(true);
    try {
      await api.deleteSurface(profileId, kind, selected.name);
      setSelected(null);
      setEditing(false);
      await refresh();
      onNotice({ tone: "success", text: `${label}已删除` });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function exportEntries(): Promise<void> {
    try {
      const bundle = await api.exportSurfaces(profileId);
      triggerDownload(`omp-${profileId}-surfaces.json`, JSON.stringify(bundle, null, 2));
      onNotice({ tone: "success", text: "已导出" });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function importEntries(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text()) as SurfaceBundle;
      const imported = await api.importSurfaces(profileId, bundle);
      await refresh();
      onNotice({ tone: "success", text: `已导入 ${imported.length} 项` });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  const writable = Boolean(selected?.source === "profile" || !selected);
  return <section className="module-view module-shell">
    <ModuleHeading title={label} count={entries.length}>
      <button className="icon-button" title="刷新" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} /></button>
      <button className="icon-button" title="导出" onClick={() => void exportEntries()} disabled={loading}><Download size={16} /></button>
      <button className="icon-button" title="导入" onClick={() => fileInput.current?.click()} disabled={loading || readOnly}><Upload size={16} /></button>
      <input ref={fileInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importEntries(event)} />
      <button className="primary-button" onClick={beginNew} disabled={readOnly}><Plus size={16} />新增</button>
    </ModuleHeading>
    <div className="module-columns">
      <div className="module-list-panel">
        {entries.length === 0 ? <div className="module-empty compact-empty"><FileCheck2 size={22} /><strong>暂无{label}</strong><button className="secondary-button" onClick={beginNew} disabled={readOnly}><FilePlus2 size={15} />新增</button></div> : entries.map((entry) => <button key={entry.id} className={`module-list-row ${selected?.id === entry.id ? "active" : ""}`} onClick={() => void openEntry(entry)}><span className="module-row-main"><strong>{entry.name}</strong><small>{formatDate(entry.updatedAt)}</small></span><span className={`status-chip ${entry.source === "profile" ? "ok" : "neutral"}`}>{entry.source === "profile" ? "可编辑" : "只读"}</span></button>)}
      </div>
      <div className="module-editor-panel">
        {selected || editing ? <>
          <div className="editor-head"><div><span className="eyebrow">{selected?.source === "profile" || !selected ? "PROFILE" : selected.source.toUpperCase()}</span><strong>{editing ? (selected ? "编辑" : "新增") : selected?.name}</strong></div><div className="drawer-actions">{selected && !editing ? <button className="icon-button danger" title="删除" onClick={() => void removeEntry()} disabled={loading || selected.source !== "profile"}><Trash2 size={15} /></button> : null}<button className="secondary-button" onClick={() => setEditing((value) => !value)} disabled={!writable}>{editing ? "预览" : "编辑"}</button></div></div>
          {editing ? <><label className="module-field"><span>名称</span><input value={name} onChange={(event) => setName(event.target.value)} disabled={Boolean(selected && selected.source !== "profile")} placeholder={kind === "prompt" ? "review" : "release"} /></label><label className="module-field"><span>{kind === "prompt" ? "内容" : "SKILL.md"}</span><textarea className="surface-editor" value={content} onChange={(event) => setContent(event.target.value)} disabled={!writable} spellCheck={false} /></label><button className="primary-button full-width" onClick={() => void saveEntry()} disabled={loading || !writable}><Save size={15} />保存</button></> : <pre className="raw-view surface-readonly">{content || "空"}</pre>}
        </> : <div className="module-empty compact-empty"><FileCheck2 size={22} /><strong>选择一项</strong><span>或新建</span></div>}
      </div>
    </div>
  </section>;
}

export function SessionsModule({ api, profileId, onNotice }: Omit<CommonProps, "readOnly">): ReactElement {
  const [entries, setEntries] = useState<SessionSummary[]>([]);
  const [listCursor, setListCursor] = useState<string | undefined>();
  const [selected, setSelected] = useState<SessionSummary | null>(null);
  const [messages, setMessages] = useState<SessionMessagePreview[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | undefined>();
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [invalidLines, setInvalidLines] = useState(0);
  const [refreshStats, setRefreshStats] = useState<SessionRefreshStats | null>(null);
  const [loading, setLoading] = useState(false);
  const requestSequence = useRef(0);

  function isCurrent(sequence: number): boolean {
    return sequence === requestSequence.current;
  }

  async function refresh(rebuild = false): Promise<void> {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const cached = await api.listSessions(profileId);
      if (!isCurrent(sequence)) return;
      setEntries(cached.sessions);
      setListCursor(cached.nextCursor);
      const result = await api.refreshSessions(profileId, { rebuild });
      if (!isCurrent(sequence)) return;
      setRefreshStats(result);
      setInvalidLines(result.invalidLines);
      const updated = await api.listSessions(profileId);
      if (!isCurrent(sequence)) return;
      setEntries(updated.sessions);
      setListCursor(updated.nextCursor);
      if (!rebuild && result.phase === "quick") {
        const complete = await api.refreshSessions(profileId);
        if (!isCurrent(sequence)) return;
        setRefreshStats(complete);
        setInvalidLines(complete.invalidLines);
        const finalPage = await api.listSessions(profileId);
        if (!isCurrent(sequence)) return;
        setEntries(finalPage.sessions);
        setListCursor(finalPage.nextCursor);
      }
    } catch (error) {
      if (!isCurrent(sequence)) return;
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (isCurrent(sequence)) setLoading(false);
    }
  }

  async function loadMoreSessions(): Promise<void> {
    if (!listCursor || loading) return;
    const sequence = requestSequence.current;
    setLoading(true);
    try {
      const page = await api.listSessions(profileId, { cursor: listCursor });
      if (!isCurrent(sequence)) return;
      setEntries((current) => [...current, ...page.sessions]);
      setListCursor(page.nextCursor);
    } catch (error) {
      if (!isCurrent(sequence)) return;
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (isCurrent(sequence)) setLoading(false);
    }
  }

  useEffect(() => {
    requestSequence.current += 1;
    setSelected(null);
    setMessages([]);
    setMessageCursor(undefined);
    setHasMoreMessages(false);
    void refresh();
  }, [profileId]);

  async function openEntry(entry: SessionSummary): Promise<void> {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      setSelected(entry);
      setMessages([]);
      setMessageCursor(undefined);
      setHasMoreMessages(false);
      const page = await api.readSessionMessages(profileId, entry.id);
      if (!isCurrent(sequence)) return;
      setMessages(page.messages);
      setMessageCursor(page.nextCursor);
      setHasMoreMessages(page.hasMore);
    } catch (error) {
      if (!isCurrent(sequence)) return;
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (isCurrent(sequence)) setLoading(false);
    }
  }

  async function loadEarlier(): Promise<void> {
    if (!selected || !messageCursor) return;
    const sequence = requestSequence.current;
    const selectedId = selected.id;
    setLoading(true);
    try {
      const page = await api.readSessionMessages(profileId, selectedId, { cursor: messageCursor });
      if (!isCurrent(sequence) || selected?.id !== selectedId) return;
      setMessages((current) => [...current, ...page.messages]);
      setMessageCursor(page.nextCursor);
      setHasMoreMessages(page.hasMore);
    } catch (error) {
      if (!isCurrent(sequence)) return;
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (isCurrent(sequence)) setLoading(false);
    }
  }

  const summary = useMemo(() => entries.reduce((result, entry) => {
    for (const [key, value] of Object.entries(entry.tokens)) result.tokens[key] = (result.tokens[key] ?? 0) + value;
    result.cost += entry.cost;
    result.failures += entry.failures;
    return result;
  }, { tokens: {} as Record<string, number>, cost: 0, failures: 0 }), [entries]);

  return <section className="module-view module-shell">
    <ModuleHeading title="会话" count={entries.length}><button className="icon-button" title="刷新索引" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} /></button><button className="secondary-button" onClick={() => void refresh(true)} disabled={loading}>重建索引</button></ModuleHeading>
    <div className="metric-strip"><span><strong>{entries.length}</strong>会话</span><span><strong>{Object.values(summary.tokens).reduce((a, b) => a + b, 0).toLocaleString()}</strong>tokens</span><span><strong>${summary.cost.toFixed(4)}</strong>成本</span><span className={summary.failures ? "metric-danger" : ""}><strong>{summary.failures}</strong>失败</span>{invalidLines ? <span className="metric-warning"><strong>{invalidLines}</strong>无效行</span> : null}{refreshStats?.errors ? <span className="metric-warning"><strong>{refreshStats.errors}</strong>文件异常</span> : null}</div>
    {refreshStats ? <span className="muted-line">识别 {refreshStats.discovered} · 跳过 {refreshStats.skipped} · 复用 {refreshStats.reused} · 变化 {refreshStats.changed} · 重建 {refreshStats.rebuilt} · 扫描 {formatBytes(refreshStats.scannedBytes)}{refreshStats.diagnostics?.[0] ? ` · ${refreshStats.diagnostics[0].message}` : ""}</span> : null}
    <div className="module-columns sessions-columns">
      <div className="module-list-panel session-list">{entries.length === 0 && loading ? <div className="list-skel">{[0, 1, 2, 3, 4].map((index) => <div key={index} className="skeleton skeleton-row" />)}</div> : entries.length === 0 ? <div className="module-empty compact-empty"><Archive size={22} /><strong>{refreshStats?.rootMissing ? "会话目录不存在" : refreshStats?.phase === "quick" ? "正在建立初始索引" : refreshStats?.errors ? "部分文件无法读取" : "暂无可识别主会话"}</strong><button className="secondary-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} />扫描</button></div> : <>{entries.map((entry) => <button key={entry.id} className={"module-list-row session-row " + (selected?.id === entry.id ? "active" : "")} onClick={() => void openEntry(entry)}><span className="module-row-main"><strong>{entry.title ?? entry.model ?? "未命名会话"}</strong><small>{entry.provider ?? "—"} · {formatDate(entry.lastActiveAt ?? entry.startedAt)} · {entry.messageCount} 条消息</small></span><span className={"status-chip " + (entry.stale ? "warn" : entry.failures ? "danger" : "neutral")}>{entry.stale ? "缓存过期" : entry.failures ? entry.failures + " 失败" : "已索引"}</span></button>)}{listCursor ? <button className="secondary-button full-width" onClick={() => void loadMoreSessions()} disabled={loading}>加载更多会话</button> : null}</>}</div>
      <div className="module-editor-panel session-detail">{selected ? <><div className="editor-head"><div><span className="eyebrow">SESSION</span><strong>{selected.title ?? selected.model ?? "会话"}</strong></div><span className="muted-line">{formatBytes(selected.fileSize)} · {formatDate(selected.lastActiveAt ?? selected.startedAt)}</span></div>{hasMoreMessages ? <button className="secondary-button" onClick={() => void loadEarlier()} disabled={loading}>加载更早消息</button> : null}<pre className="raw-view">{messages.length ? messages.map((message) => message.role + ": " + message.text).join("\n\n") : "读取中"}</pre></> : <div className="module-empty compact-empty"><CircleAlert size={22} /><strong>选择一个会话</strong><span>消息按需分页读取，不写入索引缓存</span></div>}</div>
    </div>
  </section>;
}

interface GatewayProps extends CommonProps { providers: Array<[string, OmpProvider]> }

function makeGatewayPool(profileId: string, providers: Array<[string, OmpProvider]>): GatewayPool {
  const first = providers[0];
  const model = first && Array.isArray(first[1].models) ? first[1].models[0] : undefined;
  const providerId = first?.[0] ?? "";
  const modelId = model?.id ?? "";
  const upstream: GatewayUpstream = { id: "upstream-1", providerId, modelId, kind: "secret", enabled: true };
  return { id: `pool-${Date.now().toString(36)}`, profile: profileId, virtualModel: "omp-switch/default", port: 46831, enabled: true, upstreams: [upstream] };
}

export function GatewayModule({ api, profileId, readOnly, onNotice, providers }: GatewayProps): ReactElement {
  const [pools, setPools] = useState<GatewayPool[]>([]);
  const [draft, setDraft] = useState<GatewayPool | null>(null);
  const [status, setStatus] = useState<{ running: boolean; port: number | null; upstreams: GatewayUpstreamStat[] }>({ running: false, port: null, upstreams: [] });
  const [token, setToken] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const modelOptions = useMemo(() => providers.flatMap(([providerId, provider]) => (Array.isArray(provider.models) ? provider.models : []).map((model) => ({ providerId, modelId: model.id, label: `${providerId}/${model.id}` }))), [providers]);

  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      setPools(await api.listGatewayPools(profileId));
      setStatus(await api.gatewayStatus());
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [profileId]);

  function updateDraft<K extends keyof GatewayPool>(key: K, value: GatewayPool[K]): void {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  function updateUpstream(index: number, patch: Partial<GatewayUpstream>): void {
    setDraft((current) => current ? { ...current, upstreams: current.upstreams.map((upstream, itemIndex) => itemIndex === index ? { ...upstream, ...patch } : upstream) } : current);
  }

  async function saveDraft(): Promise<GatewayPool | null> {
    if (!draft) return null;
    if (!draft.id.trim() || !draft.virtualModel.trim()) return onNotice({ tone: "error", text: "网关池 ID 和虚拟模型不能为空" }), null;
    setLoading(true);
    try {
      const saved = await api.saveGatewayPool({ ...draft, id: draft.id.trim(), virtualModel: draft.virtualModel.trim(), profile: profileId });
      setPools((current) => [saved, ...current.filter((pool) => pool.id !== saved.id)]);
      setDraft(saved);
      onNotice({ tone: "success", text: "网关池已保存" });
      return saved;
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function start(): Promise<void> {
    if (readOnly) return onNotice({ tone: "error", text: "当前 Profile 为只读" });
    const saved = await saveDraft();
    if (!saved) return;
    setLoading(true);
    try {
      const started = await api.startGateway(profileId);
      setStatus((current) => ({ running: started.running, port: started.port, upstreams: current.upstreams }));
      setToken(started.token);
      onNotice({ tone: "success", text: `网关已启动 · 127.0.0.1:${started.port} · 需携带 Bearer token` });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function stop(): Promise<void> {
    setLoading(true);
    try {
      await api.stopGateway();
      setStatus({ running: false, port: null, upstreams: [] });
      setToken(null);
      onNotice({ tone: "success", text: "网关已停止" });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  return <section className="module-view module-shell">
    <ModuleHeading title="网关" count={pools.length}><span className={`status-chip ${status.running ? "ok" : "neutral"}`}>{status.running ? `运行中 · ${status.port}` : "未启动"}</span><button className="icon-button" title="刷新" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} /></button><button className="primary-button" onClick={() => setDraft(makeGatewayPool(profileId, providers))} disabled={readOnly}><Plus size={16} />新增</button></ModuleHeading>
    <div className="gateway-layout">
      <div className="module-list-panel">{pools.length === 0 ? <div className="module-empty compact-empty"><CircleAlert size={22} /><strong>暂无网关池</strong><button className="secondary-button" onClick={() => setDraft(makeGatewayPool(profileId, providers))} disabled={readOnly}><Plus size={15} />新建</button></div> : pools.map((pool) => <button key={pool.id} className={`module-list-row ${draft?.id === pool.id ? "active" : ""}`} onClick={() => setDraft(pool)}><span className="module-row-main"><strong>{pool.virtualModel}</strong><small>{pool.id} · {pool.upstreams.length} 上游 · {pool.port}</small></span><span className={`status-chip ${pool.enabled ? "ok" : "neutral"}`}>{pool.enabled ? "启用" : "停用"}</span></button>)}</div>
      <div className="module-editor-panel gateway-editor">{draft ? <><div className="editor-head"><div><span className="eyebrow">POOL</span><strong>{draft.id}</strong></div><div className="drawer-actions"><button className="secondary-button" onClick={() => setDraft(null)}>关闭</button></div></div><div className="form-two"><label className="module-field"><span>ID</span><input value={draft.id} onChange={(event) => updateDraft("id", event.target.value)} disabled={Boolean(pools.find((pool) => pool.id === draft.id))} /></label><label className="module-field"><span>端口</span><input inputMode="numeric" value={draft.port} onChange={(event) => updateDraft("port", Number(event.target.value) || 0)} /></label></div><label className="module-field"><span>虚拟模型</span><input value={draft.virtualModel} onChange={(event) => updateDraft("virtualModel", event.target.value)} placeholder="omp-switch/default" /></label><label className="check-line module-check"><input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft("enabled", event.target.checked)} />启用</label><div className="upstream-list"><div className="drawer-section-title"><span>上游</span><button className="icon-button" title="添加上游" onClick={() => setDraft((current) => current ? { ...current, upstreams: [...current.upstreams, { id: `upstream-${current.upstreams.length + 1}`, providerId: providers[0]?.[0] ?? "", modelId: modelOptions[0]?.modelId ?? "", kind: "secret", enabled: true }] } : current)}><Plus size={15} /></button></div>{draft.upstreams.map((upstream, index) => <div className="upstream-row" key={upstream.id}><input value={upstream.id} onChange={(event) => updateUpstream(index, { id: event.target.value })} aria-label="上游 ID" /><ModelPicker providers={providers} value={upstream.providerId && upstream.modelId ? `${upstream.providerId}/${upstream.modelId}` : ""} onValueChange={(next) => { const slash = next.indexOf("/"); if (slash < 0) return; updateUpstream(index, { providerId: next.slice(0, slash), modelId: next.slice(slash + 1) }); }} ariaLabel="供应商模型" /><StyledSelect value={upstream.kind} onValueChange={(next) => updateUpstream(index, { kind: next as GatewayUpstream["kind"] })} options={[{ value: "secret", label: "安全库" }, { value: "omp-auth-gateway", label: "OMP OAuth" }]} ariaLabel="认证方式" /><input value={upstream.credentialId ?? ""} onChange={(event) => updateUpstream(index, { credentialId: event.target.value || undefined })} placeholder="凭据 ID" aria-label="凭据 ID" /><button className="icon-button subtle danger" title="删除上游" onClick={() => setDraft((current) => current ? { ...current, upstreams: current.upstreams.filter((_, itemIndex) => itemIndex !== index) } : current)} disabled={draft.upstreams.length <= 1}><Trash2 size={14} /></button></div>)}</div><div className="drawer-actions"><button className="primary-button" onClick={() => void saveDraft()} disabled={loading || readOnly}><Save size={15} />保存</button>{status.running ? <button className="secondary-button" onClick={() => void stop()} disabled={loading}><Square size={14} />停止</button> : <button className="secondary-button" onClick={() => void start()} disabled={loading || readOnly}><Play size={14} />启动</button>}</div>{token ? <label className="module-field"><span>Bearer token（调用时必须携带）</span><input className="mono" readOnly value={token} onFocus={(event) => event.currentTarget.select()} /></label> : null}{status.upstreams.length > 0 ? <div className="upstream-list"><div className="drawer-section-title"><span>上游状态</span></div>{status.upstreams.map((stat) => <div className="upstream-row" key={`${stat.poolId}:${stat.upstreamId}`}><span className="mono">{stat.upstreamId}</span><span className={`status-chip ${stat.consecutiveFailures > 0 ? "warn" : "ok"}`}>{stat.lastStatus ?? "ERR"}</span><span className="muted-line">{stat.lastLatencyMs !== undefined ? `${stat.lastLatencyMs} ms` : "—"}</span><span className="muted-line">{stat.consecutiveFailures > 0 ? `连续失败 ${stat.consecutiveFailures}` : formatDate(stat.lastAt)}</span></div>)}</div> : null}</> : <div className="module-empty compact-empty"><CircleAlert size={22} /><strong>选择或新建网关池</strong><span>仅绑定 127.0.0.1，且强制校验 Bearer token</span></div>}</div>
    </div>
  </section>;
}

export function ProjectOverlayBadge({ api, profileId, onNotice }: { api: AppApi; profileId: string; onNotice: (notice: Notice) => void }): ReactElement {
  const [context, setContext] = useState<Awaited<ReturnType<AppApi["projectOverlay"]>> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.projectOverlay(profileId).then(setContext).catch(() => setContext(null)); }, [api, profileId]);

  async function chooseRoot(): Promise<void> {
    setBusy(true);
    try {
      setContext(await api.chooseProjectRoot(profileId));
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function copyPatch(): Promise<void> {
    const overlay = context?.overlay;
    if (!overlay) return;
    const text = `${overlay.models.raw || "providers: {}\n"}\n${overlay.settings.raw || "{}\n"}`;
    try { await navigator.clipboard.writeText(text); onNotice({ tone: "success", text: "Patch 已复制" }); } catch { onNotice({ tone: "error", text: "复制失败" }); }
  }

  if (!context) return <span className="muted-line">项目覆盖：读取中</span>;
  const { overlay, precedence } = context;
  return <div className="project-overlay">
    <div className="project-overlay-head">
      {overlay ? <span className="status-chip neutral">项目覆盖</span> : <span className="status-chip neutral">无覆盖</span>}
      {/* A packaged GUI's cwd is wherever the shortcut ran, so an unconfirmed root is called out. */}
      {!context.explicit ? <span className="status-chip warn" title="未确认的目录，来自进程启动位置">推测目录</span> : null}
      <button className="secondary-button" onClick={() => void chooseRoot()} disabled={busy}><FolderOpen size={14} />选择目录</button>
    </div>
    <span className="muted-line mono break">{context.root}</span>
    {overlay ? <div className="project-overlay-actions">
      <button className="secondary-button" onClick={() => void copyPatch()}><Download size={14} />复制 Patch</button>
      {overlay.diagnostics.length ? <span className="status-chip danger"><CircleAlert size={13} />{overlay.diagnostics.length}</span> : <span className="status-chip ok"><Check size={13} />正常</span>}
    </div> : null}
    {precedence.map((item, index) => <span key={`${item.code}-${index}`} className={`muted-line ${item.severity === "warning" ? "warn-line" : ""}`}>{item.message}</span>)}
  </div>;
}
