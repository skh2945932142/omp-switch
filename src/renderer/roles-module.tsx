import { useMemo } from "react";
import type { ReactElement } from "react";
import { CircleAlert, Save } from "lucide-react";
import type { OmpProvider } from "@omp-switch/core";
import { findMisusedRoleThinkingSuffix, parseRoleSelector, type ParsedRoleSelector } from "@omp-switch/core/validation";
import { ModelPicker, modelLabel } from "./components/model-picker";

/** OMP's documented roles with a one-line Chinese gloss. Ids stay English — they are written to config.yml. */
export const KNOWN_ROLES: Array<[string, string]> = [
  ["default", "默认主力"],
  ["smol", "轻量快速"],
  ["slow", "深度思考"],
  ["vision", "视觉"],
  ["plan", "规划"],
  ["designer", "设计"],
  ["commit", "提交"],
  ["tiny", "极小"],
  ["task", "任务"],
  ["advisor", "顾问"],
];

interface Resolution {
  chain: string[];
  final: ParsedRoleSelector | null;
  cycle: boolean;
}

/**
 * Follows `@role` indirection so the row can show what a role actually resolves to. Stops at the
 * first cycle or unparseable hop rather than looping.
 */
function resolveChain(roles: Record<string, string>, role: string, providerIds: string[]): Resolution {
  let selector = (roles[role] ?? "").trim();
  const seen = new Set<string>([role]);
  const chain: string[] = [];
  while (selector) {
    const parsed = parseRoleSelector(selector, providerIds);
    if (!parsed) return { chain, final: null, cycle: false };
    chain.push(selector);
    if (parsed.kind !== "role") return { chain, final: parsed, cycle: false };
    if (seen.has(parsed.role)) return { chain, final: parsed, cycle: true };
    seen.add(parsed.role);
    selector = (roles[parsed.role] ?? "").trim();
  }
  return { chain, final: null, cycle: false };
}

export interface RolesModuleProps {
  providers: Array<[string, OmpProvider]>;
  /** id + Chinese gloss; gloss is empty for custom roles found in config.yml. */
  roleIds: Array<[string, string]>;
  roles: Record<string, string>;
  /** Last committed values, used to flag pending changes. */
  baseline: Record<string, string>;
  readOnly: boolean;
  busy: boolean;
  onRoleChange: (role: string, value: string) => void;
  onSave: () => void;
}

export function RolesModule({ providers, roleIds, roles, baseline, readOnly, busy, onRoleChange, onSave }: RolesModuleProps): ReactElement {
  const providerIds = useMemo(() => providers.map(([id]) => id), [providers]);
  const pending = useMemo(() => roleIds.filter(([id]) => (roles[id] ?? "") !== (baseline[id] ?? "")).length, [roleIds, roles, baseline]);

  return <section className="module-view module-shell">
    <div className="workspace-heading module-heading">
      <div>
        <span className="eyebrow">ROLES</span>
        <h1>角色{pending ? <span className="heading-dirty">{pending} 项未保存</span> : null}</h1>
      </div>
      <div className="heading-actions">
        <button className="primary-button" onClick={onSave} disabled={busy || readOnly || pending === 0}><Save size={15} />保存</button>
      </div>
    </div>

    {readOnly ? <div className="inline-status warning"><CircleAlert size={15} /><span>当前 Profile 为只读</span></div> : null}

    <div className="roles-list">
      {roleIds.map(([role, gloss]) => {
        const value = roles[role] ?? "";
        const changed = value !== (baseline[role] ?? "");
        const misused = value.trim() ? findMisusedRoleThinkingSuffix(value) : null;
        const invalid = Boolean(value.trim()) && parseRoleSelector(value, providerIds) === null;
        const resolution = resolveChain(roles, role, providerIds);
        const finalModel = resolution.final?.kind === "model" ? modelLabel(providers, resolution.final.provider, resolution.final.model) : undefined;
        return <div className={`role-card ${changed ? "changed" : ""}`} key={role}>
          <div className="role-id">
            <strong>{role}</strong>
            <small>{gloss || "自定义角色"}</small>
          </div>
          <div className="role-meta">
            {value.trim() && resolution.chain.length > 0 ? <span className="role-resolved">
              {resolution.chain.map((step, index) => <span key={`${step}-${index}`}>{index > 0 ? <span className="arrow">→</span> : null}<span className="mono">{step}</span></span>)}
              {resolution.final?.kind === "model" && finalModel ? <>
                <span className="arrow">=</span>
                <span className="final">{finalModel.name ?? finalModel.id}</span>
                {finalModel.reasoning ? <span className="capability on">思考</span> : null}
                {finalModel.input?.includes("image") ? <span className="capability on">视觉</span> : null}
              </> : resolution.final?.kind === "wildcard" ? <span className="arrow">· 任意可用模型</span> : null}
            </span> : <span className="role-resolved">未设置 · 由 OMP 内置目录决定</span>}
            {resolution.cycle ? <span className="role-warning"><CircleAlert size={13} />@引用出现循环</span> : null}
            {invalid ? <span className="role-warning"><CircleAlert size={13} />无法解析的选择器</span> : null}
            {misused ? <span className="role-warning"><CircleAlert size={13} />`:{misused}` 不是角色思考等级（OMP 不会剥离它），请改用 minimal–max</span> : null}
          </div>
          <div className="role-picker-cell">
            <ModelPicker
              providers={providers}
              value={value}
              onValueChange={(next) => onRoleChange(role, next)}
              allowSpecial
              allowLevel
              ariaLabel={`${role} 角色的模型`}
            />
          </div>
        </div>;
      })}
    </div>

    <span className="muted-line">角色写入 config.yml 的 modelRoles；`@default` 跟随 default 角色，`*` 表示任意可用模型。修改后需保存。</span>
  </section>;
}
