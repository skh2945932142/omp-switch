import { useMemo } from "react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
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
  profileId: string;
  readOnly: boolean;
  busy: boolean;
  onRoleChange: (role: string, value: string) => void;
  onSave: () => void;
  /** enabledModels coverage — a role pointing at a filtered model silently no-ops in OMP. */
  isEnabled?: (providerId: string, modelId: string) => boolean;
}

export function RolesModule({ providers, roleIds, roles, baseline, profileId, readOnly, busy, onRoleChange, onSave, isEnabled }: RolesModuleProps): ReactElement {
  const { t, i18n } = useTranslation();
  const providerIds = useMemo(() => providers.map(([id]) => id), [providers]);
  const pending = useMemo(() => roleIds.filter(([id]) => (roles[id] ?? "") !== (baseline[id] ?? "")).length, [roleIds, roles, baseline]);

  return <section className="module-view module-shell">
    <div className="workspace-heading module-heading">
      <div>
        <span className="eyebrow">{profileId}</span>
        <h1>{t("roles.heading")}{pending ? <span className="heading-dirty">{t("roles.dirtyCount", { count: pending })}</span> : null}</h1>
      </div>
      <div className="heading-actions">
        <button className="primary-button" onClick={onSave} disabled={busy || readOnly || pending === 0}><Save size={15} />{t("common.save")}</button>
      </div>
    </div>

    {readOnly ? <div className="inline-status warning"><CircleAlert size={15} /><span>{t("surfaces.readonly")}</span></div> : null}

    <div className="roles-list">
      {roleIds.map(([role, gloss]) => {
        const value = roles[role] ?? "";
        const changed = value !== (baseline[role] ?? "");
        const misused = value.trim() ? findMisusedRoleThinkingSuffix(value) : null;
        const invalid = Boolean(value.trim()) && parseRoleSelector(value, providerIds) === null;
        const resolution = resolveChain(roles, role, providerIds);
        const finalModel = resolution.final?.kind === "model" ? modelLabel(providers, resolution.final.provider, resolution.final.model) : undefined;
        const filtered = Boolean(isEnabled && resolution.final?.kind === "model" && !isEnabled(resolution.final.provider, resolution.final.model));
        return <div className={`role-card ${changed ? "changed" : ""}`} key={role}>
          <div className="role-id">
            <strong>{role}</strong>
            <small>{i18n.exists(`roles.roleGloss.${role}`) ? t(`roles.roleGloss.${role}`) : (gloss || t("roles.customRole"))}</small>
          </div>
          <div className="role-meta">
            {value.trim() && resolution.chain.length > 0 ? <>
              {resolution.chain.length > 1 || resolution.final ? <span className="role-chain">
                {resolution.chain.map((step, index) => <span className="role-chain-hop" key={`${step}-${index}`}>{index > 0 ? <span className="arrow">→</span> : null}<span className="mono">{step}</span></span>)}
              </span> : null}
              {resolution.final?.kind === "model" && finalModel ? <span className="role-final">
                <span className="role-final-arrow">=</span>
                <span className="role-final-name">{finalModel.name ?? finalModel.id}</span>
                <span className="mono role-final-id">{finalModel.id}</span>
                {finalModel.reasoning ? <span className="capability on">{t("roles.thinking")}</span> : null}
                {finalModel.input?.includes("image") ? <span className="capability on">{t("roles.vision")}</span> : null}
              </span> : resolution.final?.kind === "wildcard" ? <span className="role-final"><span className="role-final-arrow">=</span><span className="role-final-name">{t("roles.wildcard")}</span></span> : resolution.final?.kind === "role" ? <span className="role-final"><span className="role-final-arrow">→</span><span className="role-final-name">@{resolution.final.role}</span></span> : null}
            </> : <span className="role-unset">{t("roles.unset")}</span>}
            {resolution.cycle ? <span className="role-warning"><CircleAlert size={13} />{t("roles.cycleWarning")}</span> : null}
            {invalid ? <span className="role-warning"><CircleAlert size={13} />{t("roles.invalidWarning")}</span> : null}
            {misused ? <span className="role-warning"><CircleAlert size={13} />{t("roles.misusedWarning", { suffix: misused })}</span> : null}
            {filtered ? <span className="role-warning"><CircleAlert size={13} />{t("roles.filteredWarning")}</span> : null}
          </div>
          <div className="role-picker-cell">
            <ModelPicker
              providers={providers}
              value={value}
              onValueChange={(next) => onRoleChange(role, next)}
              allowSpecial
              allowLevel
              isEnabled={isEnabled}
              ariaLabel={t("roles.ariaModel", { role })}
            />
          </div>
        </div>;
      })}
    </div>

    <span className="muted-line">{t("roles.footerHint")}</span>
  </section>;
}
