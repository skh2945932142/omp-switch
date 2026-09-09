import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { OmpFilesystemAdapter } from "@omp-switch/core";
import { App } from "./app";

/**
 * Renders the real App against a real adapter over a temp HOME — same colocated-suite pattern as
 * the rest of the repo (real fs, no mocks). Asserts what a user sees on first paint per screen.
 */
async function fixture(): Promise<{ adapter: OmpFilesystemAdapter; home: string }> {
  const home = await mkdtemp(path.join(tmpdir(), "omp-tui-"));
  const agentDir = path.join(home, ".omp", "agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, "models.yml"), [
    "providers:",
    "  openai:",
    "    baseUrl: https://api.openai.com/v1",
    "    api: openai-responses",
    "    auth: none",
    "    models:",
    "      - id: gpt-5",
    "        reasoning: true",
  ].join("\n"), "utf8");
  await writeFile(path.join(agentDir, "config.yml"), [
    "modelRoles:",
    "  default: openai/gpt-5",
  ].join("\n"), "utf8");
  const adapter = new OmpFilesystemAdapter({
    homeDir: home,
    snapshotDir: path.join(home, "snapshots"),
    // installation defaults to supported; the writable path is what the screens exercise
  });
  return { adapter, home };
}

describe("TUI App", () => {
  it("renders the provider screen with profile, provider, and model rows", async () => {
    const { adapter } = await fixture();
    const { lastFrame, unmount } = render(React.createElement(App, { adapter }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("omp-switch-tui");
    expect(frame).toContain("openai");
    expect(frame).toContain("gpt-5");
    expect(frame).toContain("1 providers");
    unmount();
  });

  it("shows the roles screen with the default role and its resolution chain", async () => {
    const { adapter } = await fixture();
    const { lastFrame, unmount, stdin } = render(React.createElement(App, { adapter }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    stdin.write("2");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Roles");
    expect(frame).toContain("default");
    expect(frame).toContain("openai/gpt-5");
    unmount();
  });

  it("lists diagnostics (clean config → zero errors) on the diagnostics screen", async () => {
    const { adapter } = await fixture();
    const { lastFrame, unmount, stdin } = render(React.createElement(App, { adapter }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    stdin.write("4");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Diagnostics");
    expect(frame).toMatch(/errors 0/);
    unmount();
  });
});
