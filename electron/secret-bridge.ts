import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

function quote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

export async function provisionSecretBridge(sourcePath: string, userDataDir: string, version: string): Promise<string> {
  if (!existsSync(sourcePath)) throw new Error("The OMP Switch secret bridge is unavailable");
  const bridgeDir = path.join(userDataDir, "secret-bridge", `v${version}`);
  const bridgePath = path.join(bridgeDir, "omp-switch-secret.exe");
  if (!existsSync(bridgePath)) {
    await mkdir(bridgeDir, { recursive: true });
    await copyFile(sourcePath, bridgePath);
  }
  return bridgePath;
}

export function createSecretCommand(bridgePath: string, credentialId: string, userDataDir: string): string {
  return `${quote(bridgePath)} --secret-get ${quote(credentialId)} --data-dir ${quote(userDataDir)}`;
}
