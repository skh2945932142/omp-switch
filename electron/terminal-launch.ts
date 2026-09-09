import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Launches an interactive command (OMP's `auth login <provider>` — a prompt-driven flow) in a
 * visible terminal emulator, because the OAuth flow needs a TTY the GUI cannot provide.
 *
 * Resolution order: `$OMP_SWITCH_TERMINAL` (command string, args appended after `-e`), then the
 * first of these found on PATH: xdg-terminal-exec (`--`), gnome-terminal (`--`), konsole (`-e`),
 * xfce4-terminal (`-x`), then the plain `-e` emulators (xterm, alacritty, kitty, foot).
 * Detached + unref'd: the terminal outlives the app and its exit is not our business.
 */

interface TerminalCandidate {
  command: string;
  /** Separator between the emulator's own flags and the command to run. */
  flag: "--" | "-e" | "-x";
}

const PROBE_ORDER: TerminalCandidate[] = [
  { command: "xdg-terminal-exec", flag: "--" },
  { command: "gnome-terminal", flag: "--" },
  { command: "konsole", flag: "-e" },
  { command: "xfce4-terminal", flag: "-x" },
  { command: "xterm", flag: "-e" },
  { command: "alacritty", flag: "-e" },
  { command: "kitty", flag: "-e" },
  { command: "foot", flag: "-e" },
];

export type TerminalLaunchResult =
  | { ok: true; terminal: string }
  | { ok: false; code: "no_terminal"; error: string };

/** Test seam: candidates and PATH lookup are injectable so tests run without a desktop. */
export interface TerminalLaunchOptions {
  which?: (command: string) => string | null;
  spawnTerminal?: (terminal: string, args: string[]) => void;
  candidates?: TerminalCandidate[];
  envTerminal?: string | undefined;
}

function defaultWhich(command: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep probing
    }
  }
  return null;
}

export function launchCommandInTerminal(executable: string, args: string[], options: TerminalLaunchOptions = {}): TerminalLaunchResult {
  const which = options.which ?? defaultWhich;
  const candidates = options.candidates ?? PROBE_ORDER;

  // $OMP_SWITCH_TERMINAL="my-terminal -x" — split on whitespace, command verb first, and append
  // the command after `-e` (the near-universal "run this and show me" flag).
  const envTerminal = options.envTerminal ?? process.env.OMP_SWITCH_TERMINAL;
  if (envTerminal?.trim()) {
    const parts = envTerminal.trim().split(/\s+/);
    if (which(parts[0])) {
      const spawnTerminal = options.spawnTerminal ?? ((terminal, argv) => {
        const child = spawn(terminal, [...argv], { detached: true, stdio: "ignore" });
        child.unref();
      });
      spawnTerminal(parts[0], [...parts.slice(1), "-e", executable, ...args]);
      return { ok: true, terminal: parts[0] };
    }
  }

  for (const candidate of candidates) {
    if (!which(candidate.command)) continue;
    const spawnTerminal = options.spawnTerminal ?? ((terminal, argv) => {
      const child = spawn(terminal, argv, { detached: true, stdio: "ignore" });
      child.unref();
    });
    spawnTerminal(candidate.command, [candidate.flag, executable, ...args]);
    return { ok: true, terminal: candidate.command };
  }

  return {
    ok: false,
    code: "no_terminal",
    error: "No supported terminal emulator was found on PATH (tried xdg-terminal-exec, gnome-terminal, konsole, xfce4-terminal, xterm, alacritty, kitty, foot)",
  };
}
