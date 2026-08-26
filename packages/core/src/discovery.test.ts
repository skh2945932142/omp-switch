import { describe, expect, it } from "vitest";
import { discoverModels, discoverOpenAIModels } from "./discovery";

describe("OpenAI-compatible model discovery", () => {
  it("parses the standard /models response", async () => {
    const result = await discoverOpenAIModels({
      baseUrl: "https://example.test/v1",
      apiKey: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ id: "alpha" }, { id: "beta" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(result.models.map((item) => item.id)).toEqual(["alpha", "beta"]);
  });

  it("returns a useful diagnostic for authentication failures", async () => {
    await expect(
      discoverOpenAIModels({
        baseUrl: "https://example.test/v1",
        fetchImpl: async () => new Response("no", { status: 401 }),
      }),
    ).rejects.toMatchObject({ code: "discovery.auth" });
  });

  it("reports an empty model list without replacing manual input", async () => {
    await expect(
      discoverOpenAIModels({
        baseUrl: "https://example.test/v1",
        fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
      }),
    ).rejects.toMatchObject({ code: "discovery.empty" });
  });

  it("parses Ollama tags without treating the model name as a provider", async () => {
    const result = await discoverModels({
      type: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      fetchImpl: async (input) => {
        expect(String(input)).toBe("http://127.0.0.1:11434/api/tags");
        return new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }), { status: 200 });
      },
    });
    expect(result).toMatchObject({ type: "ollama", models: [{ id: "qwen3:8b", name: "qwen3:8b" }] });
  });

  it("accepts proxy and LiteLLM responses that use a models array", async () => {
    const result = await discoverModels({
      type: "proxy",
      baseUrl: "https://proxy.example/v1",
      fetchImpl: async () => new Response(JSON.stringify({ models: [{ id: "team/model" }] }), { status: 200 }),
    });
    expect(result.models.map((model) => model.id)).toEqual(["team/model"]);
  });

  it("rejects invalid or non-http/https baseUrl schemes", async () => {
    await expect(discoverOpenAIModels({ baseUrl: "ftp://example.test/v1" })).rejects.toMatchObject({ code: "discovery.endpoint" });
    await expect(discoverOpenAIModels({ baseUrl: "javascript:alert(1)" })).rejects.toMatchObject({ code: "discovery.endpoint" });
    await expect(discoverOpenAIModels({ baseUrl: "not-a-url" })).rejects.toMatchObject({ code: "discovery.endpoint" });
    await expect(discoverOpenAIModels({ baseUrl: "" })).rejects.toMatchObject({ code: "discovery.endpoint" });
  });
});
