import type { Diagnostic } from "@omp-switch/core";
import { ROLE_CATALOG } from "@omp-switch/shared";

/** TUI-owned strings. Shared form/validation error codes map here; i18n is out of scope for v1. */

const SEVERITY_COLOR: Record<Diagnostic["severity"], string> = {
  error: "red",
  warning: "yellow",
  info: "blue",
};

export function formatDiag(diag: Diagnostic): string {
  return `[${diag.severity}] ${diag.code}: ${diag.message}`;
}

export function diagColor(diag: Diagnostic): string {
  return SEVERITY_COLOR[diag.severity] ?? "white";
}

/** English glosses for the role catalog (the renderer resolves these from i18n instead). */
const ROLE_GLOSSES: Record<string, string> = {
  default: "main workhorse",
  smol: "fast and cheap",
  slow: "deep thinking",
  vision: "image understanding",
  plan: "planning",
  designer: "design work",
  commit: "commit messages",
  tiny: "minimal",
  task: "subtasks",
  advisor: "advice",
};

export function roleGloss(id: string): string {
  return ROLE_GLOSSES[id] ?? ROLE_CATALOG.find((entry) => entry.id === id)?.id ?? "custom";
}

export const SAVE_HELP = "y confirm · n cancel";
