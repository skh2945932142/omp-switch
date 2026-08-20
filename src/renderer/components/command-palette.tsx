import type { ReactElement } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";

/**
 * Ctrl+K palette: navigate, switch profile, jump to a provider, run frequent actions. Pure
 * dispatch — the item handlers are supplied by App so the palette stays a dumb view.
 */
export interface PaletteSection { id: string; label: string }
export interface PaletteAction { id: string; label: string; run: () => void }

interface PaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: PaletteSection[];
  profiles: Array<{ id: string; name: string }>;
  providers: Array<{ id: string; modelCount: number }>;
  activeProfileId: string;
  onNavigate: (sectionId: string) => void;
  onSwitchProfile: (profileId: string) => void;
  onSelectProvider: (providerId: string) => void;
  actions: PaletteAction[];
}

export function CommandPalette({ open, onOpenChange, sections, profiles, providers, activeProfileId, onNavigate, onSwitchProfile, onSelectProvider, actions }: PaletteProps): ReactElement {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dl-overlay" />
      <DialogPrimitive.Content className="palette-content" aria-label="命令面板">
        <Command label="命令面板" className="palette">
          <Command.Input placeholder="搜索页面、Profile、供应商或动作…" autoFocus />
          <Command.List>
            <Command.Empty>没有匹配项</Command.Empty>
            <Command.Group heading="页面">
              {sections.map((section) => <Command.Item key={section.id} onSelect={() => { onNavigate(section.id); onOpenChange(false); }}>{section.label}</Command.Item>)}
            </Command.Group>
            {profiles.length > 1 ? <Command.Group heading="Profile">
              {profiles.map((profile) => <Command.Item key={profile.id} disabled={profile.id === activeProfileId} onSelect={() => { onSwitchProfile(profile.id); onOpenChange(false); }}>
                {profile.name}{profile.id === activeProfileId ? <span className="qa-role-hint">当前</span> : null}
              </Command.Item>)}
            </Command.Group> : null}
            {providers.length > 0 ? <Command.Group heading="供应商">
              {providers.map((provider) => <Command.Item key={provider.id} value={`provider ${provider.id}`} onSelect={() => { onSelectProvider(provider.id); onOpenChange(false); }}>
                <span className="mono">{provider.id}</span><span className="qa-role-hint">{provider.modelCount} 模型</span>
              </Command.Item>)}
            </Command.Group> : null}
            <Command.Group heading="动作">
              {actions.map((action) => <Command.Item key={action.id} onSelect={() => { action.run(); onOpenChange(false); }}>{action.label}</Command.Item>)}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
