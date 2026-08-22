import type { ReactElement, ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Boxes,
  Coins,
  CornerDownLeft,
  FileCheck2,
  Layers,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
  UserCircle2,
  Users,
  Workflow,
} from "lucide-react";

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

// One quiet glyph per section id — mirrors the left-rail icon language so a search hit reads
// as the same destination, not a new one. ids match App's sectionLabels keys.
function sectionIcon(id: string): ReactElement {
  switch (id) {
    case "models": return <Boxes size={15} />;
    case "roles": return <Users size={15} />;
    case "prompts": return <FileCheck2 size={15} />;
    case "skills": return <Sparkles size={15} />;
    case "sessions": return <Activity size={15} />;
    case "usage": return <Coins size={15} />;
    case "gateway": return <Workflow size={15} />;
    default: return <Layers size={15} />;
  }
}

// Action ids come from App's palette wiring (new-provider, save-all, snapshot, reload, help).
function actionIcon(id: string): ReactElement {
  switch (id) {
    case "new-provider": return <Plus size={15} />;
    case "save-all": return <Save size={15} />;
    case "snapshot": return <Layers size={15} />;
    case "reload": return <RefreshCw size={15} />;
    case "help": return <Settings2 size={15} />;
    default: return <Sparkles size={15} />;
  }
}

export function CommandPalette({ open, onOpenChange, sections, profiles, providers, activeProfileId, onNavigate, onSwitchProfile, onSelectProvider, actions }: PaletteProps): ReactElement {
  const { t } = useTranslation();
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dl-overlay" />
      <DialogPrimitive.Content className="palette-content" aria-label={t("palette.label")}>
        <Command label={t("palette.label")} className="palette">
          <div className="pal-input-wrap">
            <Search size={15} className="pal-search" />
            <Command.Input placeholder={t("palette.placeholder")} autoFocus />
          </div>
          <Command.List>
            <Command.Empty>{t("palette.empty")}</Command.Empty>
            <Command.Group heading={t("palette.headingPages")}>
              {sections.map((section) => <Command.Item key={section.id} onSelect={() => { onNavigate(section.id); onOpenChange(false); }}>
                <span className="pal-icon">{sectionIcon(section.id)}</span>
                <span className="pal-label">{section.label}</span>
                <CornerDownLeft className="pal-enter" size={13} />
              </Command.Item>)}
            </Command.Group>
            {profiles.length > 1 ? <Command.Group heading={t("palette.headingProfile")}>
              {profiles.map((profile) => <Command.Item key={profile.id} disabled={profile.id === activeProfileId} onSelect={() => { onSwitchProfile(profile.id); onOpenChange(false); }}>
                <span className="pal-icon"><UserCircle2 size={15} /></span>
                <span className="pal-label">{profile.name}</span>
                {profile.id === activeProfileId ? <span className="pal-hint">{t("palette.current")}</span> : <CornerDownLeft className="pal-enter" size={13} />}
              </Command.Item>)}
            </Command.Group> : null}
            {providers.length > 0 ? <Command.Group heading={t("palette.headingProviders")}>
              {providers.map((provider) => <Command.Item key={provider.id} value={`provider ${provider.id}`} onSelect={() => { onSelectProvider(provider.id); onOpenChange(false); }}>
                <span className="pal-icon"><Boxes size={15} /></span>
                <span className="pal-label mono">{provider.id}</span>
                <span className="pal-hint">{t("palette.modelCount", { count: provider.modelCount })}</span>
                <CornerDownLeft className="pal-enter" size={13} />
              </Command.Item>)}
            </Command.Group> : null}
            <Command.Group heading={t("palette.headingActions")}>
              {actions.map((action) => <Command.Item key={action.id} onSelect={() => { action.run(); onOpenChange(false); }}>
                <span className="pal-icon">{actionIcon(action.id)}</span>
                <span className="pal-label">{action.label}</span>
                <CornerDownLeft className="pal-enter" size={13} />
              </Command.Item>)}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
