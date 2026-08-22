import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Coins, ChevronRight, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import type { ModelPrice, UsageBucket } from "@omp-switch/core";
import { Tip } from "./components/ui-primitives";

type AppApi = NonNullable<Window["ompSwitch"]>;
type Notice = { tone: "success" | "error" | "info"; text: string };

interface UsageModuleProps {
  api: AppApi;
  profileId: string;
  onNotice: (notice: Notice) => void;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

/** Compact signed count for tooltip totals. */
function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * Which cost to show. OMP records a per-turn cost and that is authoritative; local pricing is only a
 * fallback, because a models.yml without `cost:` entries would otherwise report a confident $0.
 */
function bucketCost(bucket: UsageBucket): { value: number; source: "recorded" | "computed" | "none" } {
  if (bucket.recordedCost > 0) return { value: bucket.recordedCost, source: "recorded" };
  if (bucket.pricedRequests > 0) return { value: bucket.computedCost, source: "computed" };
  return { value: 0, source: "none" };
}

/** Cache hit rate: cache reads over cache reads + fresh inputs. 0 when there is no cache traffic. */
function cacheHitRate(bucket: UsageBucket): number | null {
  const denom = bucket.tokens.cacheRead + bucket.tokens.input;
  if (denom === 0) return null;
  return bucket.tokens.cacheRead / denom;
}

type TrendMetric = "cost" | "requests" | "tokens";

const TREND_METRICS: Array<{ key: TrendMetric; label: string }> = [
  { key: "cost", label: "usage.metricCost" },
  { key: "requests", label: "usage.metricRequests" },
  { key: "tokens", label: "usage.metricTokens" },
];

function dayMetric(day: UsageBucket, metric: TrendMetric): number {
  if (metric === "cost") return bucketCost(day).value;
  if (metric === "requests") return day.requests;
  return day.tokens.total;
}

/**
 * Apple-style area chart, hand-written in SVG. One gradient fill under a thin line; a hovered day
 * shows a vertical guide, a dot, and a Radix tooltip card with the exact figures. Days with a zero
 * value still get a hit target so the tooltip can explain a quiet day instead of being unhoverable.
 */
function TrendArea({ days, metric }: { days: UsageBucket[]; metric: TrendMetric }): ReactElement | null {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  if (days.length === 0) return null;

  const width = 640;
  const height = 180;
  const padX = 16;
  const padTop = 14;
  const padBottom = 24;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;

  const values = days.map((day) => dayMetric(day, metric));
  const peak = Math.max(...values, Number.EPSILON);
  const stepX = days.length > 1 ? plotW / (days.length - 1) : 0;

  const xAt = (i: number) => padX + (days.length > 1 ? i * stepX : plotW / 2);
  const yAt = (value: number) => padTop + plotH - (value / peak) * plotH;

  const linePath = days.map((day, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)},${yAt(dayMetric(day, metric)).toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${xAt(days.length - 1).toFixed(2)},${(padTop + plotH).toFixed(2)} L${xAt(0).toFixed(2)},${(padTop + plotH).toFixed(2)} Z`;

  // First / middle / last day labels, to avoid crowding on long ranges.
  const labelEvery = days.length <= 10 ? 1 : Math.ceil(days.length / 8);
  const showLabel = (i: number) => i % labelEvery === 0 || i === days.length - 1;

  return <div className="usage-trend">
    <svg className="usage-trend-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={t("usage.trendAria", { metric: t(TREND_METRICS.find((m) => m.key === metric)!.label) })}>
      <defs>
        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop className="trend-stop-top" offset="0%" stopColor="var(--trend-top)" />
          <stop className="trend-stop-bottom" offset="100%" stopColor="var(--trend-bottom)" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#trend-fill)" />
      <path d={linePath} fill="none" stroke="var(--trend-top)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {hover !== null && (
        <>
          <line x1={xAt(hover).toFixed(2)} y1={padTop} x2={xAt(hover).toFixed(2)} y2={padTop + plotH} className="usage-trend-guide" />
          <circle cx={xAt(hover).toFixed(2)} cy={yAt(dayMetric(days[hover], metric)).toFixed(2)} r="3.5" className="usage-trend-dot" />
        </>
      )}
    </svg>
    {/* Invisible hit targets overlaid on the SVG. Each is a Tip trigger so the exact figures are
        keyboard-reachable and theme-consistent. */}
    <div className="usage-trend-hits">
      {days.map((day, i) => {
        const value = dayMetric(day, metric);
        const metricText = metric === "cost" ? formatUsd(value)
          : metric === "requests" ? `${formatCount(value)}${t("usage.requestsUnit") ? ` ${t("usage.requestsUnit")}` : ""}`
          : `${formatTokens(value)} tokens`;
        return <Tip
          key={day.key}
          label={<div className="tip-stack">
            <span className="tip-stack-date">{day.key}</span>
            <span className="tip-stack-value">{metricText}</span>
            <span className="tip-stack-sub">{t("usage.tipRequests", { count: formatCount(day.requests), tokens: formatTokens(day.tokens.total) })}</span>
          </div>}
        >
          <button
            type="button"
            className="usage-trend-hit"
            aria-label={`${day.key}: ${metricText}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          />
        </Tip>;
      })}
    </div>
    <div className="usage-trend-axis">
      {days.map((day, i) => <span key={day.key} className={showLabel(i) ? "" : "axis-hidden"}>{day.key.slice(5)}</span>)}
    </div>
  </div>;
}

function MiniSpark({ values }: { values: number[] }): ReactElement {
  const { t } = useTranslation();
  if (values.length === 0) return <span className="muted-line">{t("usage.noTrend")}</span>;
  const width = 120;
  const height = 28;
  const peak = Math.max(...values, Number.EPSILON);
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const yAt = (v: number) => height - 2 - (v / peak) * (height - 4);
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
  const area = `${path} L${((values.length - 1) * stepX).toFixed(1)},${height} L0,${height} Z`;
  return <svg className="usage-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
    <path d={area} fill="url(#trend-fill)" />
    <path d={path} fill="none" stroke="var(--trend-top)" strokeWidth="1.5" />
  </svg>;
}

function ExpandableRow({ bucket, totalCost, daySeries, onPrice, isLast }: {
  bucket: UsageBucket;
  totalCost: number;
  daySeries: number[];
  onPrice?: (key: string) => void;
  isLast: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const cost = bucketCost(bucket);
  const costTitle = cost.source === "computed" ? t("usage.costComputed") : cost.source === "none" ? t("usage.costNone") : t("usage.costRecorded");
  const share = totalCost > 0 && cost.source !== "none" ? cost.value / totalCost : 0;
  const hit = cacheHitRate(bucket);
  const tokens = bucket.tokens;
  const computedDelta = bucket.recordedCost > 0 && bucket.pricedRequests > 0
    ? Math.abs(bucket.recordedCost - bucket.computedCost)
    : null;

  return <div className={`usage-row-group${open ? " open" : ""}${isLast ? " last" : ""}`}>
    <button
      type="button"
      className="usage-row"
      onClick={() => setOpen((current) => !current)}
      aria-expanded={open}
    >
      <ChevronRight size={14} className={`usage-row-chevron${open ? " open" : ""}`} />
      <span className="usage-row-key mono" title={bucket.key}>{bucket.key}</span>
      <span className="usage-row-num">{formatCount(bucket.requests)}</span>
      <span className="usage-row-num">{formatTokens(bucket.tokens.total)}</span>
      <span className={`usage-row-num ${cost.source === "computed" ? "warn-line" : ""}`} title={costTitle}>
        {cost.source === "none" ? "—" : formatUsd(cost.value)}
      </span>
      <span className="usage-row-share" title={share > 0 ? `${(share * 100).toFixed(1)}%` : undefined}>
        {share > 0 ? <span className="share-bar"><span className="share-fill" style={{ width: `${Math.max(4, share * 100)}%` }} /></span> : null}
      </span>
      {onPrice ? <span className="usage-row-action" onClick={(event) => { event.stopPropagation(); onPrice(bucket.key); }}>
        <Coins size={14} />
      </span> : <span />}
    </button>
    <div className="usage-row-detail"><div className="detail-inner-clip"><div className="detail-inner">
      <div className="detail-grid">
        <div className="detail-cell"><span className="detail-label">{t("usage.detailInput")}</span><span className="mono">{formatTokens(tokens.input)}</span></div>
        <div className="detail-cell"><span className="detail-label">{t("usage.detailOutput")}</span><span className="mono">{formatTokens(tokens.output)}</span></div>
        <div className="detail-cell"><span className="detail-label">{t("usage.detailCacheRead")}</span><span className="mono">{formatTokens(tokens.cacheRead)}</span></div>
        <div className="detail-cell"><span className="detail-label">{t("usage.detailCacheWrite")}</span><span className="mono">{formatTokens(tokens.cacheWrite)}</span></div>
        <div className="detail-cell"><span className="detail-label">{t("usage.detailReasoning")}</span><span className="mono">{formatTokens(tokens.reasoning)}</span></div>
        <div className="detail-cell">
          <span className="detail-label">{t("usage.cacheHitRate")}</span>
          <span className="mono">{hit === null ? "—" : `${(hit * 100).toFixed(1)}%`}</span>
        </div>
      </div>
      <div className="detail-line">
        <span className="detail-label">{t("usage.dailyTrend")}</span>
        <MiniSpark values={daySeries} />
      </div>
      <div className="detail-meta">
        <span>{t("usage.costSource")}<strong className={cost.source === "computed" ? "warn-line" : ""}>{costTitle}</strong></span>
        {computedDelta !== null ? <span>{t("usage.localComputed", { cost: formatUsd(bucket.computedCost), delta: formatUsd(computedDelta) })}</span> : null}
        <span>{bucket.failures > 0 ? <span className="warn-line">{t("usage.failures", { count: bucket.failures })}</span> : t("usage.noFailures")}</span>
        {bucket.firstAt ? <span>{bucket.firstAt.slice(0, 10)} → {bucket.lastAt?.slice(0, 10)}</span> : null}
      </div>
    </div></div></div>
  </div>;
}

function BreakdownTable({ title, buckets, totalCost, daySeriesByKey, onPrice }: {
  title: string;
  buckets: UsageBucket[];
  totalCost: number;
  daySeriesByKey?: Record<string, UsageBucket[]>;
  onPrice?: (key: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  return <div className="usage-table">
    <div className="drawer-section-title"><span>{title}</span><span className="status-chip neutral">{buckets.length}</span></div>
    <div className="usage-row-head">
      <span className="usage-row-head-spacer" />
      <span>{t("usage.colModel")}</span>
      <span className="usage-row-num">{t("usage.colRequests")}</span>
      <span className="usage-row-num">{t("usage.metricTokens")}</span>
      <span className="usage-row-num">{t("usage.colCost")}</span>
      <span>{t("usage.colShare")}</span>
      <span />
    </div>
    <div className="usage-rows">
      {buckets.length === 0 ? <span className="muted-line">{t("usage.noData")}</span> : buckets.map((bucket, index) =>
        <ExpandableRow
          key={bucket.key}
          bucket={bucket}
          totalCost={totalCost}
          daySeries={(daySeriesByKey?.[bucket.key] ?? []).map((day) => bucketCost(day).value)}
          onPrice={onPrice}
          isLast={index === buckets.length - 1}
        />)}
    </div>
  </div>;
}

export function UsageModule({ api, profileId, onNotice }: UsageModuleProps): ReactElement {
  const { t } = useTranslation();
  const [data, setData] = useState<Awaited<ReturnType<AppApi["usageSummary"]>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [metric, setMetric] = useState<TrendMetric>("cost");
  const [pricing, setPricing] = useState<{ key: string; input: string; output: string; cacheRead: string; cacheWrite: string } | null>(null);
  const requestSequence = useRef(0);

  function isCurrent(sequence: number): boolean {
    return sequence === requestSequence.current;
  }

  async function load(reindex = false, range?: { from?: string; to?: string }): Promise<void> {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const options = { from: range?.from ?? (from || undefined), to: range?.to ?? (to || undefined), reindex };
      const cached = await api.usageSummary(profileId, options);
      if (!isCurrent(sequence)) return;
      setData(cached);
      if (!reindex) {
        await api.refreshSessions(profileId);
        const updated = await api.usageSummary(profileId, options);
        if (!isCurrent(sequence)) return;
        setData(updated);
      }
    } catch (error) {
      if (!isCurrent(sequence)) return;
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (isCurrent(sequence)) setLoading(false);
    }
  }

  useEffect(() => {
    requestSequence.current += 1;
    void load();
  }, [profileId]);

  function openPricing(key: string): void {
    const current = data?.overrides[key] ?? {};
    setPricing({
      key,
      input: current.input?.toString() ?? "",
      output: current.output?.toString() ?? "",
      cacheRead: current.cacheRead?.toString() ?? "",
      cacheWrite: current.cacheWrite?.toString() ?? "",
    });
  }

  async function savePricing(clear = false): Promise<void> {
    if (!pricing) return;
    setLoading(true);
    try {
      let price: ModelPrice | null = null;
      if (!clear) {
        const next: ModelPrice = {};
        for (const field of ["input", "output", "cacheRead", "cacheWrite"] as const) {
          const raw = pricing[field].trim();
          if (!raw) continue;
          const parsed = Number(raw);
          if (!Number.isFinite(parsed) || parsed < 0) throw new Error(t("usage.priceNonNegative", { field }));
          next[field] = parsed;
        }
        price = Object.keys(next).length > 0 ? next : null;
      }
      await api.setUsagePrice(pricing.key, price);
      setPricing(null);
      await load();
      onNotice({ tone: "success", text: price === null ? t("usage.priceCleared") : t("usage.priceSaved") });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  const totals = data?.report.totals;
  const totalCost = totals ? bucketCost(totals) : null;
  const costLabel = totalCost?.source === "recorded" ? t("usage.costRecorded")
    : totalCost?.source === "computed" ? t("usage.costComputed") : t("usage.costNone");
  const cacheHit = totals ? cacheHitRate(totals) : null;
  // Per-model / per-provider daily series drive the in-row cost sparklines. The data layer only
  // carries days with traffic, so quiet gaps simply do not appear — a sparse series is fine for a
  // thumbnail trend.
  const modelDaySeries = data?.report.byModelByDay;
  const providerDaySeries = data?.report.byProviderByDay;

  return <section className="module-view module-shell">
    <div className="workspace-heading module-heading">
      <div><span className="eyebrow">PROFILE</span><h1>{t("usage.heading")}{typeof totals?.requests === "number" ? <span className="heading-count">{totals.requests}</span> : null}</h1></div>
      <div className="heading-actions">
        <div className="mp-seg usage-range">
          {[7, 30, 90].map((days) => <button type="button" key={days} data-active={from === daysAgoIso(days) && !to} onClick={() => { setFrom(daysAgoIso(days)); setTo(""); void load(false, { from: daysAgoIso(days) }); }}>{t("usage.days", { days })}</button>)}
          <button type="button" data-active={!from && !to} onClick={() => { setFrom(""); setTo(""); void load(false, {}); }}>{t("usage.all")}</button>
        </div>
        <input className="usage-date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label={t("usage.startDate")} />
        <input className="usage-date" type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label={t("usage.endDate")} />
        <button className="icon-button" title={t("usage.applyFilter")} onClick={() => void load()} disabled={loading}><Search size={16} /></button>
        <button className="secondary-button" onClick={() => void load(true)} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />{t("usage.reindex")}</button>
      </div>
    </div>

    {!data ? <div className="usage-cards">{[0, 1].map((index) => <div key={index} className="usage-card"><span className="eyebrow">&nbsp;</span><div className="skeleton skeleton-num" /><div className="skeleton skeleton-line" /></div>)}</div> : <div className="usage-layout">
      <div className="usage-cards usage-cards-composite">
        <div className="usage-card usage-card-primary">
          <span className="eyebrow">{t("usage.metricCost")}</span>
          <strong>{totalCost && totalCost.source !== "none" ? formatUsd(totalCost.value) : "—"}</strong>
          <small>{costLabel}{totals && totals.pricedRequests > 0 && totals.recordedCost > 0 ? ` · ${t("usage.estimateSuffix", { cost: formatUsd(totals.computedCost) })}` : ""}</small>
          <div className="token-stack" title={t("usage.tokenBreakdown")}>
            {(() => {
              const tokens = totals?.tokens;
              if (!tokens) return null;
              const totalForStack = Math.max(tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning, 1);
              const segments: Array<{ key: string; value: number; label: string; cls: string }> = [
                { key: "input", value: tokens.input, label: t("usage.tokenInput", { tokens: formatTokens(tokens.input) }), cls: "ts-input" },
                { key: "output", value: tokens.output, label: t("usage.tokenOutput", { tokens: formatTokens(tokens.output) }), cls: "ts-output" },
                { key: "cacheRead", value: tokens.cacheRead, label: t("usage.tokenCacheRead", { tokens: formatTokens(tokens.cacheRead) }), cls: "ts-cache" },
                { key: "cacheWrite", value: tokens.cacheWrite, label: t("usage.tokenCacheWrite", { tokens: formatTokens(tokens.cacheWrite) }), cls: "ts-cachew" },
                { key: "reasoning", value: tokens.reasoning, label: t("usage.tokenReasoning", { tokens: formatTokens(tokens.reasoning) }), cls: "ts-reason" },
              ].filter((segment) => segment.value > 0);
              if (segments.length === 0) return <span className="muted-line">{t("usage.noTokenData")}</span>;
              return <>
                <div className="token-stack-bar">
                  {segments.map((segment) => <span
                    key={segment.key}
                    className={`token-stack-seg ${segment.cls}`}
                    style={{ width: `${(segment.value / totalForStack) * 100}%` }}
                  />)}
                </div>
                <div className="token-stack-legend">
                  {segments.map((segment) => <span key={segment.key} className="token-stack-leg"><i className={`token-stack-dot ${segment.cls}`} />{segment.label}</span>)}
                </div>
              </>;
            })()}
          </div>
        </div>
        <div className="usage-card">
          <span className="eyebrow">{t("usage.metricRequests")}</span>
          <strong>{formatCount(totals?.requests ?? 0)}</strong>
          <small>{totals?.failures ? t("usage.failuresWithRate", { count: totals.failures, rate: (totals.failures / Math.max(totals.requests, 1) * 100).toFixed(1) }) : t("usage.noFailures")}</small>
        </div>
        <div className="usage-card">
          <span className="eyebrow">{t("usage.cacheHit")}</span>
          <strong>{cacheHit === null ? "—" : `${(cacheHit * 100).toFixed(1)}%`}</strong>
          <small>{t("usage.cacheRead", { tokens: formatTokens(totals?.tokens.cacheRead ?? 0) })} · {t("usage.cacheWrite", { tokens: formatTokens(totals?.tokens.cacheWrite ?? 0) })}</small>
        </div>
      </div>

      {data.report.unpriced.length > 0 ? <span className="muted-line warn-line">
        {t("usage.unpricedHint", { count: data.report.unpriced.length })}
      </span> : null}

      <div className="usage-trend-wrap">
        <div className="mp-seg usage-metric-seg">
          {TREND_METRICS.map((m) => <button type="button" key={m.key} data-active={metric === m.key} onClick={() => setMetric(m.key)}>{t(m.label)}</button>)}
        </div>
        <TrendArea days={data.report.byDay} metric={metric} />
      </div>

      <div className="usage-breakdowns">
        <BreakdownTable title={t("usage.byModel")} buckets={data.report.byModel} totalCost={totalCost?.value ?? 0} daySeriesByKey={modelDaySeries} onPrice={openPricing} />
        <BreakdownTable title={t("usage.byProvider")} buckets={data.report.byProvider} totalCost={totalCost?.value ?? 0} daySeriesByKey={providerDaySeries} />
      </div>

      <span className="muted-line">
        {t("usage.indexed", { count: data.indexedEntries })}{data.invalidLines ? t("usage.invalidLines", { count: data.invalidLines }) : ""} · {t("usage.pricedModels", { count: data.pricedModels })}
      </span>
    </div>}

    {pricing ? <div className="usage-pricing-editor">
      <div className="editor-head">
        <div><span className="eyebrow">{t("usage.pricePerMillion")}</span><strong className="mono">{pricing.key}</strong></div>
        <div className="drawer-actions"><button className="secondary-button" onClick={() => setPricing(null)}>{t("common.close")}</button></div>
      </div>
      <div className="form-two">
        {(["input", "output", "cacheRead", "cacheWrite"] as const).map((field) => <label className="module-field" key={field}>
          <span>{field}</span>
          <input
            inputMode="decimal"
            value={pricing[field]}
            placeholder={t("usage.pricePlaceholder")}
            onChange={(event) => setPricing((current) => current ? { ...current, [field]: event.target.value } : current)}
          />
        </label>)}
      </div>
      <div className="drawer-actions">
        <button className="primary-button" onClick={() => void savePricing()} disabled={loading}><Save size={15} />{t("common.save")}</button>
        <button className="secondary-button" onClick={() => void savePricing(true)} disabled={loading}><Trash2 size={14} />{t("usage.clearPrice")}</button>
      </div>
    </div> : null}
  </section>;
}
