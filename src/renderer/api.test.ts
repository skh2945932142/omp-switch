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

describe("prompt library preview API", () => {
  it("supports search, classification and source removal", async () => {
    const mock = createMockApi();
    expect((await mock.promptLibraryList()).sources).toEqual([]);
    const view = await mock.choosePromptLibrarySource();
    expect(view.sources).toHaveLength(1);
    expect((await mock.promptLibraryList("edge cases")).entries).toHaveLength(1);
    const id = view.entries[0].id;
    await mock.updatePromptLibraryMetadata(id, { favorite: true, tags: ["review"] });
    expect((await mock.promptLibraryList()).metadata[id].favorite).toBe(true);
    await mock.removePromptLibrarySource(view.sources[0].id);
    expect((await mock.promptLibraryList()).metadata).toEqual({});
  });
  it("adopts and restores an independent profile copy", async () => {
    const mock = createMockApi(); const view = await mock.choosePromptLibrarySource();
    const preview = await mock.previewPromptAdoption("default", view.entries[0].id, "review");
    const snapshot = await mock.commitPromptAdoption(preview.id, false);
    expect((await mock.listSurface("default", "prompt"))[0].name).toBe("review");
    expect(await mock.readSurface("default", "prompt", "review")).toBe(preview.content);
    await mock.restorePromptAdoption("default", snapshot.id);
    expect(await mock.listSurface("default", "prompt")).toEqual([]);
  });
  it("refuses stale target previews and undo over external edits", async () => {
    const mock = createMockApi(); const view = await mock.choosePromptLibrarySource();
    const preview = await mock.previewPromptAdoption("default", view.entries[0].id, "review");
    await mock.writeSurface("default", "prompt", "review", "editor change");
    await expect(mock.commitPromptAdoption(preview.id, true)).rejects.toThrow();
    const next = await mock.previewPromptAdoption("default", view.entries[0].id, "review");
    const snapshot = await mock.commitPromptAdoption(next.id, true);
    await mock.writeSurface("default", "prompt", "review", "later change");
    await expect(mock.restorePromptAdoption("default", snapshot.id)).rejects.toThrow();
  });
});
