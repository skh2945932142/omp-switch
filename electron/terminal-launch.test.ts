import fs from "node:fs";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { launchCommandInTerminal } from "./terminal-launch";

describe("launchCommandInTerminal", () => {
  it("prefers $OMP_SWITCH_TERMINAL when its command is on PATH", async () => {
    const launches: Array<{ terminal: string; args: string[] }> = [];
    const result = launchCommandInTerminal("/usr/local/bin/omp", ["auth", "login", "anthropic"], {
      which: (command) => (command === "my-term" ? "/usr/bin/my-term" : null),
      spawnTerminal: (terminal, args) => launches.push({ terminal, args }),
      envTerminal: "my-term -x",
    });
    expect(result).toEqual({ ok: true, terminal: "my-term" });
    expect(launches).toHaveLength(1);
    expect(launches[0]).toEqual({ terminal: "my-term", args: ["-x", "-e", "/usr/local/bin/omp", "auth", "login", "anthropic"] });
  });

  it("probes the built-in candidates in order and uses each one's flag", () => {
    const launches: Array<{ terminal: string; args: string[] }> = [];
    const result = launchCommandInTerminal("/usr/bin/omp", ["auth", "login", "openai-codex"], {
      which: (command) => (command === "konsole" ? "/usr/bin/konsole" : null),
      spawnTerminal: (terminal, args) => launches.push({ terminal, args }),
      envTerminal: undefined,
    });
    expect(result).toEqual({ ok: true, terminal: "konsole" });
    expect(launches).toEqual([{ terminal: "konsole", args: ["-e", "/usr/bin/omp", "auth", "login", "openai-codex"] }]);
  });

  it("returns a structured no_terminal error when nothing is found", () => {
    const result = launchCommandInTerminal("/usr/bin/omp", ["auth", "login", "anthropic"], {
      which: () => null,
      envTerminal: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("no_terminal");
  });

  it("resolves executables from a real PATH (integration)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "omp-term-"));
    const fake = path.join(dir, "gnome-terminal");
    await writeFile(fake, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(fake, 0o755);
    const launches: Array<{ terminal: string; args: string[] }> = [];
    const result = launchCommandInTerminal("/usr/bin/omp", ["auth", "login", "anthropic"], {
      which: (command) => {
        const candidate = path.join(dir, command);
        return fs.existsSync(candidate) ? candidate : null;
      },
      spawnTerminal: (terminal, args) => launches.push({ terminal, args }),
      envTerminal: undefined,
    });
    expect(result).toEqual({ ok: true, terminal: "gnome-terminal" });
    expect(launches[0]).toEqual({ terminal: "gnome-terminal", args: ["--", "/usr/bin/omp", "auth", "login", "anthropic"] });
  });
});
