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
import { IconButton } from "../ui-primitives";
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
          <span className="profile-name">{profileName || profileId}</span>
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
        <IconButton label={`${t("shortcuts.palette")} (Ctrl+K)`} onClick={onOpenPalette}>
          <Search size={16} />
        </IconButton>
        <IconButton label={t("topbar.refresh")} onClick={onRefresh} disabled={busy}>
          <RefreshCw size={16} className={busy ? "spin" : ""} />
        </IconButton>
        <IconButton label={t("topbar.createSnapshot")} onClick={onCreateSnapshot} disabled={busy}>
          <ArchiveRestore size={16} />
        </IconButton>
        <LocaleSwitch value={localeChoice} onChange={onLocaleChange} />
        <ThemeSwitch value={themeChoice} onChange={onThemeChange} />
        {updateInfo.lastResult?.available ? (
          <IconButton
            className="update-badge"
            label={t("topbar.newVersionAvailable", { version: updateInfo.lastResult.manifest.release })}
            onClick={onOpenAbout}
          >
            <Zap size={16} />
            <span className="update-badge-dot" />
          </IconButton>
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
