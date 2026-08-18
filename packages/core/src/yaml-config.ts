import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isMap, Document, parseDocument, stringify, YAMLMap } from "yaml";
import { isDeepStrictEqual } from "node:util";
import { ConfigConflictError, Diagnostic, LoadedConfig } from "./domain";

export interface FileExpectation {
  exists: boolean;
  hash?: string;
}

export async function sha256File(filePath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function parseYaml<T extends Record<string, unknown>>(raw: string, fallback: T): { value: T; document: Document; diagnostics: Diagnostic[] } {
  const document = parseDocument(raw, { prettyErrors: false, keepSourceTokens: true });
  const diagnostics: Diagnostic[] = [];
  if (document.errors.length > 0) {
    diagnostics.push(
      ...document.errors.map((error) => ({
        severity: "error" as const,
        code: "yaml.parse",
        message: error.message,
      })),
    );
    return { value: fallback, document, diagnostics };
  }
  const value = (document.toJS({ mapAsMap: false }) ?? fallback) as T;
  return { value, document, diagnostics };
}

export function parseJson<T extends Record<string, unknown>>(raw: string, fallback: T): { value: T; document: Document; diagnostics: Diagnostic[] } {
  try {
    const parsed = JSON.parse(raw) as T;
    const document = parseDocument(stringify(parsed));
    return { value: parsed, document, diagnostics: [] };
  } catch (error) {
    return {
      value: fallback,
      document: parseDocument(stringify(fallback)),
      diagnostics: [{ severity: "error", code: "json.parse", message: String(error) }],
    };
  }
}

export async function loadStructuredConfig<T extends Record<string, unknown>>(
  candidates: string[],
  fallback: T,
): Promise<LoadedConfig<T>> {
  let selected = candidates[0];
  let raw = "";
  let exists = false;
  let legacy = false;
  for (const candidate of candidates) {
    try {
      raw = await fs.readFile(candidate, "utf8");
      selected = candidate;
      exists = true;
      legacy = candidate.endsWith(".json") || candidate.endsWith(".jsonc");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const parsed = legacy ? parseJson(raw, fallback) : parseYaml(raw, fallback);
  return {
    value: parsed.value,
    raw,
    path: selected,
    hash: sha256Text(raw),
    exists,
    legacy,
    diagnostics: parsed.diagnostics,
  };
}

export async function assertFileExpectation(filePath: string, expected?: FileExpectation): Promise<void> {
  if (!expected) return;
  const currentHash = await sha256File(filePath);
  if ((expected.exists && currentHash !== expected.hash) || (!expected.exists && currentHash !== undefined)) {
    throw new ConfigConflictError(filePath);
  }
}

export async function writeTextAtomic(filePath: string, content: string, expected?: FileExpectation): Promise<string> {
  await assertFileExpectation(filePath, expected);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.omp-switch-${process.pid}-${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(tempPath, "w");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tempPath, filePath);
  return sha256Text(content);
}

export function documentToYaml(document: Document): string {
  return document.toString({ lineWidth: 0 });
}

export function patchModelsYaml(raw: string, before: Record<string, unknown>, after: Record<string, unknown>): string {
  const document = patchDocument(raw, before, after, "providers");
  const root = ensureMap(document);
  const beforeProviders = asRecord(before.providers);
  const afterProviders = asRecord(after.providers);
  const providers = ensureChildMap(document, root, "providers");
  for (const key of Object.keys(beforeProviders)) {
    if (!(key in afterProviders)) providers.delete(key);
  }
  for (const [key, value] of Object.entries(afterProviders)) {
    if (!isDeepStrictEqual(beforeProviders[key], value)) {
      const existing = providers.get(key, true);
      if (isMap(existing) && isRecord(beforeProviders[key]) && isRecord(value)) {
        patchMap(existing, beforeProviders[key], value);
      } else {
        providers.set(key, value);
      }
    }
  }
  return documentToYaml(document);
}

export function patchSettingsYaml(raw: string, before: Record<string, unknown>, after: Record<string, unknown>): string {
  const document = patchDocument(raw, before, after, "modelRoles");
  const root = ensureMap(document);
  const beforeRoles = asRecord(before.modelRoles);
  const afterRoles = asRecord(after.modelRoles);
  if (Object.keys(afterRoles).length === 0) {
    root.delete("modelRoles");
    return documentToYaml(document);
  }
  const roles = ensureChildMap(document, root, "modelRoles");
  for (const key of Object.keys(beforeRoles)) {
    if (!(key in afterRoles)) roles.delete(key);
  }
  for (const [key, value] of Object.entries(afterRoles)) {
    if (!isDeepStrictEqual(beforeRoles[key], value)) roles.set(key, value);
  }
  return documentToYaml(document);
}

function patchDocument(raw: string, before: Record<string, unknown>, after: Record<string, unknown>, key: string): Document {
  if (!raw.trim()) return parseDocument(stringify(after));
  const document = parseDocument(raw, { prettyErrors: false, keepSourceTokens: true });
  if (document.errors.length > 0) return parseDocument(stringify(after));
  if (!document.contents) return parseDocument(stringify(after));
  if (!isMap(document.contents)) return parseDocument(stringify(after));
  if (!document.get(key, true) && key in after) document.set(key, {});
  return document;
}

function ensureMap(document: Document): YAMLMap {
  if (!isMap(document.contents)) document.contents = document.createNode({}) as YAMLMap;
  return document.contents as YAMLMap;
}

function ensureChildMap(document: Document, parent: YAMLMap, key: string): YAMLMap {
  const existing = parent.get(key, true);
  if (isMap(existing)) return existing;
  parent.set(key, {});
  const created = parent.get(key, true);
  if (!isMap(created)) throw new Error(`Unable to create YAML mapping for ${key}`);
  return created;
}

function patchMap(map: YAMLMap, before: Record<string, unknown>, after: Record<string, unknown>): void {
  for (const key of Object.keys(before)) {
    if (!(key in after)) map.delete(key);
  }
  for (const [key, value] of Object.entries(after)) {
    if (isDeepStrictEqual(before[key], value)) continue;
    const existing = map.get(key, true);
    if (isMap(existing) && isRecord(before[key]) && isRecord(value)) {
      patchMap(existing, before[key], value);
    } else {
      map.set(key, value);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
