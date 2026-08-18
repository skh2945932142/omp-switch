import { describe, expect, it } from "vitest";
import path from "node:path";
import { getProfilePaths, listProfileNames, validateProfileName } from "./paths";

describe("OMP profile paths", () => {
  it("resolves the default profile under the OMP agent directory", () => {
    expect(getProfilePaths("C:/Users/test", "default")).toEqual({
      profile: "default",
      agentDir: path.join("C:/Users/test", ".omp", "agent"),
      modelsCandidates: [
        path.join("C:/Users/test", ".omp", "agent", "models.yml"),
        path.join("C:/Users/test", ".omp", "agent", "models.yaml"),
        path.join("C:/Users/test", ".omp", "agent", "models.json"),
      ],
      settingsCandidates: [
        path.join("C:/Users/test", ".omp", "agent", "config.yml"),
        path.join("C:/Users/test", ".omp", "agent", "config.yaml"),
      ],
    });
  });

  it("rejects traversal and shell separator profile names", () => {
    expect(() => validateProfileName("../secrets")).toThrow();
    expect(() => validateProfileName("a/b")).toThrow();
    expect(() => validateProfileName("default")).not.toThrow();
  });

  it("deduplicates and sorts named profiles", () => {
    expect(listProfileNames(["beta", "default", "alpha", "beta", ""]))
      .toEqual(["default", "alpha", "beta"]);
  });
});
