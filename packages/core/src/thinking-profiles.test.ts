import { describe, expect, it } from "vitest";
import {
  cloneThinkingLevelMap,
  getThinkingProfile,
  isPiThinkingLevelMap,
  PI_THINKING_LEVELS,
  THINKING_PROFILES,
} from "./thinking-profiles";

describe("thinking profiles", () => {
  it("defines standard thinking levels including off and auto-excluded values", () => {
    expect(PI_THINKING_LEVELS).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("retrieves curated thinking profiles with proper clone semantics", () => {
    const xhighProfile = getThinkingProfile("xhighAndMax");
    expect(xhighProfile).toEqual({
      xhigh: "xhigh",
      max: "max",
    });
    // Ensure mutation of the returned clone does not affect the profile source
    xhighProfile.max = "changed";
    expect(getThinkingProfile("xhighAndMax").max).toBe("max");
  });

  it("maps DeepSeek R1/V4 thinking constraints properly", () => {
    const deepseek = getThinkingProfile("deepseekV4");
    expect(deepseek).toEqual({
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      max: "max",
    });
  });

  it("validates thinking level maps correctly", () => {
    expect(isPiThinkingLevelMap({ high: "high", max: "max" })).toBe(true);
    expect(isPiThinkingLevelMap({ off: null, minimal: "low" })).toBe(true);
    expect(isPiThinkingLevelMap({ invalidLevel: "high" })).toBe(false);
    expect(isPiThinkingLevelMap({ high: 123 })).toBe(false);
    expect(isPiThinkingLevelMap(null)).toBe(false);
    expect(isPiThinkingLevelMap("not an object")).toBe(false);
  });
});
