import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { OmpFilesystemAdapter, EffectiveConfig, PatchPreview, ConfigPatch } from "@omp-switch/core";
import { ConfigConflictError } from "@omp-switch/core";
import { diffLines, trimContext } from "@omp-switch/shared";
import { SAVE_HELP } from "../strings";

export interface SaveRequest {
  config: EffectiveConfig;
  patch: ConfigPatch;
}

export interface SavePreviewProps {
  adapter: OmpFilesystemAdapter;
  request: SaveRequest;
  onConfirm: (preview: { modelsText: string; settingsText: string; preview: PatchPreview }) => void;
  onCancel: () => void;
}

/**
 * Two-step save, mirroring the renderer's requestSave contract: preview the exact post-write file
 * texts as a line diff, then commit. commitPatch re-guards hashes at confirm time, so an external
 * change between preview and confirm surfaces as ConfigConflictError.
 */
export function SavePreview({ adapter, request, onConfirm, onCancel }: SavePreviewProps): React.ReactElement {
  const [state, setState] = useState<{ modelsText: string; settingsText: string; preview: PatchPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const result = adapter.previewPatch(request.config, request.patch);
      const errors = result.preview.diagnostics.filter((diag) => diag.severity === "error");
      if (errors.length > 0) {
        setError(`validation failed: ${errors[0].code}: ${errors[0].message}`);
        return;
      }
      setState(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [adapter, request]);

  useInput((input, key) => {
    if (input === "n" || key.escape) onCancel();
    if (input === "y" && state) onConfirm(state);
  });

  if (error) {
    return (
      <Box borderStyle="round" borderColor="red" flexDirection="column" paddingX={1}>
        <Text color="red">{error}</Text>
        <Text dimColor>n/esc cancel</Text>
      </Box>
    );
  }

  if (!state) {
    return (
      <Box borderStyle="round" borderColor="gray">
        <Text>computing preview…</Text>
      </Box>
    );
  }

  const modelsDiff = trimContext(diffLines(request.config.models.raw, state.modelsText));
  const settingsDiff = trimContext(diffLines(request.config.settings.raw, state.settingsText));
  const hasChanges = modelsDiff.some((line) => line.kind === "add" || line.kind === "del") ||
    settingsDiff.some((line) => line.kind === "add" || line.kind === "del");

  return (
    <Box borderStyle="round" borderColor={hasChanges ? "cyan" : "gray"} flexDirection="column" paddingX={1}>
      <Text bold>{hasChanges ? "Save preview" : "No changes to write"}</Text>
      {hasChanges ? (
        <>
          <DiffBlock label="models.yml" lines={modelsDiff} />
          <DiffBlock label="config.yml" lines={settingsDiff} />
        </>
      ) : null}
      <Text dimColor>{hasChanges ? SAVE_HELP : "n/esc cancel"}</Text>
    </Box>
  );
}

function DiffBlock({ label, lines }: { label: string; lines: ReturnType<typeof trimContext> }): React.ReactElement | null {
  if (!lines.some((line) => line.kind === "add" || line.kind === "del")) return null;
  return (
    <Box flexDirection="column">
      <Text bold underline>
        {label}
      </Text>
      {lines.map((line, index) => {
        if (line.kind === "gap") return <Text key={index} dimColor> ··· </Text>;
        if (line.kind === "ctx") return <Text key={index} dimColor color="gray"> {line.text} </Text>;
        const color = line.kind === "add" ? "green" : "red";
        const marker = line.kind === "add" ? "+" : "-";
        return (
          <Text key={index} color={color}>
            {marker} {line.text}
          </Text>
        );
      })}
    </Box>
  );
}

export { ConfigConflictError };
