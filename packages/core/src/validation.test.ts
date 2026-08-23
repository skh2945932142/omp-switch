import { describe, expect, it } from "vitest";
import { findMisusedRoleThinkingSuffix, looksLikePlaintextSecret, parseRoleSelector, validateModelsDocument, validateRoleSelector, validateSettingsDocument } from "./validation";

describe("OMP configuration validation", () => {
  it("requires baseUrl, api and apiKey for a custom model provider", () => {
    const diagnostics = validateModelsDocument({
      providers: {
        demo: { models: [{ id: "demo-model" }] },
      },
    });
    expect(diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["provider.baseUrl", "provider.api", "provider.apiKey"]),
    );
  });

  it("rejects unknown root keys because OMP does", () => {
    const diagnostics = validateModelsDocument({ providers: {}, extra: true });
    expect(diagnostics.some((item) => item.code === "root.unknown-key")).toBe(true);
  });

  it("accepts exact provider/model and role selectors", () => {
    expect(validateRoleSelector("openai/gpt-4.1")).toBe(true);
    expect(validateRoleSelector("openai/gpt-4.1:high")).toBe(true);
    expect(validateRoleSelector("openrouter/openai/gpt-4.1:max", ["openrouter"])).toBe(true);
    expect(validateRoleSelector("@slow")).toBe(true);
    expect(validateRoleSelector("@slow:xhigh")).toBe(true);
    expect(validateRoleSelector("*")).toBe(true);
    expect(validateRoleSelector("bad selector")).toBe(false);
    expect(validateRoleSelector("@slow:turbo")).toBe(false);
  });

  it("rejects role suffixes OMP only accepts elsewhere", () => {
    // `off` is valid for --model patterns and `auto` for defaultThinkingLevel, but neither is a
    // documented role suffix, so they must not round-trip as one.
    expect(validateRoleSelector("*:auto")).toBe(false);
    expect(parseRoleSelector("openai/gpt-5:high")).toMatchObject({ thinking: "high" });
    expect(parseRoleSelector("openai/gpt-5:auto", ["openai"])).toMatchObject({ model: "gpt-5:auto" });
    expect(findMisusedRoleThinkingSuffix("openai/gpt-5:auto")).toBe("auto");
    expect(findMisusedRoleThinkingSuffix("openai/gpt-5:off")).toBe("off");
    expect(findMisusedRoleThinkingSuffix("openai/gpt-5:high")).toBeNull();
  });

  it("keeps colon-bearing model ids intact", () => {
    // Ollama ids carry a colon, so only documented level names may be stripped as a suffix.
    expect(parseRoleSelector("ollama/llama3.1:8b", ["ollama"])).toEqual({ kind: "model", provider: "ollama", model: "llama3.1:8b" });
  });

  it("rejects defaultThinkingLevel values OMP does not accept", () => {
    // `off` is a real thinking level for --model but not for this setting.
    const diagnostics = validateSettingsDocument({ defaultThinkingLevel: "off" as never });
    expect(diagnostics.some((item) => item.code === "settings.defaultThinkingLevel")).toBe(true);
    expect(validateSettingsDocument({ defaultThinkingLevel: "auto" })).toEqual([]);
  });

  it("warns about a role whose suffix OMP will read as part of the model id", () => {
    const diagnostics = validateSettingsDocument({ modelRoles: { default: "openai/gpt-5:auto" } }, ["openai"]);
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: "warning", code: "settings.role-thinking-suffix", path: "modelRoles.default" }),
    ]);
  });

  it("validates current OMP settings fields", () => {
    const diagnostics = validateSettingsDocument({
      modelRoles: { default: "openrouter/openai/gpt-4.1:max" },
      modelProviderOrder: ["openrouter"],
      enabledModels: ["openrouter/*"],
      defaultThinkingLevel: "xhigh",
    }, ["openrouter"]);
    expect(diagnostics).toEqual([]);
  });

  it("resolves the longest provider prefix without truncating slash-heavy model IDs", () => {
    expect(parseRoleSelector("openrouter-eu/company/model:max", ["openrouter", "openrouter-eu"])).toEqual({
      kind: "model",
      provider: "openrouter-eu",
      model: "company/model",
      thinking: "max",
    });
  });

  it("keeps the custom-model API key requirement even when auth is oauth", () => {
    expect(validateModelsDocument({ providers: { codex: { baseUrl: "https://api.openai.com/v1", auth: "oauth", api: "openai-codex-responses", models: [{ id: "gpt-5" }] } } }).some((item) => item.code === "provider.apiKey")).toBe(true);
  });

  it("accepts documented remote compaction and scoped enabled model rules", () => {
    expect(validateModelsDocument({ providers: { compact: { remoteCompaction: { enabled: true, endpoint: "https://compact.example", v2StreamingEnabled: false } } } })).toEqual([]);
    expect(validateSettingsDocument({ enabledModels: ["openai/*", { path: "~/work", models: ["openai/gpt-5"] }] })).toEqual([]);
  });

  it("rejects an override-only provider that carries no override fields", () => {
    // OMP requires at least one of baseUrl/apiKey/headers/compat/disableStrictTools/
    // modelOverrides/discovery/remoteCompaction (or auth: none) when models is empty.
    expect(validateModelsDocument({ providers: { hollow: {} } })).toEqual([
      expect.objectContaining({ severity: "error", code: "provider.empty", path: "providers.hollow" }),
    ]);
    expect(validateModelsDocument({ providers: { hollow: { models: [] } } }).some((item) => item.code === "provider.empty")).toBe(true);
    expect(validateModelsDocument({ providers: { keyless: { auth: "none" } } })).toEqual([]);
    expect(validateModelsDocument({ providers: { routed: { baseUrl: "https://proxy.example/v1" } } })).toEqual([]);
  });

  it("warns about an api value outside the documented set without blocking the commit", () => {
    const diagnostics = validateModelsDocument({
      providers: { typo: { baseUrl: "https://api.example/v1", api: "openai-completion", auth: "none", models: [{ id: "m" }] } },
    });
    const warning = diagnostics.find((item) => item.code === "provider.api-unknown");
    expect(warning).toMatchObject({ severity: "warning", path: "providers.typo.api" });
    expect(diagnostics.some((item) => item.severity === "error")).toBe(false);
    expect(validateModelsDocument({
      providers: { fine: { baseUrl: "https://api.example/v1", api: "anthropic-messages", auth: "none", models: [{ id: "m" }] } },
    })).toEqual([]);
  });

  it("validates disabledProviders including path-scoped entries", () => {
    expect(validateSettingsDocument({ disabledProviders: ["ollama", "native"] })).toEqual([]);
    expect(validateSettingsDocument({
      disabledProviders: [{ paths: ["~/projects/sensitive"], providers: ["anthropic", "openai"] }],
    })).toEqual([]);
    // A configured custom provider is a legitimate target even though it is not a built-in id.
    expect(validateSettingsDocument({ disabledProviders: ["my-proxy"] }, ["my-proxy"])).toEqual([]);
    expect(validateSettingsDocument({ disabledProviders: ["ollamaa"] })).toEqual([
      expect.objectContaining({ severity: "warning", code: "settings.disabledProviders-unknown", path: "disabledProviders.0" }),
    ]);
  });

  it("rejects a scoped rule that OMP would silently drop", () => {
    // No path key: OMP cannot scope it and discards the entry.
    expect(validateSettingsDocument({ disabledProviders: [{ providers: ["openai"] }] }).map((item) => item.code))
      .toContain("settings.disabledProviders-scope");
    // No values key.
    expect(validateSettingsDocument({ disabledProviders: [{ path: "~/work" }] }).map((item) => item.code))
      .toContain("settings.disabledProviders-values");
    // Only string values survive OMP's filtering.
    expect(validateSettingsDocument({ enabledModels: [{ path: "~/work", models: [{ nested: true }] }] as never }).map((item) => item.code))
      .toContain("settings.enabledModels-values");
  });

  it("rejects explicitly null object fields because OMP rejects the whole document for them", () => {
    const diagnostics = validateModelsDocument({
      providers: {
        demo: { baseUrl: "https://api.example.com/v1", api: "openai-completions", apiKey: "X", headers: null, modelOverrides: null, compat: null, models: [{ id: "m" }] },
      },
    });
    const codes = diagnostics.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["provider.headers", "provider.modelOverrides", "provider.compat"]));
    expect(diagnostics.find((item) => item.code === "provider.headers")?.message).toContain("null");
  });

  it("rejects a modelOverrides value that is not a mapping of mappings", () => {
    const diagnostics = validateModelsDocument({
      providers: {
        demo: { baseUrl: "https://api.example.com/v1", api: "openai-completions", apiKey: "X", modelOverrides: { "m": "not-an-object" }, models: [{ id: "m" }] },
      },
    });
    expect(diagnostics.some((item) => item.code === "provider.modelOverrides")).toBe(true);
  });

  it("accepts properly shaped object fields", () => {
    const diagnostics = validateModelsDocument({
      providers: {
        demo: { baseUrl: "https://api.example.com/v1", api: "openai-completions", apiKey: "X", headers: { "X-Client": "omp-switch" }, modelOverrides: { "m": { transport: "pi-native" } }, compat: { toolCall: true }, models: [{ id: "m" }] },
      },
    });
    expect(diagnostics.filter((item) => item.code.startsWith("provider."))).toEqual([]);
  });

  it("warns about a bridge command reference that only works inside a dev checkout", () => {
    const devRef = '!"D:\\repo\\node_modules\\electron\\dist\\electron.exe" "." --secret-get "credential-x"';
    const diagnostics = validateModelsDocument({
      providers: { devish: { baseUrl: "https://api.example/v1", api: "openai-completions", apiKey: devRef, models: [{ id: "m" }] } },
    });
    expect(diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "provider.apiKey-fragile-command", path: "providers.devish.apiKey" })]);
  });

  it("flags a plaintext credential sitting in models.yml", () => {
    expect(looksLikePlaintextSecret("!\"C:\\omp-switch-secret.exe\" --secret-get \"cred\"")).toBe(false);
    expect(looksLikePlaintextSecret("OPENAI_API_KEY")).toBe(false);
    expect(looksLikePlaintextSecret("sk-EXAMPLE-not-a-real-key-000000")).toBe(true);
    expect(looksLikePlaintextSecret("f7c3bd9a41e84b2c9d0e5a6f8b1c2d3e")).toBe(true);
    const diagnostics = validateModelsDocument({
      providers: { leaky: { baseUrl: "https://api.example/v1", api: "openai-completions", apiKey: "sk-EXAMPLE-not-a-real-key-000000", models: [{ id: "m" }] } },
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({ severity: "warning", code: "provider.apiKey-plaintext", path: "providers.leaky.apiKey" }),
    ]);
  });

  it("accepts the nested cost.longContext tier object OMP v17.4.0+ writes", () => {
    // OMP writes `cost.longContext` on subscription Codex GPT-5.6 models. The old scalar-only check
    // blocked the commit on a file OMP itself produced; the recursive check must accept it.
    const diagnostics = validateModelsDocument({
      providers: {
        codex: { baseUrl: "https://api.openai.com/v1", api: "openai-codex-responses", auth: "none", models: [{ id: "gpt-5.6", cost: { input: 1.25, output: 10, cacheRead: 0.1, longContext: { "272000": 2.5, "1000000": 5 } } }] },
      },
    });
    expect(diagnostics.some((item) => item.code === "model.cost" || item.code === "provider.cost")).toBe(false);
  });

  it("still rejects a cost with a non-numeric leaf", () => {
    expect(validateModelsDocument({ providers: { demo: { baseUrl: "https://api.example/v1", api: "openai-completions", auth: "none", models: [{ id: "m", cost: { input: "free" } }] } } }).some((item) => item.code === "model.cost")).toBe(true);
  });

  it("warns about an unknown tokenizer family without blocking the commit", () => {
    const diagnostics = validateModelsDocument({ providers: { demo: { baseUrl: "https://api.example/v1", api: "openai-completions", auth: "none", models: [{ id: "m", tokenizer: "claude-v99" }] } } });
    expect(diagnostics.find((item) => item.code === "model.tokenizer-unknown")).toMatchObject({ severity: "warning" });
    expect(diagnostics.some((item) => item.severity === "error")).toBe(false);
    expect(validateModelsDocument({ providers: { demo: { baseUrl: "https://api.example/v1", api: "openai-completions", auth: "none", models: [{ id: "m", tokenizer: "claude-v5" }] } } })).toEqual([]);
  });

  it("validates the OMP v17.4.0+ compaction and settings keys", () => {
    expect(validateSettingsDocument({
      compaction: { asyncEnabled: true, methodOrder: ["remote", "snapcompact"], keepRecentTokens: 20000 },
      extendedContext: true,
      externalThinking: false,
      personality: "friendly",
      images: { urls: { enabled: true } },
    })).toEqual([]);
    expect(validateSettingsDocument({ compaction: { asyncEnabled: "yes" as never } }).some((item) => item.code === "settings.compaction")).toBe(true);
    expect(validateSettingsDocument({ personality: "rude" as never }).some((item) => item.code === "settings.personality")).toBe(true);
    expect(validateSettingsDocument({ images: { urls: { enabled: "yes" as never } } }).some((item) => item.code === "settings.images.urls.enabled")).toBe(true);
  });

  it("validates unexpectedStopDetection modes and updateChannel", () => {
    const valid = validateSettingsDocument({
      unexpectedStopDetection: "smart",
      updateChannel: "canary",
    });
    expect(valid).toHaveLength(0);

    const invalid = validateSettingsDocument({
      unexpectedStopDetection: "invalid" as any,
      updateChannel: "beta" as any,
    });
    expect(invalid.some((d) => d.code === "settings.unexpectedStopDetection")).toBe(true);
    expect(invalid.some((d) => d.code === "settings.updateChannel")).toBe(true);
  });

  it("validates model name, reasoning, and disableStrictTools types", () => {
    const invalid = validateModelsDocument({
      providers: {
        demo: {
          baseUrl: "https://api.example/v1",
          api: "openai-completions",
          auth: "none",
          models: [
            { id: "m1", name: 123 as any, reasoning: "true" as any, disableStrictTools: "no" as any },
          ],
        },
      },
    });
    expect(invalid.some((d) => d.code === "model.name")).toBe(true);
    expect(invalid.some((d) => d.code === "model.reasoning")).toBe(true);
    expect(invalid.some((d) => d.code === "model.disableStrictTools")).toBe(true);

    const valid = validateModelsDocument({
      providers: {
        demo: {
          baseUrl: "https://api.example/v1",
          api: "openai-completions",
          auth: "none",
          models: [
            { id: "m1", name: "Custom Name", reasoning: true, disableStrictTools: false },
          ],
        },
      },
    });
    expect(valid).toHaveLength(0);
  });
});
