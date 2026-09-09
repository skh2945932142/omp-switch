import type { TFunction } from "i18next";
import { SharedError } from "@omp-switch/shared";

/**
 * Render an error thrown by shared form builders as localized text. SharedError carries an i18n
 * code + params; anything else falls back to its message. Every catch-site that can receive form
 * builder errors should route through here so the toast shows translated text, not raw codes.
 */
export function formatError(error: unknown, t: TFunction): string {
  if (error instanceof SharedError) return t(error.code, error.params);
  return error instanceof Error ? error.message : String(error);
}
