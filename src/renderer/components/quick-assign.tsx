import type { ReactElement } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ListChecks, Target } from "lucide-react";
import { parseRoleSelector } from "@omp-switch/core/validation";

/**
 * Per-model-row shortcut: assign this provider/model to a role without going through the roles
 * module. The level suffix of the role's current selector is preserved by the caller.
 */

interface QuickAssignProps {
  /** id + Chinese gloss; gloss is empty for custom roles found in config.yml. */
  roles: Array<[string, string]>;
  assignments: Record<string, string>;
  providerId: string;
  modelId: string;
  providerIds: string[];
  onAssign: (roleId: string) => void;
  onOpenRoles?: () => void;
}

export function QuickAssign({ roles, assignments, providerId, modelId, providerIds, onAssign, onOpenRoles }: QuickAssignProps): ReactElement {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button
        className="qa-trigger"
        title="分配到角色"
        aria-label={`将 ${providerId}/${modelId} 分配到角色`}
        onClick={(event) => event.stopPropagation()}
      >
        <Target size={15} />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="dd-menu" align="end" sideOffset={6} collisionPadding={10}>
        <div className="dd-label">设为角色</div>
        {roles.length === 0 ? <div className="dd-item" style={{ cursor: "default", color: "var(--muted)" }}>暂无角色</div> : roles.map(([roleId, label]) => {
          const selector = (assignments[roleId] ?? "").trim();
          const parsed = selector ? parseRoleSelector(selector, providerIds) : null;
          const active = parsed?.kind === "model" && parsed.provider === providerId && parsed.model === modelId;
          return <DropdownMenu.Item key={roleId} className="dd-item" onSelect={() => onAssign(roleId)}>
            <span className="dd-check">{active ? <Check size={13} /> : null}</span>
            <span className="mono">{roleId}</span>
            {label ? <span className="qa-role-hint">{label}</span> : null}
          </DropdownMenu.Item>;
        })}
        {onOpenRoles ? <>
          <DropdownMenu.Separator className="dd-separator" />
          <DropdownMenu.Item className="dd-item" onSelect={onOpenRoles}><ListChecks size={13} />管理角色…</DropdownMenu.Item>
        </> : null}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
