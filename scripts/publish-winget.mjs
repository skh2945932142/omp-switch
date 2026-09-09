#!/usr/bin/env node
// Prepares a winget submission. Human-gated by design: this validates the rendered installer
// manifest and stages the command; the maintainer reviews and runs the submit (or lets CI print
// it). winget-pkgs PRs are always human-reviewed upstream.
//
// Prereq: node scripts/render-packaging.mjs (or the .ps1) against the PUBLISHED release assets.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = path.join(rootDir, "packaging", "out", "winget", "skh2945932142.OMPSwitch.installer.yaml");

if (!fs.existsSync(manifest)) {
  console.error(`Rendered manifest not found: ${manifest}\nRun node scripts/render-packaging.mjs <release-asset-dir> first.`);
  process.exit(1);
}

console.log("Rendered installer manifest:");
console.log(fs.readFileSync(manifest, "utf8"));

if (process.platform !== "win32") {
  console.log("\nwinget validate/submit only run on Windows. On a Windows machine with winget:");
  console.log(`  winget validate --manifest "${path.relative(rootDir, manifest)}"`);
  console.log(`  wingetcreate submit "${path.relative(rootDir, manifest)}"`);
  console.log("The submit opens a PR to microsoft/winget-pkgs — upstream review is the human gate.");
  process.exit(0);
}

try {
  execFileSync("winget", ["validate", "--manifest", manifest], { stdio: "inherit" });
  console.log("\nManifest validates. Submit with:");
  console.log(`  wingetcreate submit "${path.relative(rootDir, manifest)}"`);
} catch (error) {
  console.error("winget validation failed — fix the manifest before submitting.");
  process.exit(1);
}
