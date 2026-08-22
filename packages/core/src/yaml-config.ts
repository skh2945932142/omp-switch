import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isAlias, isCollection, isMap, isScalar, Document, Node, parseDocument, stringify, visit, YAMLMap } from "yaml";
import { isDeepStrictEqual } from "node:util";
import { ConfigConflictError, Diagnostic, LoadedConfig } from "./domain";

/**
 * Replacing a node that carries an anchor, or that is an alias, would rewrite the value as plain
 * expanded YAML. That silently destroys the anchor other nodes point at, so the write is refused
 * instead. The user keeps a file this app cannot express rather than a corrupted one.
 */
export class YamlAnchorError extends Error {
  constructor(public readonly keyPath: string) {
    super(`Refusing to rewrite ${keyPath}: the value uses a YAML anchor or alias that OMP Switch cannot preserve. Edit the file by hand or remove the anchor.`);
    this.name = "YamlAnchorError";
  }
}

export function documentUsesAnchors(document: Document): boolean {
  let found = false;
  visit(document, (_key, node) => {
    if (isAlias(node) || ((isScalar(node) || isCollection(node)) && (node as Node & { anchor?: string }).anchor)) {
      found = true;
      return visit.BREAK;
    }
    return undefined;
  });
  return found;
}

function assertReplaceable(node: unknown, keyPath: string): void {
  if (node === undefined || node === null) return;
  if (isAlias(node)) throw new YamlAnchorError(keyPath);
  if ((isScalar(node) || isCollection(node)) && (node as Node & { anchor?: string }).anchor) throw new YamlAnchorError(keyPath);
  // A subtree can also hold an anchor another part of the document aliases.
  if (isCollection(node)) {
    let nested = false;
    visit(node as never, (_key, child) => {
      if (isAlias(child) || ((isScalar(child) || isCollection(child)) && (child as Node & { anchor?: string }).anchor)) {
        nested = true;
        return visit.BREAK;
      }
      return undefined;
    });
    if (nested) throw new YamlAnchorError(keyPath);
  }
}

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
  if (documentUsesAnchors(document)) {
    diagnostics.push({
      severity: "warning",
      code: "yaml.anchors",
      message: "This file uses YAML anchors or aliases. Sections that use them cannot be rewritten in place and saving those will be refused.",
    });
  }
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
    if (!(key in afterProviders)) {
      // Deleting the node that carries an anchor leaves every `*alias` dangling, which makes the
      // file unparseable. In-place edits are fine and are handled below.
      assertReplaceable(providers.get(key, true), `providers.${key}`);
      providers.delete(key);
    }
  }
  for (const [key, value] of Object.entries(afterProviders)) {
    if (!isDeepStrictEqual(beforeProviders[key], value)) {
      const existing = providers.get(key, true);
      if (isMap(existing) && isRecord(beforeProviders[key]) && isRecord(value)) {
        patchMap(existing, beforeProviders[key], value, `providers.${key}`);
      } else {
        assertReplaceable(existing, `providers.${key}`);
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
  if (Object.keys(afterRoles).length === 0) root.delete("modelRoles");
  else {
    const roles = ensureChildMap(document, root, "modelRoles");
    for (const key of Object.keys(beforeRoles)) {
      if (!(key in afterRoles)) {
        assertReplaceable(roles.get(key, true), `modelRoles.${key}`);
        roles.delete(key);
      }
    }
    for (const [key, value] of Object.entries(afterRoles)) {
      if (!isDeepStrictEqual(beforeRoles[key], value)) {
        assertReplaceable(roles.get(key, true), `modelRoles.${key}`);
        roles.set(key, value);
      }
    }
  }

  // Scalar and array settings keys replace the whole node — there is no per-element identity to
  // preserve for a string, boolean, or ordered list, and `modelProviderOrder`/`enabledModels`/
  // `disabledProviders` are arrays this app rewrites in full.
  for (const key of ["modelProviderOrder", "enabledModels", "disabledProviders", "defaultThinkingLevel", "extendedContext", "externalThinking", "personality"]) {
    const beforeValue = before[key];
    const afterValue = after[key];
    if (isDeepStrictEqual(beforeValue, afterValue)) continue;
    assertReplaceable(root.get(key, true), key);
    if (afterValue === undefined || (Array.isArray(afterValue) && afterValue.length === 0)) root.delete(key);
    else root.set(key, afterValue);
  }
  // `compaction` and `images` are mappings (`images` is nested), so they are diffed child-by-child
  // the same way `modelRoles` and each provider entry are. Whole-node replacement would drop user
  // comments and any sibling sub-key this app does not write — a real loss for compaction, whose
  // tuning keys a user may edit by hand. An array inside (compaction.methodOrder) is still replaced
  // wholesale, which is correct: an ordered list has no per-element identity to preserve.
  patchChildMap(document, root, before, after, "compaction");
  patchChildMap(document, root, before, after, "images");
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
  // `parent.set(key, {})` stores a plain JS object, not a YAMLMap node — `isMap` then rejects it and
  // downstream `patchMap` (which calls `map.get`/`map.set`) breaks. `createNode` materializes a real
  // map node the tree can hold, which is what every existing caller relied on the key already being.
  parent.set(key, document.createNode({}));
  const created = parent.get(key, true);
  if (!isMap(created)) throw new Error(`Unable to create YAML mapping for ${key}`);
  return created;
}

/**
 * Diffs one settings sub-mapping (currently `compaction` and `images`) child-by-child instead of
 * replacing the whole node, so user comments and sibling keys this app does not write survive an
 * edit. `before`/`after` are the whole settings objects; this reads `before[key]`/`after[key]`.
 * An absent `after[key]` deletes the node; an absent `before[key]` creates it.
 */
function patchChildMap(document: Document, root: YAMLMap, before: Record<string, unknown>, after: Record<string, unknown>, key: string): void {
  const beforeValue = before[key];
  const afterValue = after[key];
  if (isDeepStrictEqual(beforeValue, afterValue)) return;
  if (afterValue === undefined || (isRecord(afterValue) && Object.keys(afterValue).length === 0)) {
    // Empty or cleared: drop the key entirely rather than leaving `compaction: {}`.
    const existing = root.get(key, true);
    assertReplaceable(existing, key);
    root.delete(key);
    return;
  }
  const node = ensureChildMap(document, root, key);
  patchMap(node, asRecord(beforeValue), asRecord(afterValue), key);
}

function patchMap(map: YAMLMap, before: Record<string, unknown>, after: Record<string, unknown>, keyPath: string): void {
  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      assertReplaceable(map.get(key, true), `${keyPath}.${key}`);
      map.delete(key);
    }
  }
  for (const [key, value] of Object.entries(after)) {
    if (isDeepStrictEqual(before[key], value)) continue;
    const existing = map.get(key, true);
    if (isMap(existing) && isRecord(before[key]) && isRecord(value)) {
      patchMap(existing, before[key], value, `${keyPath}.${key}`);
    } else {
      assertReplaceable(existing, `${keyPath}.${key}`);
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
