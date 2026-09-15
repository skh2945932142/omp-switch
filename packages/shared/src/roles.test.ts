import { describe, expect, it } from "vitest";
import { BUILTIN_ROLE_IDS } from "@omp-switch/core/validation";
import { KNOWN_ROLE_IDS, ROLE_CATALOG } from "./roles";

describe("role catalog", () => {
  it("matches core's built-in role ids exactly, in catalog order", () => {
    // The two lists serve different layers (validation vs presentation); a drift between them
    // means either a stale gloss or validation that no longer knows the roles the UI offers.
    expect(KNOWN_ROLE_IDS).toEqual([...BUILTIN_ROLE_IDS]);
  });

  it("gives every role a distinct gloss key", () => {
    const glossKeys = ROLE_CATALOG.map((entry) => entry.glossKey);
    expect(new Set(glossKeys).size).toBe(glossKeys.length);
  });
});
