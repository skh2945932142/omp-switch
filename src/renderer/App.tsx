import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Toaster, toast } from "sonner";
import { AnimatePresence, MotionConfig } from "motion/react";
import { useTranslation } from "react-i18next";
import type {
  ConfigPatch,
  OmpModel,
  OmpProvider,
  ProviderPreset,
  UpdateStatus,
} from "@omp-switch/core";
import { parseRoleSelector, findPlaintextCredentials } from "@omp-switch/core/validation";
import { api } from "./api";
import { useOmpConfig } from "./hooks/use-omp-config";
import {
  buildModels,
  parseCost,
  parseHeaders,
  parseModelOverrides,
  parseObjectJson,
  providerModels,
  useProviderForm,
} from "./hooks/use-provider-form";
import { ModelsModule } from "./models-module";
import { RolesModule } from "./roles-module";
import { GatewayModule, SessionsModule, SurfaceModule } from "./workbench-modules";
import { UsageModule } from "./usage-module";
import { TopBar } from "./components/navigation/topbar";
import { LeftRail, type SectionKey } from "./components/navigation/left-rail";
import { ProviderDrawer } from "./components/drawers/provider-drawer";
import { SettingsDrawer } from "./components/drawers/settings-drawer";
import { DiagnosticsDrawer } from "./components/drawers/diagnostics-drawer";
import { DetailDrawer } from "./components/drawers/detail-drawer";
import { CommandPalette } from "./components/command-palette";
import { ConflictDialog, ConfirmDialog, SavePreviewDialog, ShortcutsDialog } from "./components/save-flow";
import { initTheme, type ThemeChoice } from "./theme";
import { initLocale, type LocaleChoice } from "./locale";
import {
  effectivePreferredProviderId,
  isProviderDisabled,
  mergeProviderApplyDraft,
  providerApplyBlockReason,
  type ProviderApplyBlockReason,
} from "./provider-selection";
import i18n from "./i18n";

export default function App(): ReactElement {
  const { t } = useTranslation();

  const notify = useCallback((item: { tone: "info" | "success" | "error"; text: string }) => {
    if (item.tone === "error") toast.error(item.text);
    else if (item.tone === "success") toast.success(item.text);
    else toast(item.text, { className: "toast-info" });
  }, []);

  const configState = useOmpConfig(api, notify);
  const {
    profiles,
    profileId,
    setProfileId,
    config,
    snapshot,
    setSnapshot,
    readOnly,
    readOnlyReason,
    busy,
    pendingSave,
    setPendingSave,
    conflictDetail,
    setConflictDetail,
    roles,
    savedRoles,
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
    rolesDirty,
    settingsDirty,
    draftProviderOrder,
    draftDisabledProviders,
    providers,
    roleIds,
    providerIds,
    errorDiagnostics,
    enabledFilter,
    setRoleValue,
    load,
    applyConfig,
    settingsPatch,
    saveImmediately,
    requestSave,
    confirmPendingSave,
    saveSettings,
    saveDirty,
    createSnapshot,
  } = configState;

  const [catalog, setCatalog] = useState<ProviderPreset[]>([]);
  const formState = useProviderForm(catalog);
  const {
    formOpen,
    setFormOpen,
    editingProviderId,
    form,
    setForm,
    modelEntries,
    setModelEntries,
    advancedOpen,
    setAdvancedOpen,
    openCreateForm,
    openEditForm,
    closeForm,
    choosePreset,
    updateModelEntry,
  } = formState;

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [applyingProviderId, setApplyingProviderId] = useState<string | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const [section, setSection] = useState<SectionKey>("models");
  const [query, setQuery] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<"settings" | "project" | "snapshots" | "omp" | "oauth" | "about">("settings");
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarCompact, setSidebarCompact] = useState<boolean>(() => {
    try {
      return localStorage.getItem("omp-switch:sidebar-compact") === "true";
    } catch {
      return false;
    }
  });
  const [narrowSidebar, setNarrowSidebar] = useState<boolean>(() => (
    typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(max-width: 760px)").matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(max-width: 760px)");
    const sync = () => setNarrowSidebar(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const effectiveSidebarCompact = sidebarCompact || narrowSidebar;

  function toggleSidebarCompact() {
    setSidebarCompact((current) => {
      const next = !current;
      try {
        localStorage.setItem("omp-switch:sidebar-compact", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() => initTheme());
  const [localeChoice, setLocaleChoiceState] = useState<LocaleChoice>(() => initLocale());
  const [appVersion, setAppVersion] = useState<string>("");
  const [updateInfo, setUpdateInfo] = useState<{
    enabled: boolean;
    lastCheckAt: string | null;
    lastResult: UpdateStatus | null;
    checking: boolean;
  }>({ enabled: true, lastCheckAt: null, lastResult: null, checking: false });
  const [updatingOmp, setUpdatingOmp] = useState(false);
  const [authResult, setAuthResult] = useState<string>("");

  const [confirmAsk, setConfirmAsk] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    action: () => void;
  } | null>(null);

  // Initialize
  useEffect(() => {
    void load(profileId);
    void api.listCatalog().then(setCatalog).catch(() => undefined);
    void api.updateStatus().then((status) => {
      setUpdateInfo((current) => ({
        ...current,
        enabled: status.enabled,
        lastCheckAt: status.lastCheckAt,
        lastResult: status.lastResult,
      }));
    }).catch(() => undefined);
  }, []);

  // Sync selected provider
  useEffect(() => {
    if (providers.length && (!selectedProviderId || !config?.models.value.providers[selectedProviderId])) {
      setSelectedProviderId(providers[0][0]);
    }
  }, [providers, selectedProviderId, config]);

  // Preferred provider
  const preferredProviderId = useMemo(
    () => effectivePreferredProviderId(providerIds, draftProviderOrder),
    [providerIds, draftProviderOrder],
  );

  const selectedProvider = useMemo<OmpProvider | null>(
    () => (selectedProviderId && config?.models.value.providers[selectedProviderId]) || null,
    [selectedProviderId, config],
  );

  const selectedModels = useMemo(
    () => (selectedProvider ? providerModels(selectedProvider) : []),
    [selectedProvider],
  );

  function coverageFor(provider: OmpProvider, id: string): number {
    return providerModels(provider).filter((model) => enabledFilter(id, model.id ?? "")).length;
  }

  function beginAdd() {
    openCreateForm();
    setDrawerOpen(true);
    setProfileDrawerOpen(false);
    setDiagnosticsOpen(false);
  }

  function editProvider(id: string) {
    const provider = config?.models.value.providers[id];
    if (!provider) return;
    openEditForm(id, provider);
    setSelectedProviderId(id);
    setDrawerOpen(true);
    setProfileDrawerOpen(false);
    setDiagnosticsOpen(false);
  }

  function assignModelToRole(roleId: string, providerId: string, modelId: string) {
    const currentSelector = roles[roleId] ?? "";
    const parsed = parseRoleSelector(currentSelector, providerIds);
    const suffix = parsed?.thinking ? `:${parsed.thinking}` : "";
    setRoleValue(roleId, `${providerId}/${modelId}${suffix}`);
    notify({ tone: "info", text: t("toasts.assignedToRole", { model: `${providerId}/${modelId}`, role: roleId }) });
  }

  function providerApplyReason(id: string, provider: OmpProvider): ProviderApplyBlockReason | null {
    return providerApplyBlockReason({
      readOnly,
      disabled: isProviderDisabled(id, draftDisabledProviders, config?.profile.agentDir ?? ""),
      modelCount: providerModels(provider).length,
      auth: provider.auth ?? "apiKey",
      apiKey: provider.apiKey,
    });
  }

  function applyProvider(pId: string): void {
    const provider = config?.models.value.providers[pId];
    if (!provider || busy || pendingSave) return;
    const reason = providerApplyReason(pId, provider);
    if (reason) {
      notify({ tone: "error", text: t(`models.applyBlocked.${reason}`) });
      return;
    }

    let patch: ConfigPatch;
    try {
      const draft = mergeProviderApplyDraft(pId, draftProviderOrder, settingsDirty ? settingsPatch() : {}, roles, rolesDirty);
      patch = draft;
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      return;
    }

    const commit = (nextPatch: ConfigPatch) => {
      setApplyingProviderId(pId);
      void saveImmediately(nextPatch, () => {
        setApplyingProviderId(null);
        setDrawerOpen(false);
        setFormOpen(false);
        setProfileDrawerOpen(false);
        setDiagnosticsOpen(false);
        notify({ tone: "success", text: t("toasts.providerApplied", { provider: pId }) });
      }).finally(() => setApplyingProviderId(null));
    };

    if (config?.models.legacy) {
      setConfirmAsk({
        title: t("providerEditor.migrateLegacy"),
        message: t("providerEditor.migrateConfirm"),
        confirmLabel: t("providerEditor.migrateButton"),
        action: () => commit({ ...patch, confirmLegacyMigration: true }),
      });
      return;
    }
    commit(patch);
  }

  async function saveProvider(): Promise<void> {
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? t("toasts.readonlyConfig") });
      return;
    }
    if (!config || !form.id.trim() || !form.baseUrl.trim()) {
      notify({ tone: "error", text: t("providerEditor.providerIdUrlRequired") });
      return;
    }
    const id = form.id.trim();
    try {
      let apiKeyValue: string | null | undefined = form.auth === "none" ? null : config.models.value.providers[id]?.apiKey;
      let auth = form.auth;
      if (form.key.trim()) {
        const credential = await api.secretPut({ label: `${id} API key`, value: form.key.trim() });
        apiKeyValue = `!${credential.command}`;
        auth = "apiKey";
      }
      const models = buildModels(modelEntries).map((model) => ({ ...model, api: model.api ?? form.api }));
      await requestSave(
        t("providerEditor.saveProvider", { id }),
        {
          provider: {
            id,
            baseUrl: form.baseUrl.trim(),
            api: form.api,
            auth,
            apiKey: apiKeyValue,
            headers: parseHeaders(form.headers),
            compat: parseObjectJson(i18n.t("models.compatLabel"), form.compat),
            modelOverrides: parseModelOverrides(form.overrides),
            models,
            ...(form.discoveryType ? { discovery: { type: form.discoveryType } } : {}),
            authHeader: form.authHeader,
            disableStrictTools: form.disableStrictTools,
            ...(form.transport.trim() ? { transport: form.transport.trim() } : {}),
            remoteCompaction: parseObjectJson(i18n.t("models.remoteCompactionLabel"), form.remoteCompaction),
            cost: parseCost(form.cost),
            codeMode: form.codeMode.trim() ? form.codeMode.trim() : null,
          },
        },
        () => {
          setSelectedProviderId(id);
          closeForm();
          setDrawerOpen(true);
          notify({ tone: "success", text: t("providerEditor.saved", { id }) });
        },
      );
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function handleMigratePlaintext(targetProviderId?: string): Promise<void> {
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? t("toasts.readonlyConfig") });
      return;
    }
    if (!config) return;
    const allPlaintext = findPlaintextCredentials(config.models.value);
    const toMigrate = targetProviderId
      ? allPlaintext.filter((item) => item.providerId === targetProviderId)
      : allPlaintext;
    if (toMigrate.length === 0) {
      notify({ tone: "info", text: t("toasts.noPlaintextFound") });
      return;
    }

    try {
      const providerDrafts = [];
      for (const item of toMigrate) {
        const existing = config.models.value.providers[item.providerId] ?? {};
        const credential = await api.secretPut({
          label: `${item.providerId} API key`,
          value: item.key,
        });
        providerDrafts.push({
          ...existing,
          id: item.providerId,
          apiKey: `!${credential.command}`,
          auth: "apiKey" as const,
        });
      }

      await requestSave(
        toMigrate.length === 1
          ? t("providerEditor.migrateKeyTitle", { id: toMigrate[0].providerId })
          : t("diagnostics.migrateAllPlaintextTitle"),
        {
          providers: providerDrafts,
        },
        () => {
          notify({
            tone: "success",
            text: t("toasts.migratedPlaintextSuccess", { count: toMigrate.length }),
          });
        },
      );
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  function removeProvider(targetId?: string): void {
    const target = targetId ?? selectedProviderId;
    if (!config || !target) return;
    if (readOnly) {
      notify({ tone: "error", text: readOnlyReason ?? t("toasts.readonlyConfig") });
      return;
    }

    const provider = config.models.value.providers[target];
    const modelCount = provider ? providerModels(provider).length : 0;

    // Check which roles reference this provider (directly or via @role chain)
    const allProviderIds = Object.keys(config.models.value.providers);
    const affectedRoles: string[] = [];
    for (const [role, selector] of Object.entries(roles)) {
      if (!selector) continue;
      let curr = selector.trim();
      const seen = new Set<string>([role]);
      while (curr) {
        const parsed = parseRoleSelector(curr, allProviderIds);
        if (!parsed) break;
        if (parsed.kind === "model") {
          if (parsed.provider === target) {
            affectedRoles.push(role);
          }
          break;
        }
        if (parsed.kind === "role") {
          if (seen.has(parsed.role)) break;
          seen.add(parsed.role);
          curr = (roles[parsed.role] ?? "").trim();
        } else {
          break;
        }
      }
    }

    let warningMsg = t("providerEditor.removeConfirmWithCount", { count: modelCount });
    if (affectedRoles.length > 0) {
      const roleNames = affectedRoles.map((r) => `@${r}`).join(", ");
      warningMsg += `\n\n${t("providerEditor.affectedRolesWarning", { roles: roleNames })}`;
    }

    const nextProviderOrder = draftProviderOrder.filter((id) => id !== target);
    const patch: ConfigPatch = {
      removeProviderId: target,
      ...(draftProviderOrder.includes(target) ? { settings: settingsPatch(nextProviderOrder) } : {}),
    };

    setConfirmAsk({
      title: t("providerEditor.removeProvider", { target }),
      message: warningMsg,
      confirmLabel: t("common.delete"),
      danger: true,
      action: () => {
        void requestSave(t("providerEditor.removeProvider", { target }), patch, () => {
          if (selectedProviderId === target) {
            setSelectedProviderId(Object.keys(config.models.value.providers).find((id) => id !== target) ?? null);
          }
          if (formOpen && editingProviderId === target) {
            closeForm();
          }
          notify({ tone: "success", text: t("providerEditor.removed", { target }) });
        });
      },
    });
  }

  async function fetchModels(): Promise<void> {
    if (!form.baseUrl.trim()) return;
    try {
      const result = await api.discover({
        baseUrl: form.baseUrl.trim(),
        apiKey: form.key.trim() || undefined,
        headers: parseHeaders(form.headers) ?? undefined,
        type: (form.discoveryType as "ollama" | "llama.cpp" | "lm-studio" | "openai-models-list" | "proxy" | "litellm") || undefined,
      });
      setModelEntries(
        result.models.map((model) => ({
          raw: model as unknown as OmpModel,
          id: model.id,
          name: model.name ?? "",
          api: form.api,
          reasoning: /reason|think|o[1-9]/i.test(model.id),
          vision: false,
          headers: "",
          compat: "",
          transport: "",
          remoteCompaction: "",
          cost: "",
          imageInputDecoder: "",
          tokenizer: "",
          contextWindow: "128000",
          maxTokens: "16384",
        })),
      );
      notify({ tone: "success", text: t("providerEditor.discovered", { count: result.models.length, ms: result.durationMs }) });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function checkAuth(provider: "openai-codex" | "anthropic", mode: "status" | "login"): Promise<void> {
    try {
      const result = mode === "login" ? await api.authLogin(provider) : await api.authStatus(provider);
      const text = result.code === "terminal_launched"
        ? t("oauth.launched")
        : result.output || result.error || (result.ok ? t("oauth.done") : t("oauth.commandFailed"));
      setAuthResult(text);
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function updateOmp(): Promise<void> {
    setUpdatingOmp(true);
    try {
      const result = await api.updateOmp();
      notify({ tone: result.ok ? "success" : "error", text: result.output || (result.ok ? t("omp.updated") : t("omp.updateFailed")) });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setUpdatingOmp(false);
    }
  }

  async function checkForUpdates(manual: boolean): Promise<void> {
    setUpdateInfo((current) => ({ ...current, checking: true }));
    try {
      const result = await api.checkForUpdates();
      if (result) {
        setUpdateInfo((current) => ({
          ...current,
          checking: false,
          lastCheckAt: result.checkedAt,
          lastResult: result,
        }));
        setAppVersion(result.currentVersion);
        if (manual) {
          notify({
            tone: result.available ? "success" : "info",
            text: result.available
              ? t("about.updateAvailable", { version: result.manifest.release })
              : t("about.upToDate"),
          });
        }
      } else {
        setUpdateInfo((current) => ({ ...current, checking: false }));
        if (manual) notify({ tone: "info", text: t("about.upToDate") });
      }
    } catch {
      setUpdateInfo((current) => ({ ...current, checking: false }));
      if (manual) notify({ tone: "info", text: t("about.checkFailed") });
    }
  }

  async function toggleUpdateCheckEnabled(enabled: boolean): Promise<void> {
    await api.setUpdateCheckEnabled(enabled);
    setUpdateInfo((current) => ({ ...current, enabled }));
  }

  async function openDownload(url: string): Promise<void> {
    try {
      await api.openExternal(url);
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function importCatalogFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      const result = await api.importCatalog(bundle);
      setCatalog(result.entries);
      notify({ tone: "success", text: t("toasts.catalogImported", { count: result.entries.length }) });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function exportCatalog(): Promise<void> {
    try {
      const bundle = await api.exportCatalog();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "omp-switch-catalog.json";
      link.click();
      URL.revokeObjectURL(url);
      notify({ tone: "success", text: t("toasts.catalogExported") });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  function confirmDiscardThen(action: () => void): void {
    if (!rolesDirty && !settingsDirty) {
      action();
      return;
    }
    setConfirmAsk({
      title: t("confirm.discardTitle"),
      message: t("confirm.discardMessage"),
      confirmLabel: t("confirm.discardButton"),
      danger: true,
      action,
    });
  }

  // Keyboard Shortcuts
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveDirty();
        return;
      }
      if (event.key === "?" && !isInput) {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key >= "1" && event.key <= "7" && !isInput) {
        const sections: SectionKey[] = ["models", "roles", "prompts", "skills", "sessions", "usage", "gateway"];
        const idx = Number(event.key) - 1;
        if (sections[idx]) {
          event.preventDefault();
          setSection(sections[idx]);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveDirty]);

  const healthLabel = readOnly
    ? t("health.readonly")
    : errorDiagnostics.length > 0
      ? t("health.hasIssues")
      : config?.models.exists
        ? t("health.connected")
        : t("health.unconfigured");

  const sectionLabels: Record<SectionKey, string> = {
    models: t("nav.models"),
    roles: t("nav.roles"),
    prompts: t("nav.prompts"),
    skills: t("nav.skills"),
    sessions: t("nav.sessions"),
    usage: t("nav.usage"),
    gateway: t("nav.gateway"),
  };

  const isDrawerActive = drawerOpen || formOpen || profileDrawerOpen || diagnosticsOpen;

  return (
    <Tooltip.Provider delayDuration={350}>
      <MotionConfig reducedMotion="user" transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}>
      <div className="app-shell">
        <TopBar
          profileId={profileId}
          profileName={profiles.find((p) => p.id === profileId)?.name ?? profileId}
          readOnly={readOnly}
          hasErrors={errorDiagnostics.length > 0}
          healthLabel={healthLabel}
          onOpenProfileSettings={() => {
            setProfileTab("settings");
            setProfileDrawerOpen(true);
            setDrawerOpen(true);
          }}
          onOpenDiagnostics={() => {
            setDiagnosticsOpen(true);
            setDrawerOpen(true);
          }}
          onOpenPalette={() => setPaletteOpen(true)}
          onRefresh={() => void load(profileId)}
          onCreateSnapshot={() => void createSnapshot()}
          localeChoice={localeChoice}
          onLocaleChange={setLocaleChoiceState}
          themeChoice={themeChoice}
          onThemeChange={setThemeChoice}
          updateInfo={updateInfo}
          onOpenAbout={() => {
            setProfileTab("about");
            setProfileDrawerOpen(true);
            setDrawerOpen(true);
          }}
          onSaveDirty={() => void saveDirty()}
          busy={busy}
          isDirty={rolesDirty || settingsDirty}
        />

        <main className={`app-body${effectiveSidebarCompact ? " rail-compact" : ""}`}>
          <LeftRail
            profileId={profileId}
            profiles={profiles}
            onProfileChange={(next) => confirmDiscardThen(() => { setProfileId(next); void load(next); })}
            agentDir={config?.profile.agentDir}
            section={section}
            onSectionChange={(next) => {
              setSection(next);
              closeForm();
              setDrawerOpen(false);
            }}
            providerCount={providers.length}
            rolesDirty={rolesDirty}
            settingsDirty={settingsDirty}
            errorCount={errorDiagnostics.length}
            onOpenDiagnostics={() => {
              setDiagnosticsOpen(true);
              setDrawerOpen(true);
            }}
            onOpenSettings={() => {
              setProfileTab("settings");
              setProfileDrawerOpen(true);
              setDrawerOpen(true);
            }}
            compact={effectiveSidebarCompact}
            onToggleCompact={toggleSidebarCompact}
          />

          <section className={`workspace-main ${isDrawerActive ? "drawer-active" : ""}`}>
            <div className="section-view" key={section}>
              {section === "models" ? (
                <ModelsModule
                  profileId={profileId}
                  providers={providers}
                  preferredProviderId={preferredProviderId}
                  applyingProviderId={applyingProviderId}
                  expandedProviders={expandedProviders}
                  setExpandedProviders={setExpandedProviders}
                  query={query}
                  setQuery={setQuery}
                  readOnly={readOnly}
                  busy={busy}
                  pendingSave={Boolean(pendingSave)}
                  draftDisabledProviders={draftDisabledProviders}
                  agentDir={config?.profile.agentDir ?? ""}
                  roleIds={roleIds}
                  roles={roles}
                  providerIds={providerIds}
                  onApplyProvider={applyProvider}
                  onEditProvider={editProvider}
                  onRemoveProvider={removeProvider}
                  onAddCustom={beginAdd}
                  onAddPreset={() => {
                    beginAdd();
                    notify({ tone: "info", text: t("models.presetHint") });
                  }}
                  onImportCatalog={(e) => void importCatalogFile(e)}
                  onAssignModelToRole={assignModelToRole}
                  onOpenRoles={() => {
                    setSection("roles");
                    closeForm();
                    setDrawerOpen(false);
                  }}
                  coverageFor={coverageFor}
                  onNotice={notify}
                  onMigratePlaintext={handleMigratePlaintext}
                />
              ) : section === "roles" ? (
                <RolesModule
                  providers={providers}
                  roleIds={roleIds}
                  roles={roles}
                  baseline={savedRoles}
                  profileId={profileId}
                  readOnly={readOnly}
                  busy={busy}
                  onRoleChange={setRoleValue}
                  onSave={() => void saveDirty()}
                  isEnabled={enabledFilter}
                />
              ) : section === "prompts" ? (
                <SurfaceModule api={api} profileId={profileId} kind="prompt" readOnly={readOnly} onNotice={notify} />
              ) : section === "skills" ? (
                <SurfaceModule api={api} profileId={profileId} kind="skill" readOnly={readOnly} onNotice={notify} />
              ) : section === "sessions" ? (
                <SessionsModule api={api} profileId={profileId} onNotice={notify} />
              ) : section === "usage" ? (
                <UsageModule api={api} profileId={profileId} onNotice={notify} />
              ) : (
                <GatewayModule api={api} profileId={profileId} readOnly={readOnly} onNotice={notify} providers={providers} />
              )}
            </div>
          </section>

          <AnimatePresence>
            {isDrawerActive ? (
              <DetailDrawer
                key="detail-drawer"
                eyebrow={profileDrawerOpen
                  ? t("common.profile")
                  : diagnosticsOpen
                    ? t("diagnostics.title")
                    : formOpen
                      ? editingProviderId
                        ? t("providerEditor.edit")
                        : t("providerEditor.new")
                      : t("providerEditor.provider")}
                title={profileDrawerOpen
                  ? profileId
                  : diagnosticsOpen
                    ? t("diagnostics.title")
                    : formOpen
                      ? editingProviderId ?? t("providerEditor.newProvider")
                      : selectedProviderId ?? t("providerEditor.detail")}
                closeLabel={t("common.close")}
                onClose={() => {
                  setDrawerOpen(false);
                  closeForm();
                  setProfileDrawerOpen(false);
                  setDiagnosticsOpen(false);
                }}
              >
                {profileDrawerOpen ? (
                  <SettingsDrawer
                    profileId={profileId}
                    profileTab={profileTab}
                    setProfileTab={setProfileTab}
                    settingsDirty={settingsDirty}
                    providerOrder={providerOrder}
                    setProviderOrder={setProviderOrder}
                    enabledModels={enabledModels}
                    setEnabledModels={setEnabledModels}
                    disabledProviders={disabledProviders}
                    setDisabledProviders={setDisabledProviders}
                    defaultThinkingLevel={defaultThinkingLevel}
                    setDefaultThinkingLevel={setDefaultThinkingLevel}
                    personality={personality}
                    setPersonality={setPersonality}
                    extendedContext={extendedContext}
                    setExtendedContext={setExtendedContext}
                    externalThinking={externalThinking}
                    setExternalThinking={setExternalThinking}
                    imagesUrlsEnabled={imagesUrlsEnabled}
                    setImagesUrlsEnabled={setImagesUrlsEnabled}
                    compactionJson={compactionJson}
                    setCompactionJson={setCompactionJson}
                    unexpectedStopDetection={unexpectedStopDetection}
                    setUnexpectedStopDetection={setUnexpectedStopDetection}
                    updateChannel={updateChannel}
                    setUpdateChannel={setUpdateChannel}
                    saveSettings={saveSettings}
                    busy={busy}
                    readOnly={readOnly}
                    api={api}
                    notify={notify}
                    createSnapshot={createSnapshot}
                    snapshot={snapshot}
                    applyConfig={applyConfig}
                    setSnapshot={setSnapshot}
                    updateOmp={updateOmp}
                    updatingOmp={updatingOmp}
                    exportCatalog={exportCatalog}
                    config={config}
                    checkAuth={checkAuth}
                    authResult={authResult}
                    appVersion={appVersion}
                    updateInfo={updateInfo}
                    checkForUpdates={checkForUpdates}
                    toggleUpdateCheckEnabled={toggleUpdateCheckEnabled}
                    openDownload={openDownload}
                    onOpenRoles={() => {
                      setSection("roles");
                      setProfileDrawerOpen(false);
                      setDrawerOpen(false);
                    }}
                  />
                ) : null}

                {diagnosticsOpen ? (
                  <DiagnosticsDrawer
                    diagnostics={config?.diagnostics ?? []}
                    onMigratePlaintext={handleMigratePlaintext}
                    busy={busy || Boolean(pendingSave)}
                  />
                ) : null}

                {!profileDrawerOpen && !diagnosticsOpen && (formOpen || selectedProvider) ? (
                  <ProviderDrawer
                    selectedProviderId={selectedProviderId}
                    selectedProvider={selectedProvider}
                    selectedModels={selectedModels}
                    formOpen={formOpen}
                    editingProviderId={editingProviderId}
                    form={form}
                    setForm={setForm}
                    modelEntries={modelEntries}
                    setModelEntries={setModelEntries}
                    advancedOpen={advancedOpen}
                    setAdvancedOpen={setAdvancedOpen}
                    catalog={catalog}
                    choosePreset={choosePreset}
                    updateModelEntry={updateModelEntry}
                    fetchModels={fetchModels}
                    saveProvider={saveProvider}
                    editProvider={editProvider}
                    removeProvider={removeProvider}
                    busy={busy}
                    readOnly={readOnly}
                  />
                ) : null}
              </DetailDrawer>
            ) : null}
          </AnimatePresence>
        </main>

        <SavePreviewDialog
          pending={pendingSave}
          busy={busy}
          onClose={() => setPendingSave(null)}
          onConfirm={() => void confirmPendingSave()}
        />
        <ConflictDialog
          detail={conflictDetail}
          busy={busy}
          onClose={() => setConflictDetail(null)}
          onReload={() => {
            setConflictDetail(null);
            void load(profileId);
          }}
        />
        <ConfirmDialog
          open={Boolean(confirmAsk)}
          title={confirmAsk?.title ?? ""}
          message={confirmAsk?.message ?? ""}
          confirmLabel={confirmAsk?.confirmLabel ?? t("common.confirm")}
          danger={confirmAsk?.danger}
          busy={busy}
          onClose={() => setConfirmAsk(null)}
          onConfirm={() => {
            const ask = confirmAsk;
            setConfirmAsk(null);
            ask?.action();
          }}
        />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          sections={(Object.keys(sectionLabels) as SectionKey[]).map((id) => ({
            id,
            label: sectionLabels[id],
          }))}
          profiles={profiles}
          providers={providers.map(([id, provider]) => ({ id, modelCount: providerModels(provider).length }))}
          activeProfileId={profileId}
          onNavigate={(id) => {
            setSection(id as SectionKey);
            closeForm();
            setDrawerOpen(false);
          }}
          onSwitchProfile={(id) => confirmDiscardThen(() => { setProfileId(id); void load(id); })}
          onSelectProvider={(id) => {
            setSection("models");
            setSelectedProviderId(id);
            setExpandedProviders((current) => ({ ...current, [id]: true }));
            closeForm();
            setDrawerOpen(true);
          }}
          actions={[
            { id: "new-provider", label: t("palette.newProvider"), run: beginAdd },
            { id: "save-all", label: t("palette.saveAll"), run: () => { void saveDirty(); } },
            { id: "snapshot", label: t("palette.snapshot"), run: () => { void createSnapshot(); } },
            { id: "reload", label: t("palette.reload"), run: () => { void load(profileId); } },
            { id: "help", label: t("palette.help"), run: () => setShortcutsOpen(true) },
          ]}
        />
        <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <Toaster position="bottom-right" richColors closeButton />
      </div>
      </MotionConfig>
    </Tooltip.Provider>
  );
}
