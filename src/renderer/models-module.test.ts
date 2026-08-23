import { describe, expect, it } from "vitest";
import {
  blankForm,
  buildModels,
  createModelEditorEntry,
  toModelEditorEntry,
  type ModelEditorEntry,
} from "./hooks/use-provider-form";
import {
  rolesSignature,
  parseDisabledProviderRules,
  parseEnabledModelRules,
  makeEnabledFilter,
} from "./hooks/use-omp-config";

describe("ModelsModule and ProviderForm helpers", () => {
  it("creates a valid blank form with default discovery", () => {
    const form = blankForm();
    expect(form.api).toBe("openai-completions");
    expect(form.discoveryType).toBe("openai-models-list");
    expect(form.auth).toBe("apiKey");
    expect(form.authHeader).toBe(true);
  });

  it("converts OMP models to ModelEditorEntry and back", () => {
    const model = {
      id: "gpt-4.1",
      name: "GPT-4.1 Pro",
      api: "openai-responses",
      contextWindow: 128000,
      maxTokens: 16384,
      reasoning: true,
      input: ["text", "image"],
    };

    const entry = toModelEditorEntry(model);
    expect(entry.id).toBe("gpt-4.1");
    expect(entry.name).toBe("GPT-4.1 Pro");
    expect(entry.reasoning).toBe(true);
    expect(entry.vision).toBe(true);
    expect(entry.contextWindow).toBe("128000");

    const rebuilt = buildModels([entry]);
    expect(rebuilt[0]).toMatchObject({
      id: "gpt-4.1",
      name: "GPT-4.1 Pro",
      reasoning: true,
      contextWindow: 128000,
      maxTokens: 16384,
    });
    expect(rebuilt[0].input).toContain("image");
    expect(rebuilt[0].input).toContain("text");
  });

  it("rejects empty model IDs when building models", () => {
    const invalidEntry: ModelEditorEntry = {
      ...createModelEditorEntry(),
      id: "   ",
    };
    expect(() => buildModels([invalidEntry])).toThrow();
  });

  it("generates deterministic roles signature for dirty checks", () => {
    const a = { smol: "openrouter/demo", default: "openai/gpt-4.1" };
    const b = { default: "openai/gpt-4.1", smol: "openrouter/demo" };
    expect(rolesSignature(a)).toBe(rolesSignature(b));
  });

  it("parses enabledModels rules and filters models correctly", () => {
    const rules = parseEnabledModelRules("openrouter/*\nopenai/gpt-4.1");
    expect(rules).toHaveLength(2);

    const filter = makeEnabledFilter(rules);
    expect(filter("openrouter", "deepseek-r1")).toBe(true);
    expect(filter("openai", "gpt-4.1")).toBe(true);
    expect(filter("openai", "gpt-3.5")).toBe(false);
  });

  it("parses disabledProviders rules correctly", () => {
    const rules = parseDisabledProviderRules("ollama, lm-studio");
    expect(rules).toEqual(["ollama", "lm-studio"]);
  });
});
