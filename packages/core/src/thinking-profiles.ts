import type { PiThinkingLevelMap, ThinkingLevel } from "./domain";

export const PI_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

export interface ThinkingProfile {
  readonly map: Readonly<PiThinkingLevelMap>;
}

/**
 * Reviewed Pi/OMP-native thinking level mappings.
 *
 * Missing keys and null values are intentionally different:
 * - Missing key: fall through to OMP default mapping.
 * - null: explicitly unsupported level (cannot be selected).
 * - string: translated parameter value sent to upstream provider.
 */
export const THINKING_PROFILES = {
  xhighAndMax: {
    map: {
      xhigh: "xhigh",
      max: "max",
    },
  },
  deepseekV4: {
    map: {
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      max: "max",
    },
  },
  offUnsupported: {
    map: {
      off: null,
    },
  },
  kimi3: {
    map: {
      off: null,
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: "max",
    },
  },
  openCodeGoGlm52: {
    map: {
      off: null,
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: null,
      max: "max",
    },
  },
  offUnsupportedXhighAndMax: {
    map: {
      off: null,
      xhigh: "xhigh",
      max: "max",
    },
  },
  maxOnly: {
    map: {
      max: "max",
    },
  },
  lowMediumHighOnly: {
    map: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: null,
      max: null,
    },
  },
  openaiResponsesGpt5: {
    map: {
      off: null,
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: null,
      max: null,
    },
  },
  openaiResponsesGpt51: {
    map: {
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: null,
      max: null,
    },
  },
  openaiResponsesGpt52To55: {
    map: {
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: null,
    },
  },
  openaiResponsesGpt53CodexSpark: {
    map: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: null,
    },
  },
  openaiResponsesGpt56: {
    map: {
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
  },
  openaiResponsesGpt6Astra: {
    map: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
  },
  geminiLowHigh: {
    map: {
      off: null,
      minimal: null,
      low: "LOW",
      medium: null,
      high: "HIGH",
    },
  },
} as const satisfies Record<string, ThinkingProfile>;

export type PiThinkingProfileId = keyof typeof THINKING_PROFILES;

export function cloneThinkingLevelMap(map: Readonly<PiThinkingLevelMap>): PiThinkingLevelMap {
  return { ...map };
}

export function getThinkingProfile(profileId: PiThinkingProfileId): PiThinkingLevelMap {
  const profile = THINKING_PROFILES[profileId];
  if (!profile) {
    throw new Error(`Unknown thinking profile: ${profileId}`);
  }
  return cloneThinkingLevelMap(profile.map);
}

export function isPiThinkingLevelMap(value: unknown): value is PiThinkingLevelMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set<string>(PI_THINKING_LEVELS);
  return Object.entries(value).every(
    ([key, entry]) => allowed.has(key) && (typeof entry === "string" || entry === null),
  );
}
