/**
 * Locale detection with no i18n / DOM imports — so `i18n/index.ts` can pick the
 * initial language before the first React render, without a circular dependency
 * on the controller in `locale.ts`.
 */

export type Locale = "zh" | "en";
export type LocaleChoice = "zh" | "en" | "system";

export const LOCALE_STORAGE_KEY = "omp.locale";

const VALID: LocaleChoice[] = ["zh", "en", "system"];

export function loadLocaleChoice(): LocaleChoice {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return VALID.includes(stored as LocaleChoice) ? (stored as LocaleChoice) : "system";
  } catch {
    return "system";
  }
}

/** Resolves "system" to a concrete locale via navigator.language; non-zh/en falls back to en. */
export function resolveActiveLocale(choice: LocaleChoice): Locale {
  if (choice === "zh" || choice === "en") return choice;
  try {
    const lang = (navigator.language || "en").toLowerCase();
    if (lang.startsWith("zh")) return "zh";
    return "en";
  } catch {
    return "en";
  }
}
