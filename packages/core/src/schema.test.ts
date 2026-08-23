import { describe, expect, it } from "vitest";
import { classifyOmpInstallation, parseOmpVersion } from "./schema";

describe("OMP schema compatibility", () => {
  it("parses the format `omp --version` actually prints", () => {
    // Observed from omp 17.3.7: `omp/17.3.7`. There is no whitespace before the number, which an
    // earlier regex required — that made every real installation classify as unrecognized and
    // silently forced the whole app read-only.
    expect(parseOmpVersion("omp/17.3.7")).toMatchObject({ major: 17, minor: 3, patch: 7 });
    expect(classifyOmpInstallation({ executable: "omp", version: "omp/17.3.7" })).toMatchObject({
      supported: true,
      schemaMajor: 17,
      schemaStatus: "supported",
    });
  });

  it("recognizes the other shapes a version line can take", () => {
    expect(parseOmpVersion("oh-my-pi v17.3.7")).toMatchObject({ major: 17, minor: 3, patch: 7 });
    expect(parseOmpVersion("17.3.7")).toMatchObject({ major: 17, minor: 3, patch: 7 });
    expect(parseOmpVersion("v16.0")).toMatchObject({ major: 16, minor: 0, patch: undefined });
    expect(parseOmpVersion("omp version 17.3.7 (windows-x64)")).toMatchObject({ major: 17, minor: 3 });
  });

  it("treats an unparseable version as read-only rather than guessing", () => {
    expect(classifyOmpInstallation({ executable: "omp", version: "unstable-build" })).toMatchObject({
      supported: false,
      schemaStatus: "unknown",
    });
  });

  it("recognizes OMP v18 installations as supported and writable", () => {
    expect(classifyOmpInstallation({ executable: "omp", version: "omp/18.0.3" })).toMatchObject({
      supported: true,
      schemaMajor: 18,
      schemaStatus: "supported",
    });
  });

  it("keeps unknown future majors read-only", () => {
    expect(classifyOmpInstallation({ executable: "omp", version: "omp/19.0.0" })).toMatchObject({
      supported: false,
      schemaMajor: 19,
      schemaStatus: "readonly",
    });
  });

  it("stays writable in file-only mode when omp is not installed", () => {
    expect(classifyOmpInstallation({ executable: null, version: null })).toMatchObject({
      supported: true,
      schemaStatus: "unknown",
    });
  });
});
