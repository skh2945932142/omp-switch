import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh.json";
import en from "./locales/en.json";
import { loadLocaleChoice, resolveActiveLocale, type Locale } from "../locale-detect";

export type { Locale };

/**
 * i18n is renderer-only: resources are statically inlined (no http backend), no IPC, no main-process
 * involvement. `fallbackLng` is "zh" because Chinese is the authoritative source the app was written
 * in; a missing English key falls back to Chinese rather than rendering a raw key.
 *
 * `lng` is resolved from localStorage / navigator *before* React mounts, matching the pre-paint
 * `<html lang>` script in index.html — otherwise the first frame always flashes Chinese.
 */
void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: resolveActiveLocale(loadLocaleChoice()),
  fallbackLng: "zh",
  initAsync: false, // resources are inlined; first paint must already be in the stored language
  interpolation: { escapeValue: false }, // React escapes by default
  returnNull: false,
});

export default i18n;
