import type { ReactElement } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { setLocale, type LocaleChoice } from "../locale";

/** Topbar locale switch: 中文 / English / 跟随系统. Persists and drives i18n.changeLanguage. */

export function LocaleSwitch({ value, onChange }: { value: LocaleChoice; onChange?: (next: LocaleChoice) => void }): ReactElement {
  const { t } = useTranslation();
  const choices: Array<{ id: LocaleChoice; label: string }> = [
    { id: "zh", label: t("localeSwitch.zh") },
    { id: "en", label: t("localeSwitch.en") },
    { id: "system", label: t("localeSwitch.system") },
  ];
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button className="icon-button" aria-label={t("topbar.switchLanguage")}><Languages size={17} /></button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="dd-menu" align="end" sideOffset={6} collisionPadding={10}>
        <DropdownMenu.RadioGroup value={value} onValueChange={(next) => { const choice = next as LocaleChoice; setLocale(choice); onChange?.(choice); }}>
          {choices.map((item) => <DropdownMenu.RadioItem key={item.id} className="dd-item" value={item.id}>
            <span className="dd-check" />
            {item.label}
          </DropdownMenu.RadioItem>)}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
