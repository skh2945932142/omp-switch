import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  CircleAlert,
  CloudDownload,
  Coins,
  FileCheck2,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import type { ProfileRef } from "@omp-switch/core";
import { StyledSelect } from "../ui-primitives";

export type SectionKey = "models" | "roles" | "prompts" | "skills" | "sessions" | "usage" | "gateway";

export interface LeftRailProps {
  profileId: string;
  profiles: ProfileRef[];
  onProfileChange: (profileId: string) => void;
  agentDir?: string;
  section: SectionKey;
  onSectionChange: (section: SectionKey) => void;
  providerCount: number;
  rolesDirty: boolean;
  settingsDirty: boolean;
  errorCount: number;
  onOpenDiagnostics: () => void;
  onOpenSettings: () => void;
}

export function LeftRail({
  profileId,
  profiles,
  onProfileChange,
  agentDir,
  section,
  onSectionChange,
  providerCount,
  rolesDirty,
  settingsDirty,
  errorCount,
  onOpenDiagnostics,
  onOpenSettings,
}: LeftRailProps): ReactElement {
  const { t } = useTranslation();

  const sectionLabels: Record<SectionKey, string> = {
    models: t("nav.models"),
    roles: t("nav.roles"),
    prompts: t("nav.prompts"),
    skills: t("nav.skills"),
    sessions: t("nav.sessions"),
    usage: t("nav.usage"),
    gateway: t("nav.gateway"),
  };

  const navGroups: Array<{ title: string; items: SectionKey[] }> = [
    { title: t("nav.groupConfig"), items: ["models", "roles"] },
    { title: t("nav.groupContent"), items: ["prompts", "skills", "sessions"] },
    { title: t("nav.groupOps"), items: ["usage", "gateway"] },
  ];

  return (
    <aside className="left-rail">
      <div className="rail-profile">
        <span className="rail-label">{t("common.profile")}</span>
        <StyledSelect
          value={profileId}
          onValueChange={onProfileChange}
          options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
          ariaLabel={t("common.openProfile")}
        />
        <span className="path-note" title={agentDir}>
          {agentDir ?? t("common.loading")}
        </span>
      </div>
      <nav className="section-nav" aria-label={t("toasts.modulesAria")}>
        {navGroups.map((group) => (
          <div className="nav-group" key={group.title}>
            <span className="nav-group-title">{group.title}</span>
            {group.items.map((item) => (
              <button
                key={item}
                className={section === item ? "active" : ""}
                onClick={() => onSectionChange(item)}
              >
                <span className="nav-icon">
                  {item === "models" ? (
                    <CloudDownload size={16} />
                  ) : item === "roles" ? (
                    <Users size={16} />
                  ) : item === "prompts" ? (
                    <FileCheck2 size={16} />
                  ) : item === "skills" ? (
                    <Sparkles size={16} />
                  ) : item === "sessions" ? (
                    <Activity size={16} />
                  ) : item === "usage" ? (
                    <Coins size={16} />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                </span>
                <span>{sectionLabels[item]}</span>
                {item === "models" ? <span className="nav-count">{providerCount}</span> : null}
                {item === "roles" && rolesDirty ? <span className="nav-dot" title={t("settings.unsaved")} /> : null}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="rail-footer">
        <button className="rail-action" onClick={onOpenDiagnostics}>
          <CircleAlert size={15} />
          {t("diagnostics.title")}
          <span>{errorCount}</span>
        </button>
        <button className="rail-action" onClick={onOpenSettings}>
          <Settings2 size={15} />
          {t("common.profile")}
          {settingsDirty ? <span className="nav-dot" title={t("settings.unsaved")} /> : null}
        </button>
      </div>
    </aside>
  );
}
