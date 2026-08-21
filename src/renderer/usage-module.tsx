import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
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
  { key: "cost", label: "花费" },
  { key: "requests", label: "请求" },
  { key: "tokens", label: "Tokens" },
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
    <svg className="usage-trend-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`按日${TREND_METRICS.find((m) => m.key === metric)!.label}趋势`}>
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
          : metric === "requests" ? `${formatCount(value)} 次`
          : `${formatTokens(value)} tokens`;
        return <Tip
          key={day.key}
          label={<div className="tip-stack">
            <span className="tip-stack-date">{day.key}</span>
            <span className="tip-stack-value">{metricText}</span>
            <span className="tip-stack-sub">{formatCount(day.requests)} 次 · {formatTokens(day.tokens.total)} tokens</span>
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
  if (values.length === 0) return <span className="muted-line">无趋势</span>;
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
  const [open, setOpen] = useState(false);
  const cost = bucketCost(bucket);
  const costTitle = cost.source === "computed" ? "本地定价推算" : cost.source === "none" ? "无成本数据" : "OMP 记录";
  const share = totalCost > 0 && cost.source !== "none" ? cost.value / totalCost : 0;
  const hit = cacheHitRate(bucket);
  const t = bucket.tokens;
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
        <div className="detail-cell"><span className="detail-label">输入</span><span className="mono">{formatTokens(t.input)}</span></div>
        <div className="detail-cell"><span className="detail-label">输出</span><span className="mono">{formatTokens(t.output)}</span></div>
        <div className="detail-cell"><span className="detail-label">缓存读取</span><span className="mono">{formatTokens(t.cacheRead)}</span></div>
        <div className="detail-cell"><span className="detail-label">缓存写入</span><span className="mono">{formatTokens(t.cacheWrite)}</span></div>
        <div className="detail-cell"><span className="detail-label">推理</span><span className="mono">{formatTokens(t.reasoning)}</span></div>
        <div className="detail-cell">
          <span className="detail-label">缓存命中率</span>
          <span className="mono">{hit === null ? "—" : `${(hit * 100).toFixed(1)}%`}</span>
        </div>
      </div>
      <div className="detail-line">
        <span className="detail-label">日趋势（花费）</span>
        <MiniSpark values={daySeries} />
      </div>
      <div className="detail-meta">
        <span>成本来源：<strong className={cost.source === "computed" ? "warn-line" : ""}>{costTitle}</strong></span>
        {computedDelta !== null ? <span>本地推算 {formatUsd(bucket.computedCost)} · 差 {formatUsd(computedDelta)}</span> : null}
        <span>{bucket.failures > 0 ? <span className="warn-line">{bucket.failures} 次失败</span> : "无失败"}</span>
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
  return <div className="usage-table">
    <div className="drawer-section-title"><span>{title}</span><span className="status-chip neutral">{buckets.length}</span></div>
    <div className="usage-row-head">
      <span className="usage-row-head-spacer" />
      <span>模型</span>
      <span className="usage-row-num">请求</span>
      <span className="usage-row-num">Tokens</span>
      <span className="usage-row-num">成本</span>
      <span>占比</span>
      <span />
    </div>
    <div className="usage-rows">
      {buckets.length === 0 ? <span className="muted-line">暂无数据</span> : buckets.map((bucket, index) =>
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
          if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} 必须是非负数`);
          next[field] = parsed;
        }
        price = Object.keys(next).length > 0 ? next : null;
      }
      await api.setUsagePrice(pricing.key, price);
      setPricing(null);
      await load();
      onNotice({ tone: "success", text: price === null ? "已清除本地单价" : "本地单价已保存" });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  const totals = data?.report.totals;
  const totalCost = totals ? bucketCost(totals) : null;
  const costLabel = totalCost?.source === "recorded" ? "OMP 记录"
    : totalCost?.source === "computed" ? "本地定价推算" : "无成本数据";
  const cacheHit = totals ? cacheHitRate(totals) : null;
  // Per-model / per-provider daily series drive the in-row cost sparklines. The data layer only
  // carries days with traffic, so quiet gaps simply do not appear — a sparse series is fine for a
  // thumbnail trend.
  const modelDaySeries = data?.report.byModelByDay;
  const providerDaySeries = data?.report.byProviderByDay;

  return <section className="module-view module-shell">
    <div className="workspace-heading module-heading">
      <div><span className="eyebrow">PROFILE</span><h1>用量{typeof totals?.requests === "number" ? <span className="heading-count">{totals.requests}</span> : null}</h1></div>
      <div className="heading-actions">
        <div className="mp-seg usage-range">
          {[7, 30, 90].map((days) => <button type="button" key={days} data-active={from === daysAgoIso(days) && !to} onClick={() => { setFrom(daysAgoIso(days)); setTo(""); void load(false, { from: daysAgoIso(days) }); }}>{days}天</button>)}
          <button type="button" data-active={!from && !to} onClick={() => { setFrom(""); setTo(""); void load(false, {}); }}>全部</button>
        </div>
        <input className="usage-date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="起始日期" />
        <input className="usage-date" type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="结束日期" />
        <button className="icon-button" title="应用筛选" onClick={() => void load()} disabled={loading}><Search size={16} /></button>
        <button className="secondary-button" onClick={() => void load(true)} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />重新索引</button>
      </div>
    </div>

    {!data ? <div className="usage-cards">{[0, 1].map((index) => <div key={index} className="usage-card"><span className="eyebrow">&nbsp;</span><div className="skeleton skeleton-num" /><div className="skeleton skeleton-line" /></div>)}</div> : <div className="usage-layout">
      <div className="usage-cards usage-cards-composite">
        <div className="usage-card usage-card-primary">
          <span className="eyebrow">花费</span>
          <strong>{totalCost && totalCost.source !== "none" ? formatUsd(totalCost.value) : "—"}</strong>
          <small>{costLabel}{totals && totals.pricedRequests > 0 && totals.recordedCost > 0 ? ` · 推算 ${formatUsd(totals.computedCost)}` : ""}</small>
          <div className="token-stack" title="token 构成">
            {(() => {
              const t = totals?.tokens;
              if (!t) return null;
              const totalForStack = Math.max(t.input + t.output + t.cacheRead + t.cacheWrite + t.reasoning, 1);
              const segments: Array<{ key: string; value: number; label: string; cls: string }> = [
                { key: "input", value: t.input, label: `输入 ${formatTokens(t.input)}`, cls: "ts-input" },
                { key: "output", value: t.output, label: `输出 ${formatTokens(t.output)}`, cls: "ts-output" },
                { key: "cacheRead", value: t.cacheRead, label: `缓存读 ${formatTokens(t.cacheRead)}`, cls: "ts-cache" },
                { key: "cacheWrite", value: t.cacheWrite, label: `缓存写 ${formatTokens(t.cacheWrite)}`, cls: "ts-cachew" },
                { key: "reasoning", value: t.reasoning, label: `推理 ${formatTokens(t.reasoning)}`, cls: "ts-reason" },
              ].filter((segment) => segment.value > 0);
              if (segments.length === 0) return <span className="muted-line">无 token 数据</span>;
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
          <span className="eyebrow">请求</span>
          <strong>{formatCount(totals?.requests ?? 0)}</strong>
          <small>{totals?.failures ? `${totals.failures} 次失败（${(totals.failures / Math.max(totals.requests, 1) * 100).toFixed(1)}%）` : "无失败"}</small>
        </div>
        <div className="usage-card">
          <span className="eyebrow">缓存命中</span>
          <strong>{cacheHit === null ? "—" : `${(cacheHit * 100).toFixed(1)}%`}</strong>
          <small>读 {formatTokens(totals?.tokens.cacheRead ?? 0)} · 写 {formatTokens(totals?.tokens.cacheWrite ?? 0)}</small>
        </div>
      </div>

      {data.report.unpriced.length > 0 ? <span className="muted-line warn-line">
        {data.report.unpriced.length} 个模型没有本地单价（models.yml 未配置 cost），成本以 OMP 记录为准。可点击表格中的硬币图标设置单价用于核对。
      </span> : null}

      <div className="usage-trend-wrap">
        <div className="mp-seg usage-metric-seg">
          {TREND_METRICS.map((m) => <button type="button" key={m.key} data-active={metric === m.key} onClick={() => setMetric(m.key)}>{m.label}</button>)}
        </div>
        <TrendArea days={data.report.byDay} metric={metric} />
      </div>

      <div className="usage-breakdowns">
        <BreakdownTable title="按模型" buckets={data.report.byModel} totalCost={totalCost?.value ?? 0} daySeriesByKey={modelDaySeries} onPrice={openPricing} />
        <BreakdownTable title="按供应商" buckets={data.report.byProvider} totalCost={totalCost?.value ?? 0} daySeriesByKey={providerDaySeries} />
      </div>

      <span className="muted-line">
        已索引 {data.indexedEntries} 条事件{data.invalidLines ? ` · ${data.invalidLines} 行无法解析` : ""} · models.yml 中 {data.pricedModels} 条定价
      </span>
    </div>}

    {pricing ? <div className="usage-pricing-editor">
      <div className="editor-head">
        <div><span className="eyebrow">单价 / 百万 token</span><strong className="mono">{pricing.key}</strong></div>
        <div className="drawer-actions"><button className="secondary-button" onClick={() => setPricing(null)}>关闭</button></div>
      </div>
      <div className="form-two">
        {(["input", "output", "cacheRead", "cacheWrite"] as const).map((field) => <label className="module-field" key={field}>
          <span>{field}</span>
          <input
            inputMode="decimal"
            value={pricing[field]}
            placeholder="留空表示不计"
            onChange={(event) => setPricing((current) => current ? { ...current, [field]: event.target.value } : current)}
          />
        </label>)}
      </div>
      <div className="drawer-actions">
        <button className="primary-button" onClick={() => void savePricing()} disabled={loading}><Save size={15} />保存</button>
        <button className="secondary-button" onClick={() => void savePricing(true)} disabled={loading}><Trash2 size={14} />清除</button>
      </div>
    </div> : null}
  </section>;
}
