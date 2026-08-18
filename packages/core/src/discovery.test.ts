import { describe, expect, it } from "vitest";
import { discoverOpenAIModels } from "./discovery";

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
});
