import { describe, expect, it } from "vitest";
import zh from "./locales/zh.json";
import en from "./locales/en.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

function interpolations(value: string): string[] {
  return [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort();
}

describe("locale catalogs", () => {
  const zhFlat = flatten(zh);
  const enFlat = flatten(en);
  const zhKeys = Object.keys(zhFlat).sort();
  const enKeys = Object.keys(enFlat).sort();

  it("keeps zh and en key sets identical", () => {
    expect(enKeys).toEqual(zhKeys);
  });

  it("uses the same interpolation variables on both sides", () => {
    const mismatches = zhKeys.filter((key) => interpolations(zhFlat[key]).join() !== interpolations(enFlat[key]).join());
    expect(mismatches).toEqual([]);
  });
});
