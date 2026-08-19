import { describe, expect, it } from "vitest";
import { getProviderPreset, listProviderPresets, mergeCatalogBundle, validateCatalogBundle } from "./catalog";

describe("provider catalog", () => {
  it("ships a searchable catalog with more than fifty presets", () => {
    expect(listProviderPresets().length).toBeGreaterThanOrEqual(50);
    expect(listProviderPresets("ollama").map((preset) => preset.id)).toEqual(["ollama"]);
  });

  it("keeps endpoint-dependent presets explicit", () => {
    expect(getProviderPreset("azure-openai")).toMatchObject({ requiresBaseUrl: true, api: "azure-openai-responses" });
  });

  it("validates and merges versioned catalog imports without allowing duplicate IDs", () => {
    const bundle = validateCatalogBundle({ version: 1, source: "team", entries: [{ id: "team-provider", label: "Team", baseUrl: "https://team.example/v1", api: "openai-completions", source: "team", version: "1.0.0" }] });
    expect(bundle.entries).toHaveLength(1);
    const merged = mergeCatalogBundle(listProviderPresets(), bundle);
    expect(merged.find((item) => item.id === "team-provider")?.source).toBe("team");
    expect(() => validateCatalogBundle({ version: 2, source: "bad", entries: [] })).toThrow();
  });
});
