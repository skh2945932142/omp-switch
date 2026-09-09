import React from "react";
import { Box, Text } from "ink";
import type { OmpProvider, DisabledProviderRule, EnabledModelRule } from "@omp-switch/core";
import { providerModels } from "@omp-switch/shared";

export interface ProvidersScreenProps {
  providers: Array<[string, OmpProvider]>;
  enabledModels?: EnabledModelRule[];
  disabledProviders?: DisabledProviderRule[];
  onToggleDisabled: (id: string) => void;
}

export function ProvidersScreen({ providers, enabledModels, disabledProviders, onToggleDisabled }: ProvidersScreenProps): React.ReactElement {
  const disabledSet = new Set(
    (disabledProviders ?? []).filter((rule): rule is string => typeof rule === "string"),
  );
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold underline>
        Providers
      </Text>
      {providers.length === 0 ? <Text dimColor>no providers configured</Text> : null}
      {providers.map(([id, provider]) => {
        const models = providerModels(provider);
        const disabled = disabledSet.has(id);
        const baseUrl = provider.baseUrl ?? "";
        const authMode = provider.auth ?? "apiKey";
        return (
          <Box key={id} flexDirection="column">
            <Box gap={1}>
              <Text color={disabled ? "gray" : "green"}>{disabled ? "◻" : "◼"}</Text>
              <Text bold color={disabled ? "gray" : undefined}>
                {id}
              </Text>
              <Text dimColor>{baseUrl}</Text>
              <Text dimColor>auth={authMode}</Text>
              <Text dimColor>{models.length} models</Text>
            </Box>
            {models.slice(0, 3).map((model) => {
              const modelId = model.id ?? "?";
              const patterns = (enabledModels ?? []).filter((rule): rule is string => typeof rule === "string");
              const filtered = patterns.some((pattern) => pattern.endsWith("*") ? modelId.startsWith(pattern.slice(0, -1)) : pattern === modelId || pattern === `${id}/${modelId}`) || patterns.length === 0;
              return (
                <Box key={modelId} paddingLeft={4}>
                  <Text color={filtered ? undefined : "gray"}>- {modelId}</Text>
                  {filtered ? null : <Text dimColor color="yellow"> (filtered by enabledModels)</Text>}
                </Box>
              );
            })}
            {models.length > 3 ? (
              <Box paddingLeft={4}>
                <Text dimColor>… {models.length - 3} more</Text>
              </Box>
            ) : null}
            <Text dimColor>  [d] toggle disable (draft: {disabled ? "will enable" : "will disable"})</Text>
          </Box>
        );
      })}
    </Box>
  );
}
