#!/usr/bin/env node
// Platform-keyed driver for the native build steps.
//
// Windows: runs the exact commands `build:secret-bridge` and `build:cli-proxy` always ran
// (dotnet publish of the secret bridge via PowerShell, then the console shim), so packaged
// output stays byte-identical.
// Linux/macOS: exits 0 — the desktop app needs neither artifact (the Linux console shim is a
// shell wrapper committed to the repo, and the credential path does not use the C# bridge).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

if (process.platform !== "win32") {
  console.log(`build:native: nothing to build on ${process.platform}; skipping`);
  process.exit(0);
}

const steps = [
  {
    label: "secret-bridge",
    command: "powershell",
    args: ["-ExecutionPolicy", "Bypass", "-File", path.join(rootDir, "scripts", "build-secret-bridge.ps1")],
  },
  {
    label: "cli-proxy",
    command: "dotnet",
    args: [
      "publish",
      path.join(rootDir, "native", "cli-proxy", "OmpSwitch.CliProxy.csproj"),
      "-c",
      "Release",
      "-r",
      "win-x64",
      "--self-contained",
      "true",
      "-p:PublishSingleFile=true",
      "-p:PublishTrimmed=true",
      "-p:DebugType=None",
      "-p:DebugSymbols=false",
      "-o",
      path.join(rootDir, "native", "cli-proxy", "publish"),
    ],
  },
];

for (const step of steps) {
  console.log(`build:native: ${step.label}...`);
  const result = spawnSync(step.command, step.args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`build:native: ${step.label} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}
