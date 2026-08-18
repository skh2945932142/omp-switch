import { describe, expect, it } from "vitest";
import { validateModelsDocument, validateRoleSelector } from "./validation";

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
    expect(validateRoleSelector("@slow")).toBe(true);
    expect(validateRoleSelector("@slow:xhigh")).toBe(true);
    expect(validateRoleSelector("bad selector")).toBe(false);
    expect(validateRoleSelector("@slow:turbo")).toBe(false);
  });
});
