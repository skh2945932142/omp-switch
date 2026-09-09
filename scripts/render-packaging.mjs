#!/usr/bin/env node
// Cross-platform port of scripts/render-packaging.ps1 — identical behavior (placeholders, version
// stamping, asset-name substitution, in-place Scoop bucket update, no-BOM UTF-8, LF untouched),
// so manifest rendering works from any OS.
//
//   node scripts/render-packaging.mjs [sourceDir] [outDir]     (defaults: dist packaging/out)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.resolve(rootDir, process.argv[2] ?? "dist");
const outDir = path.resolve(rootDir, process.argv[3] ?? "packaging/out");

if (!fs.existsSync(sourceDir)) {
  console.error(`Asset directory not found: ${sourceDir}. Run pnpm package:win first.`);
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version;

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function getAsset(pattern, label) {
  // Version-qualified: a dist/ directory that still holds an older build would otherwise be picked
  // alphabetically and stamp the manifests with the wrong release hash.
  const candidates = fs
    .readdirSync(sourceDir)
    .filter((name) => fs.statSync(path.join(sourceDir, name)).isFile())
    .filter((name) => new RegExp(pattern).test(name) && name.includes(version));
  if (candidates.length === 0) throw new Error(`Missing ${label} for version ${version} in ${sourceDir} (pattern: ${pattern})`);
  if (candidates.length > 1) throw new Error(`Ambiguous ${label} for version ${version}: ${candidates.join(", ")}`);
  return { name: candidates[0], hash: sha256(path.join(sourceDir, candidates[0])) };
}

const installer = getAsset("Setup.*\\.exe", "NSIS installer");
const portable = getAsset("-win\\.zip", "portable ZIP");

console.log(`version   : ${version}`);
console.log(`installer : ${installer.name}  ${installer.hash}`);
console.log(`portable  : ${portable.name}  ${portable.hash}`);

const replacements = new Map([
  ["REPLACE_WITH_SHA256_OF_NSIS_INSTALLER", installer.hash],
  ["REPLACE_WITH_SHA256_OF_PORTABLE_ZIP", portable.hash],
]);

const templateRoot = path.join(rootDir, "packaging");
const committedOutputDir = path.resolve(templateRoot, "out");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

for (const template of walk(templateRoot)) {
  if (template.startsWith(outDir) || template.startsWith(committedOutputDir)) continue;
  if (!/\.(yaml|json|nuspec|ps1)$/.test(template)) continue;
  const relative = path.relative(templateRoot, template);
  const target = path.join(outDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let content = fs.readFileSync(template, "utf8");
  for (const [key, value] of replacements) content = content.replaceAll(key, value);
  content = content.replace(/0\.2\.0/g, version);
  content = content.replaceAll(`OMP-Switch-Setup-${version}.exe`, installer.name);
  content = content.replaceAll(`OMP-Switch-${version}-win.zip`, portable.name);
  fs.writeFileSync(target, content, { encoding: "utf8" });
  console.log(`rendered  : ${relative}`);
}

const stillTemplated = walk(outDir).filter((file) => fs.readFileSync(file, "utf8").includes("REPLACE_WITH_"));
if (stillTemplated.length > 0) {
  console.error(`Unreplaced placeholder remains: ${stillTemplated.join(", ")}`);
  process.exit(1);
}

// The Scoop bucket is served from this repository, so its manifest must carry a real hash in a
// tracked file rather than a placeholder. Update it in place.
const bucketPath = path.join(rootDir, "bucket", "omp-switch.json");
if (fs.existsSync(bucketPath)) {
  const bucketUrl = `https://github.com/skh2945932142/omp-switch/releases/download/v${version}/${portable.name}`;
  const manifest = JSON.parse(fs.readFileSync(bucketPath, "utf8"));
  const unchanged =
    manifest.version === version &&
    manifest.architecture["64bit"].url === bucketUrl &&
    manifest.architecture["64bit"].hash === portable.hash;
  if (unchanged) {
    console.log("unchanged : bucket/omp-switch.json already matches the published asset");
  } else {
    manifest.version = version;
    manifest.architecture["64bit"].url = bucketUrl;
    manifest.architecture["64bit"].hash = portable.hash;
    fs.writeFileSync(bucketPath, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8" });
    console.log("updated   : bucket/omp-switch.json (tracked; commit this)");
  }
} else {
  console.warn("bucket/omp-switch.json not found; skipping the Scoop bucket update.");
}

console.log(`\nRendered manifests are in ${outDir}. Review them before submitting to winget-pkgs or the Chocolatey feed.`);
console.log("The hashes above must come from the PUBLISHED release assets, not a local rebuild: a local");
console.log("build is not byte-identical to the CI build, so its hash would never match what users download.");
