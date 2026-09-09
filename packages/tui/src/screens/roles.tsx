import React from "react";
import { Box, Text } from "ink";
import { parseRoleSelector } from "@omp-switch/core/validation";
import { KNOWN_ROLE_IDS, resolveChain } from "@omp-switch/shared";
import { roleGloss } from "../strings";

export interface RolesScreenProps {
  roles: Record<string, string>;
  roleDrafts: Record<string, string>;
  providerIds: string[];
  onRoleDraft: (role: string, value: string) => void;
}

export function RolesScreen({ roles, roleDrafts, providerIds, onRoleDraft }: RolesScreenProps): React.ReactElement {
  const roleIds = [...KNOWN_ROLE_IDS, ...Object.keys(roles).filter((id) => !KNOWN_ROLE_IDS.includes(id))];
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold underline>
        Roles
      </Text>
      <Text dimColor>enter: next role · backspace edits · value examples: provider/model, @default, "" (unset)</Text>
      {roleIds.map((role) => {
        const draft = roleDrafts[role] ?? roles[role] ?? "";
        const baseline = roles[role] ?? "";
        const dirty = draft !== baseline;
        const parsed = draft.trim() ? parseRoleSelector(draft, providerIds) : null;
        const chain = resolveChain({ ...roles, ...roleDrafts }, role, providerIds);
        const invalid = Boolean(draft.trim()) && !parsed;
        const finalTarget = chain.final?.kind === "model" ? `${chain.final.provider}/${chain.final.model}` : chain.final?.kind === "role" ? `@${chain.final.role}` : "—";
        return (
          <Box key={role} flexDirection="column">
            <Box gap={1}>
              <Text bold color={dirty ? "cyan" : undefined}>
                {role}
              </Text>
              <Text dimColor>{roleGloss(role)}</Text>
              <Text color={invalid ? "red" : undefined}>{draft || "(unset)"}</Text>
              <Text dimColor>→ {chain.cycle ? "CYCLE!" : finalTarget}</Text>
            </Box>
            {chain.chain.length > 1 ? (
              <Box paddingLeft={2}>
                <Text dimColor>via {chain.chain.join(" → ")}</Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
      <Text dimColor>draft edits: use the input line below (type `role=value` then enter)</Text>
      <RoleInput onDraft={onRoleDraft} />
    </Box>
  );
}

function RoleInput({ onDraft }: { onDraft: (role: string, value: string) => void }): React.ReactElement {
  const [value, setValue] = React.useState("");
  return (
    <Box>
      <Text>[role=value] </Text>
      <Text>{value}</Text>
      <Text dimColor> (enter to apply, esc to clear)</Text>
    </Box>
  );
}
