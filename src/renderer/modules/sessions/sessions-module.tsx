import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Copy,
  Download,
  FileCode,
  FileText,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type {
  SessionMessagePreview,
  SessionRefreshStats,
  SessionSearchResult,
  SessionSummary,
} from "@omp-switch/core";
import { useTranslation } from "react-i18next";
import { formatDateTime, formatClock } from "../../locale";
import {
  generateSessionHtml,
  generateSessionJson,
  generateSessionMarkdown,
} from "./session-export";

type AppApi = NonNullable<Window["ompSwitch"]>;
type Notice = { tone: "success" | "error" | "info"; text: string };

interface SessionsModuleProps {
  api: AppApi;
  profileId: string;
  readOnly?: boolean;
  onNotice: (notice: Notice) => void;
}

type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "thinking"; text: string };

function splitMessageSegments(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  function parseFences(str: string) {
    const fence = /(^|\n)```([^\n`]*)\n([\s\S]*?)(```|$)/g;
    let subLast = 0;
    let fMatch: RegExpExecArray | null;
    while ((fMatch = fence.exec(str)) !== null) {
      if (fMatch.index > subLast) {
        segments.push({ kind: "text", text: str.slice(subLast, fMatch.index) });
      }
      segments.push({ kind: "code", lang: fMatch[2]?.trim() || "text", text: fMatch[3] ?? "" });
      subLast = fence.lastIndex;
    }
    if (subLast < str.length) {
      segments.push({ kind: "text", text: str.slice(subLast) });
    }
  }

  while ((match = thinkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parseFences(text.slice(lastIndex, match.index));
    }
    if (match[1]?.trim()) {
      segments.push({ kind: "thinking", text: match[1].trim() });
    }
    lastIndex = thinkRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parseFences(text.slice(lastIndex));
  }

  return segments;
}

function ThinkingBlock({ text }: { text: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const charCount = text.length;

  return (
    <div className="thinking-block">
      <button
        type="button"
        className="thinking-toggle-bar"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="thinking-icon"><Sparkles size={13} /></span>
        <span className="thinking-label">
          {t("sessions.thinkingChain")} <small className="thinking-count">({charCount} {t("sessions.chars")})</small>
        </span>
        <span className="thinking-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {open ? <div className="thinking-content">{text}</div> : null}
    </div>
  );
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="msg-code-block">
      <div className="msg-code-header">
        <span>{lang || "code"}</span>
        <button type="button" className="icon-button subtle" onClick={handleCopy} title="Copy code">
          <Copy size={12} />
          {copied ? " Copied" : ""}
        </button>
      </div>
      <pre className="msg-code-body"><code>{text}</code></pre>
    </div>
  );
}

function MessageBubble({ message }: { message: SessionMessagePreview }) {
  const isUser = message.role === "user";
  const segments = useMemo(() => splitMessageSegments(message.text), [message.text]);

  return (
    <div className={`session-bubble ${isUser ? "user" : "assistant"}`}>
      <div className="session-bubble-meta">
        <span className="session-role-tag">{isUser ? "User" : message.role === "assistant" ? "Assistant" : message.role}</span>
        {message.timestamp ? <span className="session-bubble-time">{formatClock(message.timestamp)}</span> : null}
      </div>
      <div className="session-bubble-body">
        {segments.map((seg, i) => {
          if (seg.kind === "thinking") {
            return <ThinkingBlock key={i} text={seg.text} />;
          }
          if (seg.kind === "code") {
            return <CodeBlock key={i} lang={seg.lang} text={seg.text} />;
          }
          return <span key={i} className="session-text-seg">{seg.text}</span>;
        })}
      </div>
    </div>
  );
}

export function renderSafeSnippet(snippet: string): ReactElement | null {
  if (!snippet) return null;
  const parts = snippet.split(/(<mark>[\s\S]*?<\/mark>)/g);
  return (
    <span className="fts-snippet">
      {parts.map((part, index) => {
        if (part.startsWith("<mark>") && part.endsWith("</mark>")) {
          return <mark key={index}>{part.slice(6, -7)}</mark>;
        }
        return <span key={index}>{part}</span>;
      })}
    </span>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function triggerDownload(filename: string, content: string, type = "text/plain;charset=utf-8"): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SessionsModule({ api, profileId, onNotice }: SessionsModuleProps): ReactElement {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<SessionSummary | null>(null);
  const [messages, setMessages] = useState<SessionMessagePreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshStats, setRefreshStats] = useState<SessionRefreshStats | null>(null);
  const [invalidLines, setInvalidLines] = useState(0);
  const [listCursor, setListCursor] = useState<string | undefined>(undefined);
  const [messageCursor, setMessageCursor] = useState<string | undefined>(undefined);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [ftsResults, setFtsResults] = useState<SessionSearchResult[]>([]);
  const [ftsActive, setFtsActive] = useState(false);

  async function refresh(rebuild = false): Promise<void> {
    setLoading(true);
    try {
      const stats = await api.refreshSessions(profileId, { rebuild });
      setRefreshStats(stats);
      const firstPage = await api.listSessions(profileId, { limit: 50 });
      setEntries(firstPage.sessions);
      setListCursor(firstPage.nextCursor);
      const usage = await api.usageSummary(profileId);
      setInvalidLines(usage.invalidLines);
      if (selected) {
        const found = firstPage.sessions.find((s) => s.id === selected.id);
        if (found) setSelected(found);
      }
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [profileId]);

  // Full-text search trigger
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setFtsResults([]);
      setFtsActive(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const results = await api.searchSessionFts(profileId, query);
        if (!cancelled) {
          setFtsResults(results);
          setFtsActive(true);
        }
      } catch {
        if (!cancelled) setFtsResults([]);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, profileId, api]);

  async function loadMoreSessions(): Promise<void> {
    if (!listCursor || loading) return;
    setLoading(true);
    try {
      const page = await api.listSessions(profileId, { cursor: listCursor, limit: 50 });
      setEntries((prev) => [...prev, ...page.sessions]);
      setListCursor(page.nextCursor);
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function openEntry(entry: SessionSummary): Promise<void> {
    setSelected(entry);
    setLoading(true);
    try {
      const page = await api.readSessionMessages(profileId, entry.id);
      setMessages(page.messages);
      setHasMoreMessages(page.hasMore);
      setMessageCursor(page.nextCursor);
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function loadEarlier(): Promise<void> {
    if (!selected || !messageCursor || loading) return;
    setLoading(true);
    try {
      const page = await api.readSessionMessages(profileId, selected.id, { cursor: messageCursor });
      setMessages((prev) => [...page.messages, ...prev]);
      setHasMoreMessages(page.hasMore);
      setMessageCursor(page.nextCursor);
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  const ftsSessionIdSet = useMemo(() => new Set(ftsResults.map((r) => r.sessionId)), [ftsResults]);

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const query = searchQuery.trim().toLowerCase();
    return entries.filter((e) =>
      ftsSessionIdSet.has(e.id) ||
      (e.title && e.title.toLowerCase().includes(query)) ||
      (e.model && e.model.toLowerCase().includes(query)) ||
      (e.provider && e.provider.toLowerCase().includes(query)) ||
      e.id.toLowerCase().includes(query)
    );
  }, [entries, searchQuery, ftsSessionIdSet]);

  async function copySessionMarkdown(): Promise<void> {
    if (!selected) return;
    const md = generateSessionMarkdown(selected, messages);
    try {
      await navigator.clipboard.writeText(md);
      onNotice({ tone: "success", text: t("sessions.copiedMarkdown") });
    } catch (err) {
      onNotice({ tone: "error", text: String(err) });
    }
  }

  function downloadSession(format: "md" | "html" | "json"): void {
    if (!selected) return;
    const idSnippet = selected.id.slice(0, 8);
    if (format === "html") {
      const html = generateSessionHtml(selected, messages);
      triggerDownload(`session-${idSnippet}.html`, html, "text/html;charset=utf-8");
      onNotice({ tone: "success", text: t("sessions.downloadedHtml") });
    } else if (format === "json") {
      const json = generateSessionJson(selected, messages);
      triggerDownload(`session-${idSnippet}.json`, json, "application/json;charset=utf-8");
      onNotice({ tone: "success", text: t("sessions.downloadedJson") });
    } else {
      const md = generateSessionMarkdown(selected, messages);
      triggerDownload(`session-${idSnippet}.md`, md, "text/markdown;charset=utf-8");
      onNotice({ tone: "success", text: t("sessions.downloadedMarkdown") });
    }
  }

  const summary = useMemo(() => entries.reduce((result, entry) => {
    for (const [key, value] of Object.entries(entry.tokens)) result.tokens[key] = (result.tokens[key] ?? 0) + value;
    result.cost += entry.cost;
    result.failures += entry.failures;
    return result;
  }, { tokens: {} as Record<string, number>, cost: 0, failures: 0 }), [entries]);

  return (
    <section className="module-view module-shell">
      <div className="workspace-heading module-heading">
        <div>
          <span className="eyebrow">{profileId}</span>
          <h1>{t("sessions.heading")}<span className="heading-count">{entries.length}</span></h1>
        </div>
        <div className="heading-actions">
          <button className="icon-button" title={t("sessions.refreshIndex")} onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} />
          </button>
          <button className="secondary-button" onClick={() => void refresh(true)} disabled={loading}>
            {t("sessions.rebuildIndex")}
          </button>
        </div>
      </div>
      <div className="metric-strip">
        <span><strong>{entries.length}</strong>{t("sessions.metricSessions")}</span>
        <span><strong>{Object.values(summary.tokens).reduce((a, b) => a + b, 0).toLocaleString()}</strong>{t("sessions.metricTokens")}</span>
        <span><strong>${summary.cost.toFixed(4)}</strong>{t("sessions.metricCost")}</span>
        <span className={summary.failures ? "metric-danger" : ""}><strong>{summary.failures}</strong>{t("sessions.metricFailures")}</span>
        {invalidLines ? <span className="metric-warning"><strong>{invalidLines}</strong>{t("sessions.metricInvalidLines")}</span> : null}
        {refreshStats?.errors ? <span className="metric-warning"><strong>{refreshStats.errors}</strong>{t("sessions.metricFileErrors")}</span> : null}
      </div>
      {refreshStats ? (
        <span className="muted-line">
          {(() => {
            const parts = [
              `${t("sessions.statsDiscovered")} ${refreshStats.discovered}`,
              `${t("sessions.statsSkipped")} ${refreshStats.skipped}`,
              `${t("sessions.statsReused")} ${refreshStats.reused}`,
              `${t("sessions.statsChanged")} ${refreshStats.changed}`,
              `${t("sessions.statsRebuilt")} ${refreshStats.rebuilt}`,
              `${t("sessions.statsScanned")} ${formatBytes(refreshStats.scannedBytes)}`,
            ];
            if (refreshStats.diagnostics?.[0]) parts.push(refreshStats.diagnostics[0].message);
            return parts.join(" · ");
          })()}
        </span>
      ) : null}
      <div className="module-columns sessions-columns">
        <div className="module-list-panel session-list">
          <div className="session-search-bar">
            <Search size={14} className="session-search-icon" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("sessions.searchSessions")}
              aria-label={t("sessions.searchSessions")}
            />
            {searchQuery ? (
              <button className="icon-button subtle" onClick={() => setSearchQuery("")} title={t("common.clear")}>
                <X size={13} />
              </button>
            ) : null}
          </div>
          {ftsActive && ftsResults.length > 0 ? (
            <div className="fts-match-banner">
              <span>{t("sessions.ftsFound", { count: ftsResults.length })}</span>
            </div>
          ) : null}
          {entries.length === 0 && loading ? (
            <div className="list-skel">
              {[0, 1, 2, 3, 4].map((index) => <div key={index} className="skeleton skeleton-row" />)}
            </div>
          ) : entries.length === 0 ? (
            <div className="module-empty compact-empty">
              <span className="empty-glyph"><Archive size={26} /></span>
              <strong>
                {refreshStats?.rootMissing
                  ? t("sessions.emptyRootMissing")
                  : refreshStats?.phase === "quick"
                  ? t("sessions.emptyIndexing")
                  : refreshStats?.errors
                  ? t("sessions.emptyPartialErrors")
                  : t("sessions.emptyNoSessions")}
              </strong>
              <span className="empty-desc">
                {refreshStats?.rootMissing ? t("sessions.emptyRootMissingHint") : t("sessions.emptyHint")}
              </span>
              <div className="empty-actions">
                <button className="secondary-button" onClick={() => void refresh()} disabled={loading}>
                  <RefreshCw size={15} />{t("sessions.scan")}
                </button>
              </div>
            </div>
          ) : (
            <>
              {filteredEntries.map((entry) => {
                const ftsMatch = ftsResults.find((r) => r.sessionId === entry.id);
                return (
                  <button
                    key={entry.id}
                    className={"module-list-row session-row " + (selected?.id === entry.id ? "active" : "")}
                    onClick={() => void openEntry(entry)}
                  >
                    <span className="module-row-main">
                      <strong>{entry.title ?? entry.model ?? t("sessions.unnamed")}</strong>
                      <small>{entry.provider ?? "—"} · {formatDateTime(entry.lastActiveAt ?? entry.startedAt)} · {t("sessions.messageCount", { count: entry.messageCount })}</small>
                      {ftsMatch ? renderSafeSnippet(ftsMatch.snippet) : null}
                    </span>
                    <span className={"status-chip " + (entry.stale ? "warn" : entry.failures ? "danger" : "neutral")}>
                      {entry.stale ? t("sessions.stale") : entry.failures ? t("sessions.failures", { count: entry.failures }) : t("sessions.indexed")}
                    </span>
                  </button>
                );
              })}
              {listCursor && !searchQuery ? (
                <button className="secondary-button full-width" onClick={() => void loadMoreSessions()} disabled={loading}>
                  {t("sessions.loadMore")}
                </button>
              ) : null}
            </>
          )}
        </div>
        <div className="module-editor-panel session-detail">
          {selected ? (
            <>
              <div className="editor-head">
                <div>
                  <span className="eyebrow">{t("sessions.heading")}</span>
                  <strong>{selected.title ?? selected.model ?? t("sessions.heading")}</strong>
                </div>
                <div className="drawer-actions">
                  <button className="secondary-button" onClick={() => void copySessionMarkdown()} title={t("sessions.copyMarkdown")}>
                    <Copy size={14} />{t("sessions.copyMarkdown")}
                  </button>
                  <button className="icon-button" onClick={() => downloadSession("html")} title={t("sessions.downloadHtml")}>
                    <FileCode size={15} />
                  </button>
                  <button className="icon-button" onClick={() => downloadSession("md")} title={t("sessions.downloadMarkdown")}>
                    <FileText size={15} />
                  </button>
                  <button className="icon-button" onClick={() => downloadSession("json")} title={t("sessions.downloadJson")}>
                    <Download size={15} />
                  </button>
                </div>
              </div>
              <div className="session-messages">
                {hasMoreMessages ? (
                  <div className="session-load-earlier">
                    <button className="secondary-button compact" onClick={() => void loadEarlier()} disabled={loading}>
                      <ChevronUp size={14} />{t("sessions.loadEarlier")}
                    </button>
                  </div>
                ) : null}
                {messages.length ? (
                  messages.map((message) => <MessageBubble key={message.id} message={message} />)
                ) : (
                  <div className="muted-line session-msg-loading">{t("common.loading")}…</div>
                )}
              </div>
              <span className="muted-line session-detail-footer">
                {formatBytes(selected.fileSize)} · {formatDateTime(selected.lastActiveAt ?? selected.startedAt)}
              </span>
            </>
          ) : (
            <div className="module-empty compact-empty">
              <span className="empty-glyph"><CircleAlert size={26} /></span>
              <strong>{t("sessions.selectPrompt")}</strong>
              <span className="empty-desc">{t("sessions.selectHint")}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
