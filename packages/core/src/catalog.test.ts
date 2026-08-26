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

  it("preserves user custom labels when incoming bundle has no explicit label", () => {
    const base = [
      { id: "openai", label: "My Custom OpenAI", baseUrl: "https://api.openai.com/v1", api: "openai-responses", source: "local", version: "1.0" },
    ];
    const incomingNoLabel = {
      version: 1 as const,
      source: "team",
      entries: [
        { id: "openai", label: "", baseUrl: "https://team-proxy.example/v1", api: "openai-responses", source: "team", version: "2.0" },
      ],
    };
    const merged1 = mergeCatalogBundle(base, incomingNoLabel);
    expect(merged1[0].label).toBe("My Custom OpenAI");
    expect(merged1[0].baseUrl).toBe("https://team-proxy.example/v1");

    const incomingWithLabel = {
      version: 1 as const,
      source: "team",
      entries: [
        { id: "openai", label: "Team OpenAI Override", baseUrl: "https://team-proxy.example/v1", api: "openai-responses", source: "team", version: "2.0" },
      ],
    };
    const merged2 = mergeCatalogBundle(base, incomingWithLabel);
    expect(merged2[0].label).toBe("Team OpenAI Override");
  });
});
