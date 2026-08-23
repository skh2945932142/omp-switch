import { useCallback, useMemo, useState } from "react";
import type {
  CompactionSettings,
  ConfigPatch,
  Diagnostic,
  EffectiveConfig,
  OmpProvider,
  ProfileRef,
  SettingsThinkingLevel,
  Snapshot,
} from "@omp-switch/core";
import type {
  UnexpectedStopMode,
  UpdateChannel,
} from "@omp-switch/core/validation";
import { KNOWN_ROLES } from "../roles-module";
import type { DisabledProviderRule } from "../provider-selection";
import type { PendingSave } from "../components/save-flow";
import i18n from "../i18n";

export interface SettingsDraft {
  order: string;
  enabled: string;
  disabled: string;
  level: SettingsThinkingLevel;
  compaction: string;
  extendedContext: boolean;
  externalThinking: boolean;
  personality: string;
  imagesUrlsEnabled: string;
  unexpectedStopDetection: string;
  updateChannel: string;
}

export function triStateFromBool(value: boolean | undefined): string {
  return value === undefined ? "" : value ? "true" : "false";
}

export function triStateToBool(value: string): boolean | undefined {
  return value === "" ? undefined : value === "true";
}

export function formatEnabledModelRules(value: Array<string | Record<string, unknown>> | undefined): string {
  return (value ?? []).map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("\n");
}

export function rolesSignature(value: Record<string, string>): string {
  return JSON.stringify(Object.keys(value).sort().map((key) => `${key}=${value[key] ?? ""}`));
}

export function settingsSignature(payload: SettingsDraft): string {
  return JSON.stringify(payload);
}

export function parseObjectJson(label: string, value: string): Record<string, unknown> | null {
  if (!value.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(i18n.t("models.validJsonRequired", { label }));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(i18n.t("models.jsonObjectRequired", { label }));
  }
  return parsed as Record<string, unknown>;
}

export function parseDisabledProviderRules(value: string): Array<string | Record<string, unknown>> {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(i18n.t("settings.disabledProvidersJsonInvalid"));
    }
    if (!Array.isArray(parsed)) throw new Error(i18n.t("settings.disabledProvidersJsonArray"));
    return parsed.map((item) => {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object" && !Array.isArray(item)) return item as Record<string, unknown>;
      throw new Error(i18n.t("settings.disabledProvidersEntry"));
    });
  }
  return trimmed
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (!item.startsWith("{")) return item;
      let parsed: unknown;
      try {
        parsed = JSON.parse(item);
      } catch {
        throw new Error(i18n.t("settings.disabledProvidersJsonEntry"));
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(i18n.t("settings.disabledProvidersObject"));
      }
      return parsed as Record<string, unknown>;
    });
}

export function parseEnabledModelRules(value: string): Array<string | Record<string, unknown>> {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(i18n.t("settings.enabledModelsJsonInvalid"));
    }
    if (!Array.isArray(parsed)) throw new Error(i18n.t("settings.enabledModelsJsonArray"));
    return parsed.map((item) => {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object" && !Array.isArray(item)) return item as Record<string, unknown>;
      throw new Error(i18n.t("settings.enabledModelsEntry"));
    });
  }
  return value
    .split(/\r?\n|,(?=\s*[A-Za-z0-9_.*-]+\/)/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (!item.startsWith("{")) return item;
      let parsed: unknown;
      try {
        parsed = JSON.parse(item);
      } catch {
        throw new Error(i18n.t("settings.enabledModelsJsonEntry"));
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(i18n.t("settings.enabledModelsObject"));
      }
      return parsed as Record<string, unknown>;
    });
}

export function makeEnabledFilter(
  rules: Array<string | Record<string, unknown>> | undefined,
): (providerId: string, modelId: string) => boolean {
  if (!rules?.length) return () => true;
  const matchers = rules
    .filter((rule): rule is string => typeof rule === "string")
    .map((rule) => {
      const pattern = new RegExp(`^${rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      return rule.includes("/")
        ? (providerId: string, modelId: string) => pattern.test(`${providerId}/${modelId}`)
        : (_providerId: string, modelId: string) => pattern.test(modelId);
    });
  return (providerId, modelId) => matchers.some((match) => match(providerId, modelId));
}

export function useOmpConfig(
  api: NonNullable<Window["ompSwitch"]>,
  notify: (toast: { tone: "info" | "success" | "error"; text: string }) => void,
) {
  const [profiles, setProfiles] = useState<ProfileRef[]>([]);
  const [profileId, setProfileId] = useState("default");
  const [config, setConfig] = useState<EffectiveConfig | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [conflictDetail, setConflictDetail] = useState<string | null>(null);

  const [roles, setRoles] = useState<Record<string, string>>({});
  const [savedRoles, setSavedRoles] = useState<Record<string, string>>({});
  const [savedSettings, setSavedSettings] = useState("");

  const [providerOrder, setProviderOrder] = useState("");
  const [enabledModels, setEnabledModels] = useState("");
  const [disabledProviders, setDisabledProviders] = useState("");
  const [defaultThinkingLevel, setDefaultThinkingLevel] = useState<SettingsThinkingLevel>("low");
  const [personality, setPersonality] = useState("default");
  const [extendedContext, setExtendedContext] = useState(true);
  const [externalThinking, setExternalThinking] = useState(false);
  const [imagesUrlsEnabled, setImagesUrlsEnabled] = useState("");
  const [compactionJson, setCompactionJson] = useState("");
  const [unexpectedStopDetection, setUnexpectedStopDetection] = useState<UnexpectedStopMode>("mechanical");
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>("stable");

  const readOnly = Boolean(readOnlyReason);

  const applyConfig = useCallback((incoming: EffectiveConfig) => {
    setConfig(incoming);
    const settings = incoming.settings.value;
    const initialRoles = settings.modelRoles ?? {};
    setRoles(initialRoles);
    setSavedRoles(initialRoles);
    const orderStr = (settings.modelProviderOrder ?? []).join(", ");
    const enabledStr = formatEnabledModelRules(settings.enabledModels);
    const disabledStr = formatEnabledModelRules(settings.disabledProviders);
    const compactionStr = settings.compaction ? JSON.stringify(settings.compaction, null, 2) : "";
    const imagesUrls = triStateFromBool(
      typeof settings.images?.urls === "object" ? settings.images.urls?.enabled : undefined,
    );
    const unexpectedMode = (settings.unexpectedStopDetection as UnexpectedStopMode) ?? "mechanical";
    const channel = (settings.updateChannel as UpdateChannel) ?? "stable";

    setProviderOrder(orderStr);
    setEnabledModels(enabledStr);
    setDisabledProviders(disabledStr);
    setDefaultThinkingLevel(settings.defaultThinkingLevel ?? "low");
    setPersonality(settings.personality ?? "default");
    setExtendedContext(settings.extendedContext ?? true);
    setExternalThinking(settings.externalThinking ?? false);
    setImagesUrlsEnabled(imagesUrls);
    setCompactionJson(compactionStr);
    setUnexpectedStopDetection(unexpectedMode);
    setUpdateChannel(channel);

    setSavedSettings(
      settingsSignature({
        order: orderStr,
        enabled: enabledStr,
        disabled: disabledStr,
        level: settings.defaultThinkingLevel ?? "low",
        compaction: compactionStr,
        extendedContext: settings.extendedContext ?? true,
        externalThinking: settings.externalThinking ?? false,
        personality: settings.personality ?? "default",
        imagesUrlsEnabled: imagesUrls,
        unexpectedStopDetection: unexpectedMode,
        updateChannel: channel,
      }),
    );
  }, []);

  const load = useCallback(
    async (targetProfileId: string) => {
      setBusy(true);
      try {
        const [profileList, effective, snaps, info] = await Promise.all([
          api.listProfiles(),
          api.loadProfile(targetProfileId),
          api.listSnapshots(targetProfileId),
          api.getInfo(),
        ]);
        setProfiles(profileList);
        setProfileId(targetProfileId);
        setReadOnlyReason(info.installation.supported ? null : info.installation.reason ?? i18n.t("toasts.readonlyConfig"));
        applyConfig(effective);
        setSnapshot(snaps[0] ?? null);
      } catch (error) {
        notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      } finally {
        setBusy(false);
      }
    },
    [api, applyConfig, notify],
  );

  const currentSettingsDraft = useMemo<SettingsDraft>(
    () => ({
      order: providerOrder,
      enabled: enabledModels,
      disabled: disabledProviders,
      level: defaultThinkingLevel,
      compaction: compactionJson,
      extendedContext,
      externalThinking,
      personality,
      imagesUrlsEnabled,
      unexpectedStopDetection,
      updateChannel,
    }),
    [
      providerOrder,
      enabledModels,
      disabledProviders,
      defaultThinkingLevel,
      compactionJson,
      extendedContext,
      externalThinking,
      personality,
      imagesUrlsEnabled,
      unexpectedStopDetection,
      updateChannel,
    ],
  );

  const rolesDirty = useMemo(() => rolesSignature(roles) !== rolesSignature(savedRoles), [roles, savedRoles]);
  const settingsDirty = useMemo(
    () => settingsSignature(currentSettingsDraft) !== savedSettings,
    [currentSettingsDraft, savedSettings],
  );

  const draftProviderOrder = useMemo(
    () => providerOrder.split(",").map((s) => s.trim()).filter(Boolean),
    [providerOrder],
  );

  const draftDisabledProviders = useMemo<DisabledProviderRule[]>(() => {
    try {
      return parseDisabledProviderRules(disabledProviders);
    } catch {
      return [];
    }
  }, [disabledProviders]);

  const providers = useMemo<Array<[string, OmpProvider]>>(
    () => Object.entries(config?.models.value.providers ?? {}),
    [config],
  );

  const roleIds = useMemo<Array<[string, string]>>(() => {
    const fromConfig = Object.keys(config?.settings.value.modelRoles ?? {});
    const combined = new Map(KNOWN_ROLES);
    for (const id of fromConfig) {
      if (!combined.has(id)) combined.set(id, "");
    }
    return Array.from(combined.entries());
  }, [config]);

  const providerIds = useMemo(() => providers.map(([id]) => id), [providers]);

  const errorDiagnostics = useMemo(
    () => (config?.diagnostics ?? []).filter((item) => item.severity === "error"),
    [config],
  );

  const enabledFilter = useMemo(() => {
    try {
      return makeEnabledFilter(parseEnabledModelRules(enabledModels));
    } catch {
      return () => true;
    }
  }, [enabledModels]);

  const setRoleValue = useCallback((role: string, value: string) => {
    setRoles((current) => ({ ...current, [role]: value }));
  }, []);

  function handleSaveError(error: unknown) {
    if (error && typeof error === "object" && "conflict" in error && (error as { conflict: boolean }).conflict) {
      setConflictDetail(error instanceof Error ? error.message : String(error));
      notify({ tone: "error", text: i18n.t("toasts.conflictDetected") });
      return;
    }
    notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
  }

  const settingsPatch = useCallback(
    (providerOrderOverride?: string[]): NonNullable<ConfigPatch["settings"]> => {
      const compactionParsed = compactionJson.trim() ? parseObjectJson("compaction", compactionJson) : null;
      const imagesBase = config?.settings.value.images ?? {};
      const urlsEnabled = triStateToBool(imagesUrlsEnabled);
      const images =
        urlsEnabled === undefined
          ? undefined
          : {
              ...imagesBase,
              urls: {
                ...(typeof imagesBase.urls === "object" && imagesBase.urls ? imagesBase.urls : {}),
                enabled: urlsEnabled,
              },
            };
      return {
        modelProviderOrder: providerOrderOverride ?? draftProviderOrder,
        enabledModels: parseEnabledModelRules(enabledModels),
        disabledProviders: parseDisabledProviderRules(disabledProviders),
        defaultThinkingLevel,
        ...(compactionParsed ? { compaction: compactionParsed as CompactionSettings } : {}),
        extendedContext,
        externalThinking,
        personality,
        unexpectedStopDetection,
        updateChannel,
        ...(images ? { images } : {}),
      };
    },
    [
      compactionJson,
      config,
      imagesUrlsEnabled,
      draftProviderOrder,
      enabledModels,
      disabledProviders,
      defaultThinkingLevel,
      extendedContext,
      externalThinking,
      personality,
      unexpectedStopDetection,
      updateChannel,
    ],
  );

  const runSave = useCallback(
    async (title: string, patch: ConfigPatch, done?: () => void) => {
      setBusy(true);
      try {
        const preview = await api.preview(profileId, patch);
        setPendingSave({
          title,
          beforeModels: config?.models.raw ?? "",
          beforeSettings: config?.settings.raw ?? "",
          afterModels: preview.modelsText,
          afterSettings: preview.settingsText,
          commit: async () => {
            const result = await api.save(profileId, patch);
            applyConfig(result.config);
            setSnapshot(result.snapshot);
            done?.();
          },
        });
      } catch (error) {
        handleSaveError(error);
      } finally {
        setBusy(false);
      }
    },
    [api, profileId, config, applyConfig, notify],
  );

  const saveImmediately = useCallback(
    async (patch: ConfigPatch, done?: () => void) => {
      if (readOnly) {
        notify({ tone: "error", text: readOnlyReason ?? i18n.t("toasts.readonlyConfig") });
        return;
      }
      setBusy(true);
      try {
        const result = await api.save(profileId, patch);
        applyConfig(result.config);
        setSnapshot(result.snapshot);
        done?.();
      } catch (error) {
        handleSaveError(error);
      } finally {
        setBusy(false);
      }
    },
    [api, profileId, readOnly, readOnlyReason, applyConfig, notify],
  );

  const requestSave = useCallback(
    async (title: string, patch: ConfigPatch, done?: () => void) => {
      if (readOnly) {
        notify({ tone: "error", text: readOnlyReason ?? i18n.t("toasts.readonlyConfig") });
        return;
      }
      await runSave(title, patch, done);
    },
    [readOnly, readOnlyReason, runSave, notify],
  );

  const confirmPendingSave = useCallback(async () => {
    if (!pendingSave) return;
    setBusy(true);
    try {
      await pendingSave.commit();
      setPendingSave(null);
    } catch (error) {
      setPendingSave(null);
      handleSaveError(error);
    } finally {
      setBusy(false);
    }
  }, [pendingSave, notify]);

  const saveRoles = useCallback((): Promise<void> => {
    return requestSave(i18n.t("settings.saveRoles"), { roleAssignments: roles }, () =>
      notify({ tone: "success", text: i18n.t("settings.savedRoles") }),
    );
  }, [requestSave, roles, notify]);

  const saveSettings = useCallback((): Promise<void> => {
    return requestSave(i18n.t("settings.saveSettingsTitle"), { settings: settingsPatch() }, () =>
      notify({ tone: "success", text: i18n.t("settings.savedSettings") }),
    );
  }, [requestSave, settingsPatch, notify]);

  const saveDirty = useCallback((): Promise<void> => {
    if (rolesDirty && settingsDirty) {
      return requestSave(
        i18n.t("settings.saveRolesAndSettings"),
        { roleAssignments: roles, settings: settingsPatch() },
        () => notify({ tone: "success", text: i18n.t("settings.savedRolesAndSettings") }),
      );
    }
    if (rolesDirty) return saveRoles();
    if (settingsDirty) return saveSettings();
    return Promise.resolve();
  }, [rolesDirty, settingsDirty, requestSave, roles, settingsPatch, saveRoles, saveSettings, notify]);

  const createSnapshot = useCallback(async () => {
    setBusy(true);
    try {
      const snap = await api.snapshot(profileId);
      setSnapshot(snap);
      notify({ tone: "success", text: i18n.t("toasts.snapshotCreated") });
    } catch (error) {
      notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }, [api, profileId, notify]);

  return {
    profiles,
    setProfiles,
    profileId,
    setProfileId,
    config,
    setConfig,
    snapshot,
    setSnapshot,
    readOnly,
    readOnlyReason,
    busy,
    setBusy,
    pendingSave,
    setPendingSave,
    conflictDetail,
    setConflictDetail,
    roles,
    setRoles,
    savedRoles,
    setSavedRoles,
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
    runSave,
    saveImmediately,
    requestSave,
    confirmPendingSave,
    saveRoles,
    saveSettings,
    saveDirty,
    createSnapshot,
  };
}
