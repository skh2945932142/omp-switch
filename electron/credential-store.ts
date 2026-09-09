import type { CredentialRef, CredentialStatus } from "@omp-switch/core";
import { SecretStoreService } from "./secret-store";
import { LinuxCredentialStore } from "./credential-store-linux";

/**
 * Backend-agnostic credential store. The Windows implementation is the historical
 * SecretStoreService (DPAPI via Electron safeStorage + the C# bridge resolver); Linux uses
 * libsecret keyring entries (or an age keyfile fallback when no Secret Service is available).
 *
 * `describe()` returns the exact `!command` string OMP will execute (without the leading `!`) —
 * the cross-process contract. Windows keeps `"bridge" --secret-get "id" --data-dir "dir"`;
 * Linux libsecret stores each credential as a keyring item and resolves via secret-tool;
 * age decrypts a per-credential file with a keyfile identity. Quoting verified against POSIX sh:
 * unquoted absolute paths for secret-tool, double quotes for paths containing spaces.
 */
export interface CredentialStore {
  put(id: string, label: string, value: string): Promise<void>;
  get(id: string): Promise<string>;
  remove(id: string): Promise<void>;
  status(id: string): Promise<CredentialStatus>;
  list(): Promise<CredentialRef[]>;
}

export type LinuxCredentialBackend = "libsecret" | "age";

export function createCredentialStore(userDataDir: string, platform: NodeJS.Platform = process.platform): CredentialStore {
  if (platform === "win32") return new SecretStoreService(userDataDir);
  if (platform === "linux") return new LinuxCredentialStore(userDataDir);
  throw new Error(`Unsupported platform for the credential vault: ${platform}`);
}
