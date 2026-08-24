import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Activity,
  CircleAlert,
  CloudDownload,
  Coins,
  FileCheck2,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import type { ProfileRef } from "@omp-switch/core";
import { IconButtonTip, StyledSelect } from "../ui-primitives";

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
  compact?: boolean;
  onToggleCompact?: () => void;
}

const SECTION_SHORTCUTS: Record<SectionKey, number> = {
  models: 1,
  roles: 2,
  prompts: 3,
  skills: 4,
  sessions: 5,
  usage: 6,
  gateway: 7,
};

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
  compact = false,
  onToggleCompact,
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
    <aside className={`left-rail${compact ? " compact" : ""}`}>
      {!compact ? (
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
      ) : null}
      <nav className="section-nav" aria-label={t("toasts.modulesAria")}>
        {navGroups.map((group) => (
          <div className="nav-group" key={group.title}>
            {!compact ? <span className="nav-group-title">{group.title}</span> : null}
            {group.items.map((item) => {
              const isActive = section === item;
              const buttonContent = (
                <button
                  key={item}
                  className={isActive ? "active" : ""}
                  onClick={() => onSectionChange(item)}
                  aria-label={compact ? `${sectionLabels[item]} (Ctrl+${SECTION_SHORTCUTS[item]})` : undefined}
                >
                  {isActive ? (
                    <motion.span
                      layoutId="active-nav-pill"
                      className="nav-active-pill"
                      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                    />
                  ) : null}
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
                  <kbd className="nav-kbd">{SECTION_SHORTCUTS[item]}</kbd>
                </button>
              );

              return compact ? (
                <IconButtonTip key={item} label={`${sectionLabels[item]} (Ctrl+${SECTION_SHORTCUTS[item]})`}>
                  {buttonContent}
                </IconButtonTip>
              ) : (
                buttonContent
              );
            })}
          </div>
        ))}
      </nav>
      <div className="rail-footer">
        <IconButtonTip label={t("diagnostics.title")}>
          <button className="rail-action" onClick={onOpenDiagnostics}>
            <CircleAlert size={15} />
            <span>{t("diagnostics.title")}</span>
            <span className="nav-count">{errorCount}</span>
          </button>
        </IconButtonTip>
        <IconButtonTip label={t("common.profile")}>
          <button className="rail-action" onClick={onOpenSettings}>
            <Settings2 size={15} />
            <span>{t("common.profile")}</span>
            {settingsDirty ? <span className="nav-dot" title={t("settings.unsaved")} /> : null}
          </button>
        </IconButtonTip>
        {onToggleCompact ? (
          <IconButtonTip label={compact ? t("nav.expandSidebar") : t("nav.collapseSidebar")}>
            <button className="rail-action rail-collapse-btn" onClick={onToggleCompact} aria-label={compact ? t("nav.expandSidebar") : t("nav.collapseSidebar")}>
              {compact ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
              <span>{t("nav.collapseSidebar")}</span>
            </button>
          </IconButtonTip>
        ) : null}
      </div>
    </aside>
  );
}
