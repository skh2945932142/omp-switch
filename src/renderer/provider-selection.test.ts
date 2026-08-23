import { describe, expect, it } from "vitest";
import {
  effectivePreferredProviderId,
  isProviderDisabled,
  mergeProviderApplyDraft,
  moveProviderToFront,
  providerApplyBlockReason,
} from "./provider-selection";

describe("provider selection helpers", () => {
  it("moves a provider to the front while preserving the rest of the order", () => {
    expect(moveProviderToFront("anthropic", ["openai", "anthropic", "openrouter", "anthropic"])).toEqual([
      "anthropic",
      "openai",
      "openrouter",
    ]);
  });

  it("creates an explicit first entry when the current order is empty", () => {
    expect(moveProviderToFront("openrouter", [])).toEqual(["openrouter"]);
  });

  it("keeps unknown provider ids because they are user configuration", () => {
    expect(moveProviderToFront("openai", ["custom-team", "openrouter"])).toEqual([
      "openai",
      "custom-team",
      "openrouter",
    ]);
  });

  it("merges the preferred order with unsaved settings and role drafts", () => {
    expect(mergeProviderApplyDraft(
      "anthropic",
      ["openai", "anthropic"],
      { enabledModels: ["openai/*"], defaultThinkingLevel: "high" },
      { default: "openai/gpt-5", slow: "@default" },
      true,
    )).toEqual({
      settings: { enabledModels: ["openai/*"], defaultThinkingLevel: "high", modelProviderOrder: ["anthropic", "openai"] },
      roleAssignments: { default: "openai/gpt-5", slow: "@default" },
    });
    expect(mergeProviderApplyDraft("anthropic", [], {}, { default: "openai/gpt-5" }, false)).toEqual({
      settings: { modelProviderOrder: ["anthropic"] },
    });
  });

  it("resolves the effective preferred provider from valid order entries", () => {
    expect(effectivePreferredProviderId(["openrouter", "openai"], ["missing", "openai"])).toBe("openai");
    expect(effectivePreferredProviderId(["openrouter", "openai"], [])).toBe("openrouter");
    expect(effectivePreferredProviderId([], ["openai"])).toBeNull();
  });

  it("recognizes bare and current-profile scoped disabled provider rules", () => {
    expect(isProviderDisabled("openai", ["openai"], "C:\\Users\\admin\\.omp\\agent")).toBe(true);
    expect(isProviderDisabled("openai", [{ path: "~/.omp/agent", providers: ["openai"] }], "C:\\Users\\admin\\.omp\\agent")).toBe(true);
    expect(isProviderDisabled("openai", [{ path: "~/.omp/other", providers: ["openai"] }], "C:\\Users\\admin\\.omp\\agent")).toBe(false);
    expect(isProviderDisabled("openai", [{ providers: ["openai"] }], "C:\\Users\\admin\\.omp\\agent")).toBe(false);
  });

  it("reports the first actionable reason a provider cannot be applied", () => {
    expect(providerApplyBlockReason({ readOnly: true, modelCount: 1, auth: "none" })).toBe("readonly");
    expect(providerApplyBlockReason({ modelCount: 0, auth: "none" })).toBe("no-models");
    expect(providerApplyBlockReason({ modelCount: 1, auth: "apiKey" })).toBe("missing-key");
    expect(providerApplyBlockReason({ modelCount: 1, auth: "oauth" })).toBeNull();
    expect(providerApplyBlockReason({ modelCount: 1, auth: "none", disabled: true })).toBe("disabled");
    expect(providerApplyBlockReason({ modelCount: 1, auth: "none" })).toBeNull();
  });
});
