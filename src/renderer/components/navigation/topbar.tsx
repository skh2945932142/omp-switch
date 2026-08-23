import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  ArchiveRestore,
  ChevronDown,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import type { UpdateStatus } from "@omp-switch/core";
import { IconButtonTip } from "../ui-primitives";
import { LocaleSwitch } from "../locale-switch";
import { ThemeSwitch } from "../theme-switch";
import type { LocaleChoice } from "../../locale";
import type { ThemeChoice } from "../../theme";

export interface TopBarProps {
  profileId: string;
  profileName: string;
  readOnly: boolean;
  hasErrors: boolean;
  healthLabel: string;
  onOpenProfileSettings: () => void;
  onOpenDiagnostics: () => void;
  onOpenPalette: () => void;
  onRefresh: () => void;
  onCreateSnapshot: () => void;
  localeChoice: LocaleChoice;
  onLocaleChange: (c: LocaleChoice) => void;
  themeChoice: ThemeChoice;
  onThemeChange: (c: ThemeChoice) => void;
  updateInfo: { lastResult: UpdateStatus | null };
  onOpenAbout: () => void;
  onSaveDirty: () => void;
  busy: boolean;
  isDirty: boolean;
}

export function TopBar({
  profileId,
  profileName,
  readOnly,
  hasErrors,
  healthLabel,
  onOpenProfileSettings,
  onOpenDiagnostics,
  onOpenPalette,
  onRefresh,
  onCreateSnapshot,
  localeChoice,
  onLocaleChange,
  themeChoice,
  onThemeChange,
  updateInfo,
  onOpenAbout,
  onSaveDirty,
  busy,
  isDirty,
}: TopBarProps): ReactElement {
  const { t } = useTranslation();

  return (
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark">
          <Sparkles size={16} />
        </div>
        <div className="brand-name">OMP Switch</div>
      </div>
      <div className="topbar-center">
        <button className="profile-chip" title={t("common.openProfile")} onClick={onOpenProfileSettings}>
          <span className="status-led" />
          {profileName || profileId}
          <ChevronDown size={14} />
        </button>
        <button
          className={`status-chip ${readOnly ? "warning" : hasErrors ? "danger" : "ok"}`}
          onClick={onOpenDiagnostics}
        >
          <ShieldCheck size={14} />
          {healthLabel}
        </button>
      </div>
      <div className="topbar-actions">
        <IconButtonTip label={`${t("shortcuts.palette")} (Ctrl+K)`}>
          <button className="icon-button" onClick={onOpenPalette}>
            <Search size={16} />
          </button>
        </IconButtonTip>
        <IconButtonTip label={t("topbar.refresh")}>
          <button className="icon-button" onClick={onRefresh} disabled={busy}>
            <RefreshCw size={16} className={busy ? "spin" : ""} />
          </button>
        </IconButtonTip>
        <IconButtonTip label={t("topbar.createSnapshot")}>
          <button className="icon-button" onClick={onCreateSnapshot} disabled={busy}>
            <ArchiveRestore size={16} />
          </button>
        </IconButtonTip>
        <LocaleSwitch value={localeChoice} onChange={onLocaleChange} />
        <ThemeSwitch value={themeChoice} onChange={onThemeChange} />
        {updateInfo.lastResult?.available ? (
          <button
            className="icon-button update-badge"
            title={t("topbar.newVersionAvailable", { version: updateInfo.lastResult.manifest.release })}
            onClick={onOpenAbout}
          >
            <Zap size={16} />
            <span className="update-badge-dot" />
          </button>
        ) : null}
        <button
          className="primary-button compact"
          title={t("topbar.saveAll")}
          onClick={onSaveDirty}
          disabled={busy || readOnly || !isDirty}
        >
          <Save size={14} />
          {t("common.save")}
        </button>
      </div>
    </header>
  );
}
