import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactElement, ReactNode } from "react";
import {
  Archive,
  Check,
  ChevronUp,
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
import { ConfirmDialog } from "./components/save-flow";
import { StyledSelect } from "./components/ui-primitives";
import { useTranslation } from "react-i18next";
import { formatDateTime, formatClock } from "./locale";

type AppApi = NonNullable<Window["ompSwitch"]>;
type Notice = { tone: "success" | "error" | "info"; text: string };

interface CommonProps {
  api: AppApi;
  profileId: string;
  readOnly: boolean;
  onNotice: (notice: Notice) => void;
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
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ManagedSurfaceEntry[]>([]);
  const [selected, setSelected] = useState<ManagedSurfaceEntry | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const label = t(kind === "prompt" ? "surfaces.prompt" : "surfaces.skill");

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
    if (readOnly) return onNotice({ tone: "error", text: t("surfaces.readonly") });
    if (!name.trim()) return onNotice({ tone: "error", text: t("surfaces.nameRequired", { label }) });
    setLoading(true);
    try {
      const saved = await api.writeSurface(profileId, kind, name.trim(), content);
      await refresh();
      setSelected(saved);
      setName(saved.name);
      setEditing(false);
      onNotice({ tone: "success", text: t("surfaces.saved", { label }) });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function removeEntry(): Promise<void> {
    if (!selected || selected.source !== "profile") return;
    setConfirmDelete(true);
  }

  async function confirmRemove(): Promise<void> {
    if (!selected || selected.source !== "profile") return;
    setConfirmDelete(false);
    setLoading(true);
    try {
      await api.deleteSurface(profileId, kind, selected.name);
      setSelected(null);
      setEditing(false);
      await refresh();
      onNotice({ tone: "success", text: t("surfaces.deleted", { label }) });
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
      onNotice({ tone: "success", text: t("surfaces.exported") });
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
      onNotice({ tone: "success", text: t("surfaces.imported", { count: imported.length }) });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  const writable = Boolean(selected?.source === "profile" || !selected);
  return <section className="module-view module-shell">
    <ModuleHeading title={label} count={entries.length}>
      <button className="icon-button" title={t("surfaces.refresh")} onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} /></button>
      <button className="icon-button" title={t("surfaces.export")} onClick={() => void exportEntries()} disabled={loading}><Download size={16} /></button>
      <button className="icon-button" title={t("surfaces.import")} onClick={() => fileInput.current?.click()} disabled={loading || readOnly}><Upload size={16} /></button>
      <input ref={fileInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importEntries(event)} />
      <button className="primary-button" onClick={beginNew} disabled={readOnly}><Plus size={16} />{t("surfaces.new")}</button>
    </ModuleHeading>
    <div className="module-columns">
      <div className="module-list-panel">
        {entries.length === 0 ? <div className="module-empty compact-empty"><span className="empty-glyph"><FileCheck2 size={26} /></span><strong>{t("surfaces.empty", { label })}</strong><span className="empty-desc">{t("surfaces.emptyHint", { label })}</span><div className="empty-actions"><button className="primary-button" onClick={beginNew} disabled={readOnly}><FilePlus2 size={15} />{t("surfaces.newWithLabel", { label })}</button><button className="secondary-button" onClick={() => fileInput.current?.click()} disabled={loading || readOnly}><Upload size={15} />{t("surfaces.import")}</button></div></div> : entries.map((entry) => <button key={entry.id} className={`module-list-row ${selected?.id === entry.id ? "active" : ""}`} onClick={() => void openEntry(entry)}><span className="module-row-main"><strong>{entry.name}</strong><small>{formatDateTime(entry.updatedAt)}</small></span><span className={`status-chip ${entry.source === "profile" ? "ok" : "neutral"}`}>{entry.source === "profile" ? t("surfaces.editable") : t("surfaces.readonlyBadge")}</span></button>)}
      </div>
      <div className="module-editor-panel">
        {selected || editing ? <>
          <div className="editor-head"><div><span className="eyebrow">{selected?.source === "profile" || !selected ? "PROFILE" : selected.source.toUpperCase()}</span><strong>{editing ? (selected ? t("surfaces.edit") : t("surfaces.new")) : selected?.name}</strong></div><div className="drawer-actions">{selected && !editing ? <button className="icon-button danger" title={t("common.delete")} onClick={() => void removeEntry()} disabled={loading || selected.source !== "profile"}><Trash2 size={15} /></button> : null}<button className="secondary-button" onClick={() => setEditing((value) => !value)} disabled={!writable}>{editing ? t("surfaces.preview") : t("surfaces.edit")}</button></div></div>
          {editing ? <><label className="module-field"><span>{t("surfaces.name")}</span><input value={name} onChange={(event) => setName(event.target.value)} disabled={Boolean(selected && selected.source !== "profile")} placeholder={kind === "prompt" ? "review" : "release"} /></label><label className="module-field"><span>{kind === "prompt" ? t("surfaces.content") : "SKILL.md"}</span><textarea className="surface-editor" value={content} onChange={(event) => setContent(event.target.value)} disabled={!writable} spellCheck={false} /></label><button className="primary-button full-width" onClick={() => void saveEntry()} disabled={loading || !writable}><Save size={15} />{t("common.save")}</button></> : <pre className="raw-view surface-readonly">{content || t("surfaces.blank")}</pre>}
        </> : <div className="module-empty compact-empty"><span className="empty-glyph"><FileCheck2 size={26} /></span><strong>{t("surfaces.selectPrompt", { label })}</strong><span className="empty-desc">{t("surfaces.selectHint", { label })}</span></div>}
      </div>
    </div>
    <ConfirmDialog
      open={confirmDelete}
      title={t("common.delete")}
      message={t("surfaces.deleteConfirm", { label, name: selected?.name ?? "" })}
      confirmLabel={t("common.delete")}
      danger
      busy={loading}
      onClose={() => setConfirmDelete(false)}
      onConfirm={() => void confirmRemove()}
    />
  </section>;
}

/**
 * A single session turn as a chat bubble. The three roles read at a glance: the user is a
 * right-aligned ink/paper inversion, the assistant is a left-aligned sunken block carrying its
 * model, and anything else (system / tool / result) is a centered narrow strip so it reads as
 * instrumentation between turns rather than another voice. Code fences render as standalone
 * blocks inside the body; everything else keeps preserved whitespace.
 */
type MessageSegment = { kind: "text"; text: string } | { kind: "code"; lang: string; text: string };

/** A GFM-ish fence splitter: ```lang … ``` becomes a code segment; the rest stays text. A fence
 *  without a closing ``` (common on truncated previews) takes the remainder as code so the block
 *  is still visually contained. */
function splitMessageSegments(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const fence = /(^|\n)```([^\n`]*)\n([\s\S]*?)(```|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    const leading = text.slice(lastIndex, match.index + match[1].length);
    if (leading.trim()) segments.push({ kind: "text", text: leading.replace(/^\n/, "") });
    const lang = match[2].trim();
    const body = match[3].replace(/\n$/, "");
    segments.push({ kind: "code", lang, text: body });
    lastIndex = fence.lastIndex;
  }
  const tail = text.slice(lastIndex);
  if (tail.trim()) segments.push({ kind: "text", text: tail.replace(/^\n/, "") });
  return segments.length ? segments : [{ kind: "text", text }];
}

function MessageBody({ text, fallback }: { text: string; fallback: string }): ReactElement {
  const segments = splitMessageSegments(text || fallback);
  return <div className="msg-text">
    {segments.map((segment, index) => segment.kind === "code"
      ? <pre className="msg-code" key={index}><code>{segment.text}</code></pre>
      : <span key={index} className="msg-prose">{segment.text}</span>)}
  </div>;
}

function MessageBubble({ message }: { message: SessionMessagePreview }): ReactElement {
  const { t } = useTranslation();
  const time = formatClock(message.timestamp);
  if (message.role === "user") {
    return <div className="msg msg-user">
      <div className="msg-bubble">
        <div className="msg-meta"><span className="msg-role">{t("sessions.roleYou")}</span>{time ? <span className="msg-time">{time}</span> : null}</div>
        <MessageBody text={message.text} fallback={t("sessions.emptyBody")} />
      </div>
    </div>;
  }
  if (message.role === "assistant") {
    const failed = message.status && /error|fail|abort|cancel|refus/i.test(message.status);
    return <div className="msg msg-assistant">
      <div className="msg-bubble">
        <div className="msg-meta">
          <span className="msg-role">{t("sessions.roleAssistant")}</span>
          {message.provider && message.model ? <span className="msg-model mono">{message.provider}/{message.model}</span> : null}
          {time ? <span className="msg-time">{time}</span> : null}
          {failed ? <span className="msg-fail">{message.status}</span> : null}
        </div>
        <MessageBody text={message.text} fallback={t("sessions.noContent")} />
        {message.truncated ? <div className="msg-trunc">{t("sessions.truncated")}</div> : null}
      </div>
    </div>;
  }
  // system / tool / result — a quiet strip, never a full bubble.
  return <div className="msg msg-event">
    <span className="msg-event-label">{message.role}{time ? ` · ${time}` : ""}</span>
    <span className="msg-event-text">{message.text}</span>
  </div>;
}

export function SessionsModule({ api, profileId, onNotice }: Omit<CommonProps, "readOnly">): ReactElement {
  const { t } = useTranslation();
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
    <ModuleHeading title={t("sessions.heading")} count={entries.length}><button className="icon-button" title={t("sessions.refreshIndex")} onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} /></button><button className="secondary-button" onClick={() => void refresh(true)} disabled={loading}>{t("sessions.rebuildIndex")}</button></ModuleHeading>
    <div className="metric-strip"><span><strong>{entries.length}</strong>{t("sessions.metricSessions")}</span><span><strong>{Object.values(summary.tokens).reduce((a, b) => a + b, 0).toLocaleString()}</strong>{t("sessions.metricTokens")}</span><span><strong>${summary.cost.toFixed(4)}</strong>{t("sessions.metricCost")}</span><span className={summary.failures ? "metric-danger" : ""}><strong>{summary.failures}</strong>{t("sessions.metricFailures")}</span>{invalidLines ? <span className="metric-warning"><strong>{invalidLines}</strong>{t("sessions.metricInvalidLines")}</span> : null}{refreshStats?.errors ? <span className="metric-warning"><strong>{refreshStats.errors}</strong>{t("sessions.metricFileErrors")}</span> : null}</div>
    {refreshStats ? <span className="muted-line">{(() => { const parts = [`${t("sessions.statsDiscovered")} ${refreshStats.discovered}`, `${t("sessions.statsSkipped")} ${refreshStats.skipped}`, `${t("sessions.statsReused")} ${refreshStats.reused}`, `${t("sessions.statsChanged")} ${refreshStats.changed}`, `${t("sessions.statsRebuilt")} ${refreshStats.rebuilt}`, `${t("sessions.statsScanned")} ${formatBytes(refreshStats.scannedBytes)}`]; if (refreshStats.diagnostics?.[0]) parts.push(refreshStats.diagnostics[0].message); return parts.join(" · "); })()}</span> : null}
    <div className="module-columns sessions-columns">
      <div className="module-list-panel session-list">{entries.length === 0 && loading ? <div className="list-skel">{[0, 1, 2, 3, 4].map((index) => <div key={index} className="skeleton skeleton-row" />)}</div> : entries.length === 0 ? <div className="module-empty compact-empty"><span className="empty-glyph"><Archive size={26} /></span><strong>{refreshStats?.rootMissing ? t("sessions.emptyRootMissing") : refreshStats?.phase === "quick" ? t("sessions.emptyIndexing") : refreshStats?.errors ? t("sessions.emptyPartialErrors") : t("sessions.emptyNoSessions")}</strong><span className="empty-desc">{refreshStats?.rootMissing ? t("sessions.emptyRootMissingHint") : t("sessions.emptyHint")}</span><div className="empty-actions"><button className="secondary-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} />{t("sessions.scan")}</button></div></div> : <>{entries.map((entry) => <button key={entry.id} className={"module-list-row session-row " + (selected?.id === entry.id ? "active" : "")} onClick={() => void openEntry(entry)}><span className="module-row-main"><strong>{entry.title ?? entry.model ?? t("sessions.unnamed")}</strong><small>{entry.provider ?? "—"} · {formatDateTime(entry.lastActiveAt ?? entry.startedAt)} · {t("sessions.messageCount", { count: entry.messageCount })}</small></span><span className={"status-chip " + (entry.stale ? "warn" : entry.failures ? "danger" : "neutral")}>{entry.stale ? t("sessions.stale") : entry.failures ? t("sessions.failures", { count: entry.failures }) : t("sessions.indexed")}</span></button>)}{listCursor ? <button className="secondary-button full-width" onClick={() => void loadMoreSessions()} disabled={loading}>{t("sessions.loadMore")}</button> : null}</>}</div>
      <div className="module-editor-panel session-detail">{selected ? <><div className="editor-head"><div><span className="eyebrow">SESSION</span><strong>{selected.title ?? selected.model ?? t("sessions.heading")}</strong></div><span className="muted-line">{formatBytes(selected.fileSize)} · {formatDateTime(selected.lastActiveAt ?? selected.startedAt)}</span></div><div className="session-messages">{hasMoreMessages ? <div className="session-load-earlier"><button className="secondary-button compact" onClick={() => void loadEarlier()} disabled={loading}><ChevronUp size={14} />{t("sessions.loadEarlier")}</button></div> : null}{messages.length ? messages.map((message) => <MessageBubble key={message.id} message={message} />) : <div className="muted-line session-msg-loading">{t("common.loading")}…</div>}</div></> : <div className="module-empty compact-empty"><span className="empty-glyph"><CircleAlert size={26} /></span><strong>{t("sessions.selectPrompt")}</strong><span className="empty-desc">{t("sessions.selectHint")}</span></div>}</div>
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
  const { t } = useTranslation();
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
    if (!draft.id.trim() || !draft.virtualModel.trim()) return onNotice({ tone: "error", text: t("gateway.poolIdVirtualModelRequired") }), null;
    setLoading(true);
    try {
      const saved = await api.saveGatewayPool({ ...draft, id: draft.id.trim(), virtualModel: draft.virtualModel.trim(), profile: profileId });
      setPools((current) => [saved, ...current.filter((pool) => pool.id !== saved.id)]);
      setDraft(saved);
      onNotice({ tone: "success", text: t("gateway.poolSaved") });
      return saved;
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function start(): Promise<void> {
    if (readOnly) return onNotice({ tone: "error", text: t("gateway.readonly") });
    const saved = await saveDraft();
    if (!saved) return;
    setLoading(true);
    try {
      const started = await api.startGateway(profileId);
      setStatus((current) => ({ running: started.running, port: started.port, upstreams: current.upstreams }));
      setToken(started.token);
      onNotice({ tone: "success", text: t("gateway.started", { port: started.port }) });
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
      onNotice({ tone: "success", text: t("gateway.stopped") });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  return <section className="module-view module-shell">
    <ModuleHeading title={t("gateway.heading")} count={pools.length}><span className={`status-chip ${status.running ? "ok" : "neutral"}`}>{status.running ? t("gateway.running", { port: status.port }) : t("gateway.stoppedBadge")}</span><button className="icon-button" title={t("common.refresh")} onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} /></button><button className="primary-button" onClick={() => setDraft(makeGatewayPool(profileId, providers))} disabled={readOnly}><Plus size={16} />{t("common.add")}</button></ModuleHeading>
    <div className="gateway-layout">
      <div className="module-list-panel">{pools.length === 0 ? <div className="module-empty compact-empty"><span className="empty-glyph"><CircleAlert size={26} /></span><strong>{t("gateway.empty")}</strong><span className="empty-desc">{t("gateway.emptyHint")}</span><div className="empty-actions"><button className="primary-button" onClick={() => setDraft(makeGatewayPool(profileId, providers))} disabled={readOnly}><Plus size={15} />{t("gateway.newPool")}</button></div></div> : pools.map((pool) => <button key={pool.id} className={`module-list-row ${draft?.id === pool.id ? "active" : ""}`} onClick={() => setDraft(pool)}><span className="module-row-main"><strong>{pool.virtualModel}</strong><small>{pool.id} · {t("gateway.upstreamCount", { count: pool.upstreams.length })} · {pool.port}</small></span><span className={`status-chip ${pool.enabled ? "ok" : "neutral"}`}>{pool.enabled ? t("gateway.enabled") : t("gateway.disabled")}</span></button>)}</div>
      <div className="module-editor-panel gateway-editor">{draft ? <><div className="editor-head"><div><span className="eyebrow">POOL</span><strong>{draft.id}</strong></div><div className="drawer-actions"><button className="secondary-button" onClick={() => setDraft(null)}>{t("common.close")}</button></div></div><div className="form-two"><label className="module-field"><span>{t("gateway.fieldId")}</span><input value={draft.id} onChange={(event) => updateDraft("id", event.target.value)} disabled={Boolean(pools.find((pool) => pool.id === draft.id))} /></label><label className="module-field"><span>{t("gateway.fieldPort")}</span><input inputMode="numeric" value={draft.port} onChange={(event) => updateDraft("port", Number(event.target.value) || 0)} /></label></div><label className="module-field"><span>{t("gateway.fieldVirtualModel")}</span><input value={draft.virtualModel} onChange={(event) => updateDraft("virtualModel", event.target.value)} placeholder="omp-switch/default" /></label><label className="check-line module-check"><input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft("enabled", event.target.checked)} />{t("gateway.enabled")}</label><div className="upstream-list"><div className="drawer-section-title"><span>{t("gateway.upstreams")}</span><button className="icon-button" title={t("gateway.addUpstream")} onClick={() => setDraft((current) => current ? { ...current, upstreams: [...current.upstreams, { id: `upstream-${current.upstreams.length + 1}`, providerId: providers[0]?.[0] ?? "", modelId: modelOptions[0]?.modelId ?? "", kind: "secret", enabled: true }] } : current)}><Plus size={15} /></button></div>{draft.upstreams.map((upstream, index) => <div className="upstream-row" key={upstream.id}><input value={upstream.id} onChange={(event) => updateUpstream(index, { id: event.target.value })} aria-label={t("gateway.ariaUpstreamId")} /><ModelPicker providers={providers} value={upstream.providerId && upstream.modelId ? `${upstream.providerId}/${upstream.modelId}` : ""} onValueChange={(next) => { const slash = next.indexOf("/"); if (slash < 0) return; updateUpstream(index, { providerId: next.slice(0, slash), modelId: next.slice(slash + 1) }); }} ariaLabel={t("gateway.ariaProviderModel")} /><StyledSelect value={upstream.kind} onValueChange={(next) => updateUpstream(index, { kind: next as GatewayUpstream["kind"] })} options={[{ value: "secret", label: t("gateway.kindSecret") }, { value: "omp-auth-gateway", label: t("gateway.kindOmpAuth") }]} ariaLabel={t("gateway.ariaAuthKind")} /><input value={upstream.credentialId ?? ""} onChange={(event) => updateUpstream(index, { credentialId: event.target.value || undefined })} className="upstream-credential" placeholder={t("gateway.credentialId")} aria-label={t("gateway.credentialId")} /><button className="icon-button subtle danger" title={t("gateway.deleteUpstream")} onClick={() => setDraft((current) => current ? { ...current, upstreams: current.upstreams.filter((_, itemIndex) => itemIndex !== index) } : current)} disabled={draft.upstreams.length <= 1}><Trash2 size={14} /></button></div>)}</div><div className="drawer-actions"><button className="primary-button" onClick={() => void saveDraft()} disabled={loading || readOnly}><Save size={15} />{t("common.save")}</button>{status.running ? <button className="secondary-button" onClick={() => void stop()} disabled={loading}><Square size={14} />{t("gateway.stop")}</button> : <button className="secondary-button" onClick={() => void start()} disabled={loading || readOnly}><Play size={14} />{t("gateway.start")}</button>}</div>{token ? <label className="module-field"><span>{t("gateway.bearerToken")}</span><input className="mono" readOnly value={token} onFocus={(event) => event.currentTarget.select()} /></label> : null}{status.upstreams.length > 0 ? <div className="upstream-list"><div className="drawer-section-title"><span>{t("gateway.upstreamStatus")}</span></div>{status.upstreams.map((stat) => <div className="upstream-row" key={`${stat.poolId}:${stat.upstreamId}`}><span className="mono">{stat.upstreamId}</span><span className={`status-chip ${stat.consecutiveFailures > 0 ? "warn" : "ok"}`}>{stat.lastStatus ?? "ERR"}</span><span className="muted-line">{stat.lastLatencyMs !== undefined ? `${stat.lastLatencyMs} ms` : "—"}</span><span className="muted-line">{stat.consecutiveFailures > 0 ? t("gateway.consecutiveFailures", { count: stat.consecutiveFailures }) : formatDateTime(stat.lastAt)}</span></div>)}</div> : null}</> : <div className="module-empty compact-empty"><span className="empty-glyph"><CircleAlert size={26} /></span><strong>{t("gateway.selectPrompt")}</strong><span className="empty-desc">{t("gateway.selectHint")}</span></div>}</div>
    </div>
  </section>;
}

export function ProjectOverlayBadge({ api, profileId, onNotice }: { api: AppApi; profileId: string; onNotice: (notice: Notice) => void }): ReactElement {
  const { t } = useTranslation();
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
    try { await navigator.clipboard.writeText(text); onNotice({ tone: "success", text: t("project.patchCopied") }); } catch { onNotice({ tone: "error", text: t("project.copyFailed") }); }
  }

  if (!context) return <span className="muted-line">{t("project.reading")}</span>;
  const { overlay, precedence } = context;
  return <div className="project-overlay">
    <div className="project-overlay-head">
      {overlay ? <span className="status-chip neutral">{t("project.hasOverlay")}</span> : <span className="status-chip neutral">{t("project.noOverlay")}</span>}
      {/* A packaged GUI's cwd is wherever the shortcut ran, so an unconfirmed root is called out. */}
      {!context.explicit ? <span className="status-chip warn" title={t("project.inferredTitle")}>{t("project.inferredDir")}</span> : null}
      <button className="secondary-button" onClick={() => void chooseRoot()} disabled={busy}><FolderOpen size={14} />{t("project.chooseDir")}</button>
    </div>
    <span className="muted-line mono break">{context.root}</span>
    {overlay ? <div className="project-overlay-actions">
      <button className="secondary-button" onClick={() => void copyPatch()}><Download size={14} />{t("project.copyPatch")}</button>
      {overlay.diagnostics.length ? <span className="status-chip danger"><CircleAlert size={13} />{overlay.diagnostics.length}</span> : <span className="status-chip ok"><Check size={13} />{t("project.normal")}</span>}
    </div> : null}
    {precedence.map((item, index) => <span key={`${item.code}-${index}`} className={`muted-line ${item.severity === "warning" ? "warn-line" : ""}`}>{item.message}</span>)}
  </div>;
}
