import i18n from "./i18n";
import {
  loadLocaleChoice,
  resolveActiveLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
  type LocaleChoice,
} from "./locale-detect";

export type { LocaleChoice };
export { loadLocaleChoice, resolveActiveLocale };

/**
 * Locale controller, structurally aligned with `theme.ts`: a three-way choice persisted in
 * localStorage, with "system" deferring to `navigator.language`. Unlike theme it does NOT sync to
 * the main process — language does not touch the native title-bar chrome (that's theme's job), so
 * the locale is purely a renderer concern.
 */

function apply(choice: LocaleChoice): void {
  const active = resolveActiveLocale(choice);
  document.documentElement.lang = active === "zh" ? "zh-CN" : "en";
  void i18n.changeLanguage(active);
}

let listeningForSystem = false;

function onSystemLanguageChange(): void {
  if (loadLocaleChoice() !== "system") return;
  apply("system");
}

export function initLocale(): LocaleChoice {
  const choice = loadLocaleChoice();
  apply(choice);
  if (!listeningForSystem) {
    listeningForSystem = true;
    try { window.addEventListener("languagechange", onSystemLanguageChange); } catch { /* tests / no window */ }
  }
  return choice;
}

export function setLocale(choice: LocaleChoice): void {
  try { localStorage.setItem(LOCALE_STORAGE_KEY, choice); } catch { /* private mode */ }
  apply(choice);
}

// --- Locale-aware formatting ------------------------------------------------
// Dates are formatted through i18n's resolved language so a language switch re-renders them via
// the useTranslation subscription in the calling component. Reading i18n.language at call time
// (rather than threading a param) keeps every formatter a zero-arg drop-in.

const DATE_LOCALES: Record<Locale, string> = { zh: "zh-CN", en: "en-US" };

function dateLocale(): string {
  return DATE_LOCALES[i18n.language === "en" ? "en" : "zh"];
}

/** Short month/day + time, e.g. "8月22日 14:08". Returns "—" for missing/invalid input. */
export function formatDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(dateLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

/** Time-only, e.g. "14:08". Returns "" for missing/invalid input (so callers can elide it). */
export function formatClock(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(dateLocale(), { hour: "2-digit", minute: "2-digit" }).format(date);
}
