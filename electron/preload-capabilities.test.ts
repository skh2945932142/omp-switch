import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("preload capability boundary", () => {
  it("does not expose arbitrary folder or shell opening", async () => {
    const source = await fs.readFile(new URL("./preload.ts", import.meta.url), "utf8");
    expect(source).not.toContain("app:open-folder");
    expect(source).not.toMatch(/openPath|shell\./);
    expect(source).toContain("contextBridge.exposeInMainWorld");
  });
});
