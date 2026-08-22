import type { ReactElement } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { setTheme, type ThemeChoice } from "../theme";

/** Topbar theme switch: light / dark / system. The choice persists and drives color-scheme. */

const CHOICES: Array<{ id: ThemeChoice; labelKey: string; icon: ReactElement }> = [
  { id: "light", labelKey: "themeSwitch.light", icon: <Sun size={14} /> },
  { id: "dark", labelKey: "themeSwitch.dark", icon: <Moon size={14} /> },
  { id: "system", labelKey: "themeSwitch.system", icon: <Monitor size={14} /> },
];

export function ThemeSwitch({ value, onChange }: { value: ThemeChoice; onChange?: (next: ThemeChoice) => void }): ReactElement {
  const { t } = useTranslation();
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button className="icon-button" aria-label={t("topbar.switchTheme")}>
        {value === "light" ? <Sun size={17} /> : value === "dark" ? <Moon size={17} /> : <Monitor size={17} />}
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="dd-menu" align="end" sideOffset={6} collisionPadding={10}>
        <DropdownMenu.RadioGroup value={value} onValueChange={(next) => { const choice = next as ThemeChoice; setTheme(choice); onChange?.(choice); }}>
          {CHOICES.map((item) => <DropdownMenu.RadioItem key={item.id} className="dd-item" value={item.id}>
            <span className="dd-check">{item.icon}</span>
            {t(item.labelKey)}
          </DropdownMenu.RadioItem>)}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
