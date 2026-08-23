import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  ArchiveRestore,
  Download,
  FolderOpen,
  KeyRound,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";
import type {
  CompactionSettings,
  EffectiveConfig,
  SettingsThinkingLevel,
  Snapshot,
  UpdateStatus,
} from "@omp-switch/core";
import {
  PERSONALITY_PRESETS,
  SETTINGS_THINKING_LEVELS,
  UNEXPECTED_STOP_MODES,
  UPDATE_CHANNELS,
  type UnexpectedStopMode,
  type UpdateChannel,
} from "@omp-switch/core/validation";
import { StyledSelect } from "../ui-primitives";
import { ProjectOverlayBadge } from "../../workbench-modules";
import { SnapshotTimeline } from "../snapshot-timeline";
import { YamlPreview } from "../yaml-preview";
import { formatDateTime } from "../../locale";

export interface SettingsDrawerProps {
  profileId: string;
  profileTab: "settings" | "project" | "snapshots" | "omp" | "oauth" | "about";
  setProfileTab: (tab: "settings" | "project" | "snapshots" | "omp" | "oauth" | "about") => void;
  settingsDirty: boolean;
  providerOrder: string;
  setProviderOrder: (v: string) => void;
  enabledModels: string;
  setEnabledModels: (v: string) => void;
  disabledProviders: string;
  setDisabledProviders: (v: string) => void;
  defaultThinkingLevel: SettingsThinkingLevel;
  setDefaultThinkingLevel: (v: SettingsThinkingLevel) => void;
  personality: string;
  setPersonality: (v: string) => void;
  extendedContext: boolean;
  setExtendedContext: (v: boolean) => void;
  externalThinking: boolean;
  setExternalThinking: (v: boolean) => void;
  imagesUrlsEnabled: string;
  setImagesUrlsEnabled: (v: string) => void;
  compactionJson: string;
  setCompactionJson: (v: string) => void;
  unexpectedStopDetection: UnexpectedStopMode;
  setUnexpectedStopDetection: (v: UnexpectedStopMode) => void;
  updateChannel: UpdateChannel;
  setUpdateChannel: (v: UpdateChannel) => void;
  saveSettings: () => Promise<void>;
  busy: boolean;
  readOnly: boolean;
  api: Window["ompSwitch"];
  notify: (toast: { tone: "info" | "success" | "error"; text: string }) => void;
  createSnapshot: () => Promise<void>;
  snapshot: Snapshot | null;
  applyConfig: (config: EffectiveConfig) => void;
  setSnapshot: (snap: Snapshot | null) => void;
  updateOmp: () => Promise<void>;
  updatingOmp: boolean;
  exportCatalog: () => Promise<void>;
  config: EffectiveConfig | null;
  checkAuth: (provider: "openai-codex" | "anthropic", mode: "status" | "login") => Promise<void>;
  authResult: string;
  appVersion: string;
  updateInfo: { enabled: boolean; lastCheckAt: string | null; lastResult: UpdateStatus | null; checking: boolean };
  checkForUpdates: (manual: boolean) => Promise<void>;
  toggleUpdateCheckEnabled: (enabled: boolean) => Promise<void>;
  openDownload: (url: string) => Promise<void>;
  onOpenRoles: () => void;
}

export function SettingsDrawer({
  profileId,
  profileTab,
  setProfileTab,
  settingsDirty,
  providerOrder,
  setProviderOrder,
  enabledModels,
  setEnabledModels,
  disabledProviders,
  setDisabledProviders,
  defaultThinkingLevel,
  setDefaultThinkingLevel,
  personality,
  setPersonality,
  extendedContext,
  setExtendedContext,
  externalThinking,
  setExternalThinking,
  imagesUrlsEnabled,
  setImagesUrlsEnabled,
  compactionJson,
  setCompactionJson,
  unexpectedStopDetection,
  setUnexpectedStopDetection,
  updateChannel,
  setUpdateChannel,
  saveSettings,
  busy,
  readOnly,
  api,
  notify,
  createSnapshot,
  snapshot,
  applyConfig,
  setSnapshot,
  updateOmp,
  updatingOmp,
  exportCatalog,
  config,
  checkAuth,
  authResult,
  appVersion,
  updateInfo,
  checkForUpdates,
  toggleUpdateCheckEnabled,
  openDownload,
  onOpenRoles,
}: SettingsDrawerProps): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="drawer-body profile-drawer">
      <div className="profile-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={profileTab === "settings"}
          className={profileTab === "settings" ? "active" : ""}
          onClick={() => setProfileTab("settings")}
        >
          <Settings2 size={14} />
          {t("settings.tabSettings")}
        </button>
        <button
          role="tab"
          aria-selected={profileTab === "project"}
          className={profileTab === "project" ? "active" : ""}
          onClick={() => setProfileTab("project")}
        >
          <FolderOpen size={14} />
          {t("settings.tabProject")}
        </button>
        <button
          role="tab"
          aria-selected={profileTab === "snapshots"}
          className={profileTab === "snapshots" ? "active" : ""}
          onClick={() => setProfileTab("snapshots")}
        >
          <ArchiveRestore size={14} />
          {t("settings.tabSnapshots")}
        </button>
        <button
          role="tab"
          aria-selected={profileTab === "omp"}
          className={profileTab === "omp" ? "active" : ""}
          onClick={() => setProfileTab("omp")}
        >
          <RefreshCw size={14} />
          {t("settings.tabOmp")}
        </button>
        <button
          role="tab"
          aria-selected={profileTab === "oauth"}
          className={profileTab === "oauth" ? "active" : ""}
          onClick={() => setProfileTab("oauth")}
        >
          <KeyRound size={14} />
          {t("settings.tabOAuth")}
        </button>
        <button
          role="tab"
          aria-selected={profileTab === "about"}
          className={profileTab === "about" ? "active" : ""}
          onClick={() => setProfileTab("about")}
        >
          <Zap size={14} />
          {t("settings.tabAbout")}
        </button>
      </div>

      {profileTab === "settings" ? (
        <>
          <div className="drawer-section">
            <div className="drawer-section-title">
              <span>{t("settings.roles")}</span>
              <Users size={15} />
            </div>
            <span className="muted-line">{t("settings.rolesHint")}</span>
            <div className="drawer-actions">
              <button className="secondary-button" onClick={onOpenRoles}>
                <Users size={15} />
                {t("settings.openRolesPage")}
              </button>
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">
              <span>{t("settings.selection")}</span>
              {settingsDirty ? <span className="heading-dirty">{t("settings.unsaved")}</span> : <Settings2 size={15} />}
            </div>
            <label className="module-field">
              <span>{t("settings.providerOrder")}</span>
              <input
                value={providerOrder}
                onChange={(event) => setProviderOrder(event.target.value)}
                placeholder="openrouter, openai"
              />
            </label>
            <label className="module-field">
              <span>{t("settings.enabledModels")}</span>
              <textarea
                value={enabledModels}
                onChange={(event) => setEnabledModels(event.target.value)}
                rows={3}
                placeholder={"provider/*\n[{\"path\":\"~/work\",\"models\":[\"provider/model\"]}]"}
              />
            </label>
            <label className="module-field">
              <span>{t("settings.disabledProviders")}</span>
              <textarea
                value={disabledProviders}
                onChange={(event) => setDisabledProviders(event.target.value)}
                rows={2}
                placeholder={"ollama, native"}
              />
            </label>
            <label className="module-field">
              <span>{t("settings.defaultThinking")}</span>
              <StyledSelect
                value={defaultThinkingLevel}
                onValueChange={(next) => setDefaultThinkingLevel(next as SettingsThinkingLevel)}
                options={SETTINGS_THINKING_LEVELS.map((level) => ({ value: level, label: level }))}
                ariaLabel={t("settings.defaultThinking")}
                mono
              />
            </label>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">
              <span>{t("settings.behavior")}</span>
              {settingsDirty ? <span className="heading-dirty">{t("settings.unsaved")}</span> : null}
            </div>
            <label className="module-field">
              <span>{t("settings.personality")}</span>
              <StyledSelect
                value={personality}
                onValueChange={(next) => setPersonality(next)}
                options={PERSONALITY_PRESETS.map((preset) => ({ value: preset, label: preset }))}
                ariaLabel={t("settings.personality")}
                mono
              />
            </label>
            <span className="muted-line">{t("settings.personalityHint")}</span>
            <label className="check-line">
              <input
                type="checkbox"
                checked={extendedContext}
                onChange={(event) => setExtendedContext(event.target.checked)}
              />
              {t("settings.extendedContext")}
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={externalThinking}
                onChange={(event) => setExternalThinking(event.target.checked)}
              />
              {t("settings.externalThinking")}
            </label>
            <label className="module-field">
              <span>{t("settings.imagesUrlMirror")}</span>
              <StyledSelect
                value={imagesUrlsEnabled}
                onValueChange={(next) => setImagesUrlsEnabled(next)}
                options={[
                  { value: "", label: t("settings.imagesUrlMirrorUnset") },
                  { value: "true", label: t("settings.imagesUrlMirrorOn") },
                  { value: "false", label: t("settings.imagesUrlMirrorOff") },
                ]}
                ariaLabel={t("settings.imagesUrlMirror")}
                mono
              />
            </label>
            <span className="muted-line">{t("settings.imagesUrlHint")}</span>
            <label className="module-field">
              <span>{t("settings.compaction")}</span>
              <textarea
                value={compactionJson}
                onChange={(event) => setCompactionJson(event.target.value)}
                rows={4}
                placeholder={
                  '{"asyncEnabled":true,"methodOrder":["remote","snapcompact"]}\n' +
                  t("settings.compactionPlaceholder")
                }
              />
            </label>
            <span className="muted-line">{t("settings.compactionHint")}</span>
            <label className="module-field">
              <span>{t("settings.unexpectedStop")}</span>
              <StyledSelect
                value={unexpectedStopDetection}
                onValueChange={(next) => setUnexpectedStopDetection(next as UnexpectedStopMode)}
                options={UNEXPECTED_STOP_MODES.map((mode) => ({
                  value: mode,
                  label: t(`settings.unexpectedStopModes.${mode}`),
                }))}
                ariaLabel={t("settings.unexpectedStop")}
                mono
              />
            </label>
            <span className="muted-line">{t("settings.unexpectedStopHint")}</span>
            <label className="module-field">
              <span>{t("settings.updateChannel")}</span>
              <StyledSelect
                value={updateChannel}
                onValueChange={(next) => setUpdateChannel(next as UpdateChannel)}
                options={UPDATE_CHANNELS.map((ch) => ({
                  value: ch,
                  label: t(`settings.updateChannels.${ch}`),
                }))}
                ariaLabel={t("settings.updateChannel")}
                mono
              />
            </label>
            <span className="muted-line">{t("settings.updateChannelHint")}</span>
          </div>

          <div className="drawer-actions">
            <button
              className="primary-button full-width"
              onClick={() => void saveSettings()}
              disabled={busy || readOnly || !settingsDirty}
            >
              <Save size={15} />
              {t("settings.saveSettings")}
            </button>
          </div>
        </>
      ) : null}

      {profileTab === "project" ? (
        <div className="drawer-section">
          <div className="drawer-section-title">
            <span>{t("project.projectOverlay")}</span>
            <FolderOpen size={15} />
          </div>
          {api ? <ProjectOverlayBadge api={api} profileId={profileId} onNotice={notify} /> : null}
        </div>
      ) : null}

      {profileTab === "snapshots" ? (
        <div className="drawer-section">
          <div className="drawer-section-title">
            <span>{t("settings.tabSnapshots")}</span>
            <ArchiveRestore size={15} />
          </div>
          <div className="drawer-actions">
            <button className="secondary-button" onClick={() => void createSnapshot()} disabled={busy}>
              <ArchiveRestore size={15} />
              {t("snapshots.create")}
            </button>
          </div>
          {api ? (
            <SnapshotTimeline
              api={api}
              profileId={profileId}
              busy={busy}
              onRestored={(restored, snap) => {
                applyConfig(restored);
                setSnapshot(snap);
              }}
              onNotice={notify}
            />
          ) : null}
          <span className="muted-line">
            {snapshot
              ? t("snapshots.lastWrite", { date: formatDateTime(snapshot.createdAt) })
              : t("snapshots.autoHint")}
          </span>
        </div>
      ) : null}

      {profileTab === "omp" ? (
        <>
          <div className="drawer-section">
            <div className="drawer-section-title">
              <span>{t("omp.omp")}</span>
              <RefreshCw size={15} />
            </div>
            <div className="drawer-actions">
              <button
                className="secondary-button"
                onClick={() => void updateOmp()}
                disabled={busy || updatingOmp || readOnly}
              >
                <RefreshCw size={14} className={updatingOmp ? "spin" : ""} />
                {t("omp.update")}
              </button>
              <button className="secondary-button" onClick={() => void exportCatalog()} disabled={busy}>
                <Download size={14} />
                {t("omp.catalog")}
              </button>
            </div>
          </div>
          <details className="yaml-preview">
            <summary>{t("omp.rawYaml")}</summary>
            <YamlPreview
              files={[
                { name: "models.yml", content: config?.models.raw || t("omp.modelsNotCreated") },
                { name: "config.yml", content: config?.settings.raw || t("omp.settingsNotCreated") },
              ]}
            />
          </details>
        </>
      ) : null}

      {profileTab === "oauth" ? (
        <div className="drawer-section">
          <div className="drawer-section-title">
            <span>{t("settings.tabOAuth")}</span>
            <KeyRound size={16} />
          </div>
          <div className="drawer-actions">
            <button className="secondary-button" onClick={() => void checkAuth("openai-codex", "status")} disabled={busy}>
              Codex
            </button>
            <button className="secondary-button" onClick={() => void checkAuth("anthropic", "status")} disabled={busy}>
              Anthropic
            </button>
          </div>
          {authResult ? <span className="muted-line">{authResult}</span> : null}
        </div>
      ) : null}

      {profileTab === "about" ? (
        <>
          <div className="drawer-section">
            <div className="drawer-section-title">
              <span>{t("about.version")}</span>
              <Zap size={15} />
            </div>
            <div className="detail-grid">
              <span>{t("about.currentVersion")}</span>
              <strong>{appVersion || "—"}</strong>
              <span>{t("about.latestVersion")}</span>
              <strong>
                {updateInfo.lastResult?.available ? (
                  <span className="update-available">{updateInfo.lastResult.manifest.release} ↗</span>
                ) : updateInfo.lastResult ? (
                  t("about.upToDate")
                ) : (
                  "—"
                )}
              </strong>
            </div>
            {updateInfo.lastResult?.available && updateInfo.lastResult.manifest.summary ? (
              <span className="muted-line">{updateInfo.lastResult.manifest.summary}</span>
            ) : null}
            {updateInfo.lastCheckAt ? (
              <span className="muted-line">
                {t("about.lastCheck", { date: formatDateTime(updateInfo.lastCheckAt) })}
              </span>
            ) : null}
            <div className="drawer-actions">
              <button className="secondary-button" onClick={() => void checkForUpdates(true)} disabled={updateInfo.checking}>
                <RefreshCw size={14} className={updateInfo.checking ? "spin" : ""} />
                {t("about.checkNow")}
              </button>
              {updateInfo.lastResult?.available ? (
                <button
                  className="primary-button"
                  onClick={() => void openDownload(updateInfo.lastResult!.manifest.url)}
                >
                  <Download size={14} />
                  {t("about.download")}
                </button>
              ) : null}
            </div>
          </div>
          <div className="drawer-section">
            <div className="drawer-section-title">
              <span>{t("about.updateCheck")}</span>
              <ShieldCheck size={15} />
            </div>
            <label className="check-line">
              <input
                type="checkbox"
                checked={updateInfo.enabled}
                onChange={(event) => void toggleUpdateCheckEnabled(event.target.checked)}
              />
              {t("about.autoCheck")}
            </label>
            <span className="muted-line">{t("about.autoCheckHint")}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
