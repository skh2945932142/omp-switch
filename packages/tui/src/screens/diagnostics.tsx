import React from "react";
import { Box, Text } from "ink";
import type { Diagnostic } from "@omp-switch/core";
import { formatDiag, diagColor } from "../strings";

export interface DiagnosticsScreenProps {
  diagnostics: Diagnostic[];
}

export function DiagnosticsScreen({ diagnostics }: DiagnosticsScreenProps): React.ReactElement {
  const counts = diagnostics.reduce<Record<string, number>>((acc, diag) => {
    acc[diag.severity] = (acc[diag.severity] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold underline>
        Diagnostics
      </Text>
      <Text dimColor>
        errors {counts.error ?? 0} · warnings {counts.warning ?? 0} · info {counts.info ?? 0}
      </Text>
      {diagnostics.length === 0 ? <Text dimColor>clean — no diagnostics</Text> : null}
      {diagnostics.slice(0, 30).map((diag, index) => (
        <Text key={`${diag.code}-${index}`} color={diagColor(diag)}>
          {formatDiag(diag)}
        </Text>
      ))}
      {diagnostics.length > 30 ? <Text dimColor>… {diagnostics.length - 30} more</Text> : null}
    </Box>
  );
}
