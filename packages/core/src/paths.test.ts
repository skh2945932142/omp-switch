import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, getProfilePaths, listProfileNames, resolveOmpPaths, validateProfileName } from "./paths";

describe("OMP profile paths", () => {
  it("maps the default profile onto the documented agent directory", () => {
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

  it("relocates a named profile under profiles/<name>", () => {
    expect(getProfilePaths("C:/Users/test", "work").agentDir).toBe(path.join("C:/Users/test", ".omp", "profiles", "work", "agent"));
  });

  it("rejects profile names that could escape the profiles directory", () => {
    expect(() => validateProfileName("../secrets")).toThrow();
    expect(() => validateProfileName("a/b")).toThrow();
    expect(() => validateProfileName("default")).not.toThrow();
  });

  it("honors PI_CONFIG_DIR as both a name under home and an absolute path", () => {
    expect(resolveOmpPaths("C:/Users/test", { PI_CONFIG_DIR: ".omp-alt" }).ompRoot).toBe(path.resolve("C:/Users/test", ".omp-alt"));
    expect(getProfilePaths("C:/Users/test", "default", { PI_CONFIG_DIR: "D:/omp-root" }).agentDir)
      .toBe(path.join(path.resolve("D:/omp-root"), "agent"));
  });

  it("applies PI_CODING_AGENT_DIR to the default profile only", () => {
    expect(getProfilePaths("C:/Users/test", "default", { PI_CODING_AGENT_DIR: "D:/agent" }).agentDir).toBe(path.resolve("D:/agent"));
    // A named profile ignores it, exactly as OMP documents.
    expect(getProfilePaths("C:/Users/test", "work", { PI_CODING_AGENT_DIR: "D:/agent" }).agentDir)
      .toBe(path.join("C:/Users/test", ".omp", "profiles", "work", "agent"));
  });

  it("resolves the active profile from OMP_PROFILE ahead of PI_PROFILE", () => {
    expect(resolveOmpPaths("C:/h", { OMP_PROFILE: "work", PI_PROFILE: "legacy" }).activeProfile).toBe("work");
    expect(resolveOmpPaths("C:/h", { PI_PROFILE: "legacy" }).activeProfile).toBe("legacy");
    // An explicitly empty OMP_PROFILE still wins and selects the default profile.
    expect(resolveOmpPaths("C:/h", { OMP_PROFILE: "", PI_PROFILE: "legacy" }).activeProfile).toBe(DEFAULT_PROFILE);
    expect(resolveOmpPaths("C:/h", { OMP_PROFILE: "  " }).activeProfile).toBe(DEFAULT_PROFILE);
    expect(resolveOmpPaths("C:/h", {}).activeProfile).toBe(DEFAULT_PROFILE);
  });

  it("reports every override so the UI can explain unexpected paths", () => {
    const resolution = resolveOmpPaths("C:/Users/test", { PI_CONFIG_DIR: "D:/omp-root", OMP_PROFILE: "work" });
    expect(resolution.overrides.map((override) => override.variable)).toEqual(["PI_CONFIG_DIR", "OMP_PROFILE"]);
    expect(resolveOmpPaths("C:/Users/test", {}).overrides).toEqual([]);
  });

  it("lists an active profile that has no directory yet", () => {
    // Otherwise the app would edit the default profile while OMP reads the named one.
    expect(listProfileNames([], "work")).toEqual(["default", "work"]);
    expect(listProfileNames(["b", "a"])).toEqual(["default", "a", "b"]);
  });
});
