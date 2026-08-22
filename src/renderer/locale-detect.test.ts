import { afterEach, describe, expect, it } from "vitest";
import { loadLocaleChoice, resolveActiveLocale, LOCALE_STORAGE_KEY } from "./locale-detect";

function stubStorage(value: string | null): void {
  const store = new Map<string, string>();
  if (value !== null) store.set(LOCALE_STORAGE_KEY, value);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, next: string) => { store.set(key, next); },
      removeItem: (key: string) => { store.delete(key); },
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("loadLocaleChoice", () => {
  it("defaults to system when storage is missing or unreadable", () => {
    expect(loadLocaleChoice()).toBe("system");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => { throw new Error("blocked"); },
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
    expect(loadLocaleChoice()).toBe("system");
  });

  it("returns a stored zh / en / system choice", () => {
    stubStorage("en");
    expect(loadLocaleChoice()).toBe("en");
    stubStorage("zh");
    expect(loadLocaleChoice()).toBe("zh");
    stubStorage("system");
    expect(loadLocaleChoice()).toBe("system");
  });

  it("ignores an unknown stored value", () => {
    stubStorage("ja");
    expect(loadLocaleChoice()).toBe("system");
  });
});

describe("resolveActiveLocale", () => {
  it("passes through an explicit choice", () => {
    expect(resolveActiveLocale("zh")).toBe("zh");
    expect(resolveActiveLocale("en")).toBe("en");
  });

  it("maps a zh* navigator language to zh", () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "zh-CN" } });
    expect(resolveActiveLocale("system")).toBe("zh");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "zh-TW" } });
    expect(resolveActiveLocale("system")).toBe("zh");
  });

  it("maps any other navigator language to en", () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "ja-JP" } });
    expect(resolveActiveLocale("system")).toBe("en");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "en-GB" } });
    expect(resolveActiveLocale("system")).toBe("en");
  });
});
