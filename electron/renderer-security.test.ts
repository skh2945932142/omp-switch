import { describe, expect, it } from "vitest";
import { blockRendererNavigation, denyRendererWindowOpen, isLoopbackHttpUrl, mayUseDevRenderer } from "./renderer-security";

describe("renderer loading security", () => {
  it("accepts only loopback HTTP development URLs", () => {
    expect(isLoopbackHttpUrl("http://127.0.0.1:5173")).toBe(true);
    expect(isLoopbackHttpUrl("http://localhost:3000/app")).toBe(true);
    expect(isLoopbackHttpUrl("http://[::1]:5173")).toBe(true);
    expect(isLoopbackHttpUrl("https://127.0.0.1:5173")).toBe(false);
    expect(isLoopbackHttpUrl("http://0.0.0.0:5173")).toBe(false);
    expect(isLoopbackHttpUrl("http://evil.example")).toBe(false);
    expect(isLoopbackHttpUrl("file:///tmp/index.html")).toBe(false);
  });

  it("ignores the environment URL in packaged builds", () => {
    expect(mayUseDevRenderer(true, "http://127.0.0.1:5173")).toBe(false);
    expect(mayUseDevRenderer(false, "http://127.0.0.1:5173")).toBe(true);
  });

  it("blocks renderer navigation and child windows", () => {
    let prevented = false;
    blockRendererNavigation({ preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
    expect(denyRendererWindowOpen()).toEqual({ action: "deny" });
  });
});
