// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyConfigPatch } from "@omp-switch/core";
import { createMockApi } from "./api";

/**
 * The mock API's save must produce the same documents the real adapter's planPatch would for the
 * same patch. Both delegate to applyConfigPatch, so this suite pins the delegation — a drift (the
 * mock re-implementing the merge) would show up as a structural difference.
 */
describe("mock save equivalence with the real adapter", () => {
  it("applies the same provider, role, and settings patch through both paths", async () => {
    const mock = createMockApi();
    const baseline = await mock.loadProfile("default");

    const patch = {
      provider: {
        id: "anthropic",
        baseUrl: "https://api.anthropic.com",
        api: "anthropic-messages",
        auth: "apiKey",
        apiKey: null,
        headers: { "x-demo": "1" },
        models: [{ id: "claude-sonnet-5" }],
      },
      roleAssignments: { slow: "anthropic/claude-sonnet-5", default: null },
      settings: { modelProviderOrder: ["anthropic", "openrouter"], enabledModels: ["anthropic/*"] },
    };

    // Real-adapter semantics (same function planPatch calls internally).
    const viaApply = applyConfigPatch(baseline, patch);

    // Mock save path.
    const saved = await mock.save("default", patch);

    expect(saved.config.models.value.providers).toEqual(viaApply.models.providers);
    expect(saved.config.settings.value).toEqual(viaApply.settings);
    expect(viaApply.models.providers.anthropic?.headers).toEqual({ "x-demo": "1" });
    expect(viaApply.settings.modelRoles?.slow).toBe("anthropic/claude-sonnet-5");
    expect(viaApply.settings.modelRoles?.default).toBeUndefined();
    expect(viaApply.settings.modelProviderOrder).toEqual(["anthropic", "openrouter"]);
  });
});
