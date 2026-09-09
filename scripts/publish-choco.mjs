#!/usr/bin/env node
// Prepares a Chocolatey submission. Human-gated by design: packs the nuspec locally and prints
// the push command; the maintainer supplies CHOCO_API_KEY and pushes (the feed moderates too).
//
// Prereq: node scripts/render-packaging.mjs (or the .ps1) against the PUBLISHED release assets.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chocoDir = path.join(rootDir, "packaging", "out", "chocolatey");

if (!fs.existsSync(chocoDir)) {
  console.error(`Rendered chocolatey package not found: ${chocoDir}\nRun node scripts/render-packaging.mjs <release-asset-dir> first.`);
  process.exit(1);
}

const nuspec = fs.readdirSync(chocoDir).find((name) => name.endsWith(".nuspec"));
if (!nuspec) {
  console.error(`No .nuspec found in ${chocoDir}`);
  process.exit(1);
}

console.log(`Packing ${nuspec}…`);
try {
  execFileSync("choco", ["pack", path.join(chocoDir, nuspec), "--out", chocoDir], { stdio: "inherit" });
} catch {
  console.error("choco pack failed — is Chocolatey installed? (CI only verifies packing on windows runners.)");
  process.exit(1);
}

console.log("\nPush with (human gate; the feed moderates submissions as well):");
console.log(`  choco push ${path.join(chocoDir, nuspec.replace(/\.nuspec$/, ""))}.nupkg --source https://push.chocolatey.org/ --api-key <CHOCO_API_KEY>`);
