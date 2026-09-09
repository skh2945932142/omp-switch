#!/usr/bin/env node
// electron-builder afterPack hook. Copies the Linux console shim (bin/omp-switch-cli) next to the
// packaged executable and marks it executable — FileSet has no `mode` field, so permissions are
// the hook's job. Only acts on Linux builds; Windows is a no-op (its console shim is cli-proxy).
import { copyFile, chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export default async function afterPack(context) {
  if (context.electronPlatformName !== "linux") return;
  const appOut = context.appOutDir;
  const destination = path.join(appOut, "omp-switch-cli");
  await copyFile(path.join(rootDir, "bin", "omp-switch-cli"), destination);
  await chmod(destination, 0o755);
  console.log(`afterPack: installed Linux console shim at ${destination}`);
}
