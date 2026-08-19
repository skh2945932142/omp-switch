import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Coins, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import type { ModelPrice, UsageBucket } from "@omp-switch/core";

type AppApi = NonNullable<Window["ompSwitch"]>;
type Notice = { tone: "success" | "error" | "info"; text: string };

interface UsageModuleProps {
  api: AppApi;
  profileId: string;
  onNotice: (notice: Notice) => void;
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

/**
 * Which cost to show. OMP records a per-turn cost and that is authoritative; local pricing is only a
 * fallback, because a models.yml without `cost:` entries would otherwise report a confident $0.
 */
function bucketCost(bucket: UsageBucket): { value: number; source: "recorded" | "computed" | "none" } {
  if (bucket.recordedCost > 0) return { value: bucket.recordedCost, source: "recorded" };
  if (bucket.pricedRequests > 0) return { value: bucket.computedCost, source: "computed" };
  return { value: 0, source: "none" };
}

function TrendBars({ days }: { days: UsageBucket[] }): ReactElement | null {
  if (days.length === 0) return null;
  const peak = Math.max(...days.map((day) => bucketCost(day).value), Number.EPSILON);
  return <div className="usage-trend">
    {days.map((day) => {
      const cost = bucketCost(day);
      const height = Math.max(2, Math.round((cost.value / peak) * 100));
      return <div
        className="usage-trend-col"
        key={day.key}
        title={`${day.key} · ${day.requests} 次 · ${formatUsd(cost.value)} · ${formatTokens(day.tokens.total)} tokens`}
      >
        <div className="usage-trend-bar" style={{ height: `${height}%` }} />
        <span className="usage-trend-label">{day.key.slice(5)}</span>
      </div>;
    })}
  </div>;
}

function BreakdownTable({ title, buckets, onPrice }: {
  title: string;
  buckets: UsageBucket[];
  onPrice?: (key: string) => void;
}): ReactElement {
  return <div className="usage-table">
    <div className="drawer-section-title"><span>{title}</span><span className="status-chip neutral">{buckets.length}</span></div>
    <div className="usage-rows">
      {buckets.length === 0 ? <span className="muted-line">暂无数据</span> : buckets.map((bucket) => {
        const cost = bucketCost(bucket);
        const costTitle = cost.source === "computed" ? "本地定价推算" : cost.source === "none" ? "无成本数据" : "OMP 记录";
        return <div className="usage-row" key={bucket.key}>
          <span className="usage-row-key mono" title={bucket.key}>{bucket.key}</span>
          <span className="usage-row-num">{bucket.requests}</span>
          <span className="usage-row-num">{formatTokens(bucket.tokens.total)}</span>
          <span className={`usage-row-num ${cost.source === "computed" ? "warn-line" : ""}`} title={costTitle}>
            {cost.source === "none" ? "—" : formatUsd(cost.value)}
          </span>
          {bucket.failures > 0 ? <span className="status-chip warn">{bucket.failures} 失败</span> : <span />}
          {onPrice ? <button className="icon-button subtle" title="设置本地单价" onClick={() => onPrice(bucket.key)}><Coins size={14} /></button> : null}
        </div>;
      })}
    </div>
  </div>;
}

export function UsageModule({ api, profileId, onNotice }: UsageModuleProps): ReactElement {
  const [data, setData] = useState<Awaited<ReturnType<AppApi["usageSummary"]>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pricing, setPricing] = useState<{ key: string; input: string; output: string; cacheRead: string; cacheWrite: string } | null>(null);

  async function load(reindex = false): Promise<void> {
    setLoading(true);
    try {
      setData(await api.usageSummary(profileId, { from: from || undefined, to: to || undefined, reindex }));
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [profileId]);

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

  return <section className="module-view module-shell">
    <div className="workspace-heading module-heading">
      <div><span className="eyebrow">PROFILE</span><h1>用量{typeof totals?.requests === "number" ? <span className="heading-count">{totals.requests}</span> : null}</h1></div>
      <div className="heading-actions">
        <input className="usage-date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="起始日期" />
        <input className="usage-date" type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="结束日期" />
        <button className="icon-button" title="应用筛选" onClick={() => void load()} disabled={loading}><Search size={16} /></button>
        <button className="secondary-button" onClick={() => void load(true)} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />重新索引</button>
      </div>
    </div>

    {!data ? <div className="module-empty compact-empty"><Coins size={22} /><strong>正在读取会话索引</strong></div> : <div className="usage-layout">
      <div className="usage-cards">
        <div className="usage-card">
          <span className="eyebrow">花费</span>
          <strong>{totalCost && totalCost.source !== "none" ? formatUsd(totalCost.value) : "—"}</strong>
          <small>{costLabel}</small>
        </div>
        <div className="usage-card">
          <span className="eyebrow">请求</span>
          <strong>{totals?.requests ?? 0}</strong>
          <small>{totals?.failures ? `${totals.failures} 次失败` : "无失败"}</small>
        </div>
        <div className="usage-card">
          <span className="eyebrow">Tokens</span>
          <strong>{formatTokens(totals?.tokens.total ?? 0)}</strong>
          <small>入 {formatTokens(totals?.tokens.input ?? 0)} · 出 {formatTokens(totals?.tokens.output ?? 0)}</small>
        </div>
        <div className="usage-card">
          <span className="eyebrow">缓存读取</span>
          <strong>{formatTokens(totals?.tokens.cacheRead ?? 0)}</strong>
          <small>写入 {formatTokens(totals?.tokens.cacheWrite ?? 0)}</small>
        </div>
        <div className="usage-card">
          <span className="eyebrow">推理</span>
          <strong>{formatTokens(totals?.tokens.reasoning ?? 0)}</strong>
          <small>{totals?.firstAt ? `${totals.firstAt.slice(0, 10)} 起` : "—"}</small>
        </div>
      </div>

      {data.report.unpriced.length > 0 ? <span className="muted-line warn-line">
        {data.report.unpriced.length} 个模型没有本地单价（models.yml 未配置 cost），成本以 OMP 记录为准。可点击表格中的硬币图标设置单价用于核对。
      </span> : null}
      {totals && totals.pricedRequests > 0 && totals.recordedCost > 0 ? <span className="muted-line">
        本地推算 {formatUsd(totals.computedCost)}（覆盖 {totals.pricedRequests}/{totals.requests} 次请求）· 与 OMP 记录相差 {formatUsd(Math.abs(totals.recordedCost - totals.computedCost))}
      </span> : null}

      <TrendBars days={data.report.byDay} />

      <div className="usage-breakdowns">
        <BreakdownTable title="按模型" buckets={data.report.byModel} onPrice={openPricing} />
        <BreakdownTable title="按供应商" buckets={data.report.byProvider} />
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
