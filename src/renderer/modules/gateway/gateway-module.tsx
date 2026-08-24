import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Play,
  Plus,
  RefreshCw,
  Save,
  Square,
  Trash2,
} from "lucide-react";
import type {
  GatewayPool,
  GatewayUpstream,
  GatewayUpstreamHealth,
  GatewayUpstreamStat,
  OmpProvider,
} from "@omp-switch/core";
import { ModelPicker } from "../../components/model-picker";
import { StyledSelect, Tip } from "../../components/ui-primitives";
import { useTranslation } from "react-i18next";
import { formatDateTime, formatClock } from "../../locale";

type AppApi = NonNullable<Window["ompSwitch"]>;
type Notice = { tone: "success" | "error" | "info"; text: string };

interface GatewayProps {
  api: AppApi;
  profileId: string;
  readOnly: boolean;
  onNotice: (notice: Notice) => void;
  providers: Array<[string, OmpProvider]>;
}

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
  const [healthMap, setHealthMap] = useState<Record<string, GatewayUpstreamHealth>>({});

  const [loading, setLoading] = useState(false);
  const [probingAll, setProbingAll] = useState(false);
  const modelOptions = useMemo(() => providers.flatMap(([providerId, provider]) => (Array.isArray(provider.models) ? provider.models : []).map((model) => ({ providerId, modelId: model.id, label: `${providerId}/${model.id}` }))), [providers]);

  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      setPools(await api.listGatewayPools(profileId));
      setStatus(await api.gatewayStatus());
      const health = await api.gatewayHealth();
      setHealthMap(health);
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

  function moveUpstream(index: number, direction: "up" | "down"): void {
    setDraft((current) => {
      if (!current) return current;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.upstreams.length) return current;
      const next = [...current.upstreams];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return { ...current, upstreams: next };
    });
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

  const [probingUpstreamId, setProbingUpstreamId] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<Record<string, { ok: boolean; status?: number; latencyMs: number; error?: string }>>({});

  async function testProbe(upstream: GatewayUpstream): Promise<void> {
    if (!draft) return;
    setProbingUpstreamId(upstream.id);
    try {
      const res = await api.probeGatewayUpstream(profileId, draft.id, upstream.id);
      setProbeResults((current) => ({ ...current, [upstream.id]: res }));
      const updatedHealth = await api.gatewayHealth(draft.id);
      setHealthMap((current) => ({ ...current, ...updatedHealth }));
      if (res.ok) {
        onNotice({ tone: "success", text: t("gateway.probeSuccess", { id: upstream.id, latency: res.latencyMs }) });
      } else {
        onNotice({ tone: "error", text: t("gateway.probeFailed", { id: upstream.id, error: res.error || "Error" }) });
      }
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setProbingUpstreamId(null);
    }
  }

  async function probeAll(): Promise<void> {
    if (!draft) return;
    setProbingAll(true);
    let okCount = 0;
    try {
      for (const upstream of draft.upstreams) {
        if (!upstream.enabled) continue;
        setProbingUpstreamId(upstream.id);
        try {
          const res = await api.probeGatewayUpstream(profileId, draft.id, upstream.id);
          setProbeResults((current) => ({ ...current, [upstream.id]: res }));
          if (res.ok) okCount++;
        } catch {
          // continue
        }
      }
      const updatedHealth = await api.gatewayHealth(draft.id);
      setHealthMap((current) => ({ ...current, ...updatedHealth }));
      onNotice({ tone: "success", text: t("gateway.probeAllFinished", { count: draft.upstreams.length, ok: okCount }) });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setProbingUpstreamId(null);
      setProbingAll(false);
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

  return (
    <section className="module-view module-shell">
      <div className="workspace-heading module-heading">
        <div>
          <span className="eyebrow">{profileId}</span>
          <h1>{t("gateway.heading")}<span className="heading-count">{pools.length}</span></h1>
        </div>
        <div className="heading-actions">
          <span className={`status-chip ${status.running ? "ok" : "neutral"}`}>
            {status.running ? t("gateway.running", { port: status.port }) : t("gateway.stoppedBadge")}
          </span>
          <button className="icon-button" title={t("common.refresh")} onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} />
          </button>
          <button className="primary-button" onClick={() => setDraft(makeGatewayPool(profileId, providers))} disabled={readOnly}>
            <Plus size={16} />{t("common.add")}
          </button>
        </div>
      </div>
      <div className="gateway-layout">
        <div className="module-list-panel">
          {pools.length === 0 ? (
            <div className="module-empty compact-empty">
              <span className="empty-glyph"><CircleAlert size={26} /></span>
              <strong>{t("gateway.empty")}</strong>
              <span className="empty-desc">{t("gateway.emptyHint")}</span>
              <div className="empty-actions">
                <button className="primary-button" onClick={() => setDraft(makeGatewayPool(profileId, providers))} disabled={readOnly}>
                  <Plus size={15} />{t("gateway.newPool")}
                </button>
              </div>
            </div>
          ) : (
            pools.map((pool) => (
              <button key={pool.id} className={`module-list-row ${draft?.id === pool.id ? "active" : ""}`} onClick={() => setDraft(pool)}>
                <span className="module-row-main">
                  <strong>{pool.virtualModel}</strong>
                  <small>{pool.id} · {t("gateway.upstreamCount", { count: pool.upstreams.length })} · {pool.port}</small>
                </span>
                <span className={`status-chip ${pool.enabled ? "ok" : "neutral"}`}>
                  {pool.enabled ? t("gateway.enabled") : t("gateway.disabled")}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="module-editor-panel gateway-editor">
          {draft ? (
            <>
              <div className="editor-head">
                <div>
                  <span className="eyebrow">{t("gateway.pool")}</span>
                  <strong>{draft.id}</strong>
                </div>
                <div className="drawer-actions">
                  <button className="secondary-button" onClick={() => setDraft(null)}>{t("common.close")}</button>
                </div>
              </div>
              <div className="form-two">
                <label className="module-field">
                  <span>{t("gateway.fieldId")}</span>
                  <input value={draft.id} onChange={(event) => updateDraft("id", event.target.value)} disabled={Boolean(pools.find((pool) => pool.id === draft.id))} />
                </label>
                <label className="module-field">
                  <span>{t("gateway.fieldPort")}</span>
                  <input inputMode="numeric" value={draft.port} onChange={(event) => updateDraft("port", Number(event.target.value) || 0)} />
                </label>
              </div>
              <label className="module-field">
                <span>{t("gateway.fieldVirtualModel")}</span>
                <input value={draft.virtualModel} onChange={(event) => updateDraft("virtualModel", event.target.value)} placeholder="omp-switch/default" />
              </label>
              <label className="check-line module-check">
                <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft("enabled", event.target.checked)} />
                {t("gateway.enabled")}
              </label>
              <div className="upstream-list">
                <div className="drawer-section-title">
                  <span>{t("gateway.upstreams")}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      className="secondary-button compact"
                      title={t("gateway.probeAll")}
                      onClick={() => void probeAll()}
                      disabled={loading || probingAll}
                    >
                      <Activity size={13} className={probingAll ? "spin" : ""} />
                      <span>{t("gateway.probeAll")}</span>
                    </button>
                    <button
                      className="icon-button"
                      title={t("gateway.addUpstream")}
                      onClick={() => setDraft((current) => current ? { ...current, upstreams: [...current.upstreams, { id: `upstream-${current.upstreams.length + 1}`, providerId: providers[0]?.[0] ?? "", modelId: modelOptions[0]?.modelId ?? "", kind: "secret", enabled: true }] } : current)}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </div>
                {draft.upstreams.map((upstream, index) => {
                  const healthKey = `${draft.id}:${upstream.id}`;
                  const health = healthMap[healthKey];
                  const probeResult = probeResults[upstream.id];
                  const healthState = health?.healthState ?? (probeResult ? (probeResult.ok ? "healthy" : "unhealthy") : "untested");
                  const latency = probeResult?.latencyMs ?? health?.lastLatencyMs;

                  return (
                    <div className="upstream-row" key={upstream.id}>
                      <div className="upstream-reorder-buttons">
                        <button type="button" className="icon-button subtle" title={t("gateway.moveUpstreamUp")} disabled={index === 0} onClick={() => moveUpstream(index, "up")}>
                          <ChevronUp size={13} />
                        </button>
                        <button type="button" className="icon-button subtle" title={t("gateway.moveUpstreamDown")} disabled={index === draft.upstreams.length - 1} onClick={() => moveUpstream(index, "down")}>
                          <ChevronDown size={13} />
                        </button>
                      </div>
                      <input value={upstream.id} onChange={(event) => updateUpstream(index, { id: event.target.value })} aria-label={t("gateway.ariaUpstreamId")} />
                      <ModelPicker
                        providers={providers}
                        value={upstream.providerId && upstream.modelId ? `${upstream.providerId}/${upstream.modelId}` : ""}
                        onValueChange={(next) => {
                          const slash = next.indexOf("/");
                          if (slash < 0) return;
                          updateUpstream(index, { providerId: next.slice(0, slash), modelId: next.slice(slash + 1) });
                        }}
                        ariaLabel={t("gateway.ariaProviderModel")}
                      />
                      <StyledSelect
                        value={upstream.kind}
                        onValueChange={(next) => updateUpstream(index, { kind: next as GatewayUpstream["kind"] })}
                        options={[{ value: "secret", label: t("gateway.kindSecret") }, { value: "omp-auth-gateway", label: t("gateway.kindOmpAuth") }]}
                        ariaLabel={t("gateway.ariaAuthKind")}
                      />
                      <input
                        value={upstream.credentialId ?? ""}
                        onChange={(event) => updateUpstream(index, { credentialId: event.target.value || undefined })}
                        className="upstream-credential"
                        placeholder={t("gateway.credentialId")}
                        aria-label={t("gateway.credentialId")}
                      />
                      <button
                        type="button"
                        className={`icon-button subtle ${probeResult?.ok ? "ok" : ""}`}
                        title={t("gateway.probeUpstream")}
                        onClick={() => void testProbe(upstream)}
                        disabled={loading || probingUpstreamId === upstream.id || probingAll}
                      >
                        <Activity size={14} className={probingUpstreamId === upstream.id ? "spin" : ""} />
                      </button>
                      <Tip
                        label={
                          <div className="tip-stack">
                            <span className="tip-stack-date">{t(`gateway.health.${healthState}`)}</span>
                            {latency !== undefined ? (
                              <span className="tip-stack-value">{latency} ms {probeResult?.status ? `(HTTP ${probeResult.status})` : ""}</span>
                            ) : null}
                            {health?.lastProbeAt ? (
                              <span className="tip-stack-sub">{formatDateTime(health.lastProbeAt)}</span>
                            ) : null}
                            {health?.recentHistory && health.recentHistory.length > 0 ? (
                              <div className="health-history-list">
                                {health.recentHistory.slice(0, 5).map((h, i) => (
                                  <div key={i} className={`health-history-item ${h.ok ? "ok" : "err"}`}>
                                    <span>{h.ok ? "✓" : "✗"} {h.status ? `HTTP ${h.status}` : (h.error || "ERR")}</span>
                                    <span>{h.latencyMs}ms</span>
                                    <span>{formatClock(h.timestamp)}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        }
                      >
                        <span className={`health-badge ${healthState}`}>
                          <span
                            className="status-led"
                            style={{
                              background:
                                healthState === "healthy"
                                ? "var(--ok)"
                                : healthState === "degraded"
                                ? "var(--warn)"
                                : healthState === "unhealthy"
                                ? "var(--danger)"
                                : "var(--muted)",
                            }}
                          />
                          <span>{latency !== undefined ? `${latency}ms` : t("gateway.untested")}</span>
                        </span>
                      </Tip>
                      <button
                        className="icon-button subtle danger"
                        title={t("gateway.deleteUpstream")}
                        onClick={() => setDraft((current) => current ? { ...current, upstreams: current.upstreams.filter((_, itemIndex) => itemIndex !== index) } : current)}
                        disabled={draft.upstreams.length <= 1}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="drawer-actions">
                <button className="primary-button" onClick={() => void saveDraft()} disabled={loading || readOnly}>
                  <Save size={15} />{t("common.save")}
                </button>
                {status.running ? (
                  <button className="secondary-button" onClick={() => void stop()} disabled={loading}>
                    <Square size={14} />{t("gateway.stop")}
                  </button>
                ) : (
                  <button className="secondary-button" onClick={() => void start()} disabled={loading || readOnly}>
                    <Play size={14} />{t("gateway.start")}
                  </button>
                )}
              </div>
              {token ? (
                <label className="module-field">
                  <span>{t("gateway.bearerToken")}</span>
                  <input className="mono" readOnly value={token} onFocus={(event) => event.currentTarget.select()} />
                </label>
              ) : null}
              {status.upstreams.length > 0 ? (
                <div className="upstream-list">
                  <div className="drawer-section-title">
                    <span>{t("gateway.upstreamStatus")}</span>
                  </div>
                  {status.upstreams.map((stat) => (
                    <div className="upstream-row" key={`${stat.poolId}:${stat.upstreamId}`}>
                      <span className="mono">{stat.upstreamId}</span>
                      <span className={`status-chip ${stat.consecutiveFailures > 0 ? "warn" : "ok"}`}>
                        {stat.lastStatus ?? "ERR"}
                      </span>
                      <span className="muted-line">{stat.lastLatencyMs !== undefined ? `${stat.lastLatencyMs} ms` : "—"}</span>
                      <span className="muted-line">
                        {stat.consecutiveFailures > 0 ? t("gateway.consecutiveFailures", { count: stat.consecutiveFailures }) : formatDateTime(stat.lastAt)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="module-empty compact-empty">
              <span className="empty-glyph"><CircleAlert size={26} /></span>
              <strong>{t("gateway.selectPrompt")}</strong>
              <span className="empty-desc">{t("gateway.selectHint")}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
