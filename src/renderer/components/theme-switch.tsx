import type { ReactElement } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Monitor, Moon, Sun } from "lucide-react";
import { setTheme, type ThemeChoice } from "../theme";

/** Topbar theme switch: light / dark / system. The choice persists and drives color-scheme. */

const CHOICES: Array<{ id: ThemeChoice; label: string; icon: ReactElement }> = [
  { id: "light", label: "浅色", icon: <Sun size={14} /> },
  { id: "dark", label: "深色", icon: <Moon size={14} /> },
  { id: "system", label: "跟随系统", icon: <Monitor size={14} /> },
];

export function ThemeSwitch({ value, onChange }: { value: ThemeChoice; onChange?: (next: ThemeChoice) => void }): ReactElement {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button className="icon-button" aria-label="切换主题">
        {value === "light" ? <Sun size={17} /> : value === "dark" ? <Moon size={17} /> : <Monitor size={17} />}
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="dd-menu" align="end" sideOffset={6} collisionPadding={10}>
        <DropdownMenu.RadioGroup value={value} onValueChange={(next) => { const choice = next as ThemeChoice; setTheme(choice); onChange?.(choice); }}>
          {CHOICES.map((item) => <DropdownMenu.RadioItem key={item.id} className="dd-item" value={item.id}>
            <span className="dd-check">{item.icon}</span>
            {item.label}
          </DropdownMenu.RadioItem>)}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
