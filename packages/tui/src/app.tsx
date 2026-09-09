import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { OmpFilesystemAdapter, EffectiveConfig, Diagnostic, ProfileRef, PatchPreview, OmpProvider } from "@omp-switch/core";
import { ConfigConflictError } from "@omp-switch/core";
import { diffLines, trimContext, isProviderDisabled } from "@omp-switch/shared";
import { ProvidersScreen } from "./screens/providers";
import { RolesScreen } from "./screens/roles";
import { SnapshotsScreen } from "./screens/snapshots";
import { DiagnosticsScreen } from "./screens/diagnostics";
import { SavePreview, type SaveRequest } from "./screens/save-diff";
import { formatDiag, roleGloss } from "./strings";

/**
 * Top-level state machine: one screen at a time, one adapter instance, dirty role/settings drafts
 * pending a two-step save (preview → confirm), mirroring the renderer's requestSave contract.
 */

export type Screen = "providers" | "roles" | "snapshots" | "diagnostics";

const SCREEN_ORDER: Screen[] = ["providers", "roles", "snapshots", "diagnostics"];

export interface AppProps {
  adapter: OmpFilesystemAdapter;
}

export function App({ adapter }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("providers");
  const [profiles, setProfiles] = useState<ProfileRef[]>([]);
  const [profileId, setProfileId] = useState("default");
  const [config, setConfig] = useState<EffectiveConfig | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [enabledDrafts, setEnabledDrafts] = useState<string[] | null>(null);
  const [disabledDrafts, setDisabledDrafts] = useState<Array<string> | null>(null);
  const [saveRequest, setSaveRequest] = useState<SaveRequest | null>(null);

  const readOnly = useMemo(() => !adapter.installation.supported, [adapter]);

  const load = useCallback(
    async (targetProfileId: string) => {
      setBusy(true);
      try {
        const [profileList, effective] = await Promise.all([
          adapter.listProfiles(),
          adapter.loadProfile({ id: targetProfileId, name: targetProfileId, kind: "default", agentDir: "" } as ProfileRef),
        ]);
        setProfiles(profileList);
        setProfileId(targetProfileId);
        setConfig(effective);
        setRoleDrafts({});
        setEnabledDrafts(null);
        setDisabledDrafts(null);
        setMessage(adapter.installation.supported ? null : adapter.installation.reason ?? "Read-only: unsupported OMP version");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [adapter],
  );

  useEffect(() => {
    void load(profileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roles = useMemo(() => config?.settings.value.modelRoles ?? {}, [config]);
  const providers = useMemo(() => Object.entries(config?.models.value.providers ?? {}) as Array<[string, OmpProvider]>, [config]);
  const providerIds = useMemo(() => providers.map(([id]) => id), [providers]);
  const diagnostics = useMemo<Diagnostic[]>(() => config?.diagnostics ?? [], [config]);

  const dirtyRoles = useMemo(
    () => Object.entries(roleDrafts).some(([role, value]) => (roles[role] ?? "") !== value),
    [roleDrafts, roles],
  );

  const buildPatch = useCallback(() => {
    const patch: Record<string, unknown> = {};
    if (Object.keys(roleDrafts).length > 0) patch.roleAssignments = { ...roleDrafts };
    if (enabledDrafts !== null) patch.settings = { ...(patch.settings ?? {}), enabledModels: enabledDrafts };
    if (disabledDrafts !== null) patch.settings = { ...(patch.settings ?? {}), disabledProviders: disabledDrafts };
    return patch;
  }, [roleDrafts, enabledDrafts, disabledDrafts]);

  const requestSave = useCallback(() => {
    if (!config) return;
    setSaveRequest({ config, patch: buildPatch() });
  }, [config, buildPatch]);

  const confirmSave = useCallback(
    async (preview: { modelsText: string; settingsText: string; preview: PatchPreview }) => {
      const configAtRequest = saveRequest?.config;
      setSaveRequest(null);
      if (!configAtRequest) return;
      try {
        await adapter.commitPatch(configAtRequest, preview.preview);
        setMessage("Saved (snapshot created)");
        await load(profileId);
      } catch (error) {
        setMessage(error instanceof ConfigConflictError ? "Conflict: files changed externally — reloaded; retry your edit" : error instanceof Error ? error.message : String(error));
        if (error instanceof ConfigConflictError) await load(profileId);
      }
    },
    [adapter, load, profileId],
  );

  useInput((input, key) => {
    if (saveRequest) return; // save dialog owns the keyboard
    if (key.ctrl && input === "s") {
      requestSave();
      return;
    }
    if (input === "q" || (key.ctrl && input === "c")) {
      void exit();
      return;
    }
    if (key.tab) {
      const index = SCREEN_ORDER.indexOf(screen);
      setScreen(SCREEN_ORDER[(index + 1) % SCREEN_ORDER.length]);
    }
    if (input >= "1" && input <= "4") setScreen(SCREEN_ORDER[Number(input) - 1]);
  });

  if (busy && !config) {
    return (
      <Box>
        <Text>Loading {profileId}…</Text>
      </Box>
    );
  }

  if (!config) {
    return (
      <Box flexDirection="column">
        <Text color="red">{message ?? "Failed to load profile"}</Text>
        <Text dimColor>press q to exit</Text>
      </Box>
    );
  }

  const header = (
    <Box justifyContent="space-between" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>omp-switch-tui</Text>
      <Text dimColor>
        {profileId} · {providers.length} providers · {readOnly ? "READ-ONLY" : "writable"} ·
        {dirtyRoles ? " ●" : ""}
      </Text>
    </Box>
  );

  return (
    <Box flexDirection="column" height={process.stdout.rows ?? 24}>
      {header}
      {message ? (
        <Box paddingX={1}>
          <Text color="yellow">{message}</Text>
        </Box>
      ) : null}
      {screen === "providers" ? (
        <ProvidersScreen
          providers={providers}
          enabledModels={enabledDrafts ?? config.settings.value.enabledModels}
          disabledProviders={disabledDrafts ?? config.settings.value.disabledProviders}
          onToggleDisabled={(id) => {
            const current: Array<string | Record<string, unknown>> = disabledDrafts ?? config.settings.value.disabledProviders ?? [];
            const next = current.filter((item) => item !== id);
            if (!current.includes(id)) next.push(id);
            setDisabledDrafts(next.filter((item): item is string => typeof item === "string"));
          }}
        />
      ) : null}
      {screen === "roles" ? (
        <RolesScreen
          roles={roles}
          roleDrafts={roleDrafts}
          providerIds={providerIds}
          onRoleDraft={(role, value) => setRoleDrafts((current) => ({ ...current, [role]: value }))}
        />
      ) : null}
      {screen === "snapshots" ? <SnapshotsScreen adapter={adapter} profileId={profileId} /> : null}
      {screen === "diagnostics" ? <DiagnosticsScreen diagnostics={diagnostics} /> : null}
      <Box borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderColor="gray" paddingX={1}>
        <Text dimColor>1-4/tab screens · ctrl+s save {dirtyRoles ? "(dirty)" : ""} · q quit</Text>
      </Box>
      {saveRequest && config ? (
        <SavePreview adapter={adapter} request={saveRequest} onConfirm={confirmSave} onCancel={() => setSaveRequest(null)} />
      ) : null}
    </Box>
  );
}

export { diffLines, trimContext, formatDiag, roleGloss, isProviderDisabled };
