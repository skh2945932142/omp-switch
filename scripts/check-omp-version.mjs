#!/usr/bin/env node
// Read-only guard: compares OMP upstream's latest release major against WRITABLE_OMP_SCHEMA_MAJORS.
// Exits 1 with a maintainer checklist when a new major (e.g. 19.x) is not yet supported.
// GitHub API is used with an optional GITHUB_TOKEN (anonymous works but rate-limits behind shared
// proxies); git ls-remote is the fallback for tags when the API is unavailable.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UPSTREAM = "can1357/oh-my-pi";

async function latestUpstreamRelease() {
  const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  try {
    const response = await fetch(`https://api.github.com/repos/${UPSTREAM}/releases/latest`, { headers });
    if (response.ok) {
      const release = await response.json();
      if (release.tag_name) return release.tag_name.replace(/^v/, "");
    }
  } catch {
    // fall through to git
  }
  // git protocol fallback: newest vX.Y.Z tag, not subject to API rate limits.
  const tags = execFileSync("git", ["ls-remote", "--tags", "--refs", `https://github.com/${UPSTREAM}.git`], { encoding: "utf8" });
  const versions = tags
    .split("\n")
    .map((line) => line.split("refs/tags/")[1] ?? "")
    .filter((tag) => /^v?\d+\.\d+\.\d+$/.test(tag))
    .map((tag) => tag.replace(/^v/, ""));
  versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (versions.length === 0) throw new Error("No upstream release tags found");
  return versions[versions.length - 1];
}

function writableMajors() {
  const source = fs.readFileSync(path.join(rootDir, "packages", "core", "src", "schema.ts"), "utf8");
  const match = source.match(/WRITABLE_OMP_SCHEMA_MAJORS\s*=\s*new Set\(\[([^\]]*)\]/);
  if (!match) throw new Error("Could not parse WRITABLE_OMP_SCHEMA_MAJORS from schema.ts");
  return new Set(
    match[1]
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
}

// main() instead of top-level await so Node 22 dev machines can run it (CI runs 24).
async function main() {
  const latest = await latestUpstreamRelease();
  const major = Number(latest.split(".")[0]);
  const supported = writableMajors();

  console.log(`OMP upstream latest: v${latest}`);
  console.log(`Writable schema majors: ${[...supported].sort((a, b) => a - b).join(", ")}`);

  if (!Number.isInteger(major) || major <= 0) {
    console.error(`Could not determine the major of v${latest}`);
    process.exit(1);
  }

  if (supported.has(major)) {
    console.log(`OK: major ${major} is writable`);
    process.exit(0);
  }

  console.error(`ACTION REQUIRED: OMP ${major}.x is released but not in WRITABLE_OMP_SCHEMA_MAJORS.`);
  console.error(`Users on ${major}.x get a read-only app until this lands. Maintainer checklist:`);
  console.error(`1. packages/core/src/schema.ts: add ${major} to WRITABLE_OMP_SCHEMA_MAJORS`);
  console.error(`2. Diff upstream packages/coding-agent/src/config/models-config-schema-bundle.ts and`);
  console.error(`   settings-schema.ts against packages/core/src/validation.ts (root keys, provider`);
  console.error(`   fields, thinking levels, tokenizer families, codeMode values)`);
  console.error(`3. Update packages/core/src/catalog.ts presets for any new/changed providers`);
  console.error(`4. Extend fixtures + tests; update docs/releases note`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
