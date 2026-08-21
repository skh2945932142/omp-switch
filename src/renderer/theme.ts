/**
 * Theme controller: "light" | "dark" | "system", persisted in localStorage.
 *
 * The mechanism is `color-scheme` on :root. tokens.css defines every color once with
 * light-dark(); pinning color-scheme to one side resolves them, leaving it as
 * "light dark" follows the OS. No selector duplication anywhere.
 *
 * In Electron the main process is told so the native frame (title bar overlay buttons)
 * follows too; in a plain browser that call just fails silently.
 */

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "omp.theme";
const VALID: ThemeChoice[] = ["light", "dark", "system"];

export function loadThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return VALID.includes(stored as ThemeChoice) ? (stored as ThemeChoice) : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

/** Best-effort push to the main process so the native frame (overlay buttons) follows. */
function syncNativeTheme(choice: ThemeChoice): void {
  const bridge = window.ompSwitch;
  if (!bridge) return; // Browser preview: no bridge, nothing to sync.
  void bridge.setTheme(choice).catch(() => undefined);
}

export function initTheme(): ThemeChoice {
  const choice = loadThemeChoice();
  apply(choice);
  syncNativeTheme(choice);
  return choice;
}

export function setTheme(choice: ThemeChoice): void {
  try { localStorage.setItem(STORAGE_KEY, choice); } catch { /* private mode */ }
  apply(choice);
  syncNativeTheme(choice);
}
