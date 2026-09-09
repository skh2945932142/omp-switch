#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import React from "react";
import { render } from "ink";
import { OmpFilesystemAdapter, detectOmpInstallation, runJsonCli, parseJsonCliArguments, toProfileRef } from "@omp-switch/core";
import { App } from "./app";

/**
 * Entry: non-interactive subcommands (--help / list / validate) answer without a TTY, so the TUI
 * is smoke-testable in CI and usable in scripts. Default: the interactive full-screen app.
 */

function dataDir(): string {
  const base = process.env.OMP_SWITCH_DATA_DIR;
  if (base) return base;
  const home = os.homedir();
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? home, "omp-switch");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "omp-switch");
  return path.join(process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "omp-switch");
}

function makeAdapter(): OmpFilesystemAdapter {
  return new OmpFilesystemAdapter({
    homeDir: os.homedir(),
    snapshotDir: path.join(dataDir(), "snapshots"),
    installation: detectOmpInstallation(),
    pathEnv: process.env,
  });
}

const args = process.argv.slice(2);

if (args[0] === "--help" || args[0] === "-h") {
  process.stderr.write([
    "omp-switch-tui — terminal configuration editor for Oh My Pi",
    "",
    "Usage:",
    "  omp-switch-tui                 interactive app",
    "  omp-switch-tui list            list profiles (non-interactive)",
    "  omp-switch-tui validate [--profile <p>]  validate a profile (non-interactive)",
    "  omp-switch-tui --help          this help",
    "",
    "Environment: PI_CONFIG_DIR / OMP_PROFILE / PI_PROFILE / PI_CODING_AGENT_DIR /",
    "OMP_MODELS_PATH are honored exactly as Oh My Pi honors them. OMP_SWITCH_DATA_DIR",
    "moves the snapshot directory.",
  ].join("\n") + "\n");
  process.exit(0);
}

if (args[0] === "list" || args[0] === "validate") {
  // The headless JSON CLI already implements these; reuse it for identical output semantics.
  try {
    const command = parseJsonCliArguments(args);
    const adapter = makeAdapter();
    const response = await runJsonCli(command, {
      adapter,
      profile: (id) => toProfileRef(adapter.homeDir, id, adapter.pathEnv),
    });
    process.stdout.write(JSON.stringify(response) + "\n");
    process.exit(response.ok ? 0 : 1);
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write("omp-switch-tui: interactive mode needs a TTY; use `list` or `validate` non-interactively\n");
  process.exit(2);
}

const adapter = makeAdapter();
render(React.createElement(App, { adapter }));
