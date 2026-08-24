// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { DetailDrawer } from "./detail-drawer";

function Harness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open inspector</button>
    {open ? (
      <DetailDrawer eyebrow="Provider" title="openrouter" closeLabel="Close" onClose={() => setOpen(false)}>
        <input aria-label="Provider ID" />
      </DetailDrawer>
    ) : null}
  </>;
}

describe("DetailDrawer", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("labels the inspector, focuses its first field, closes with Escape, and restores focus", async () => {
    await act(async () => root.render(<TooltipPrimitive.Provider><Harness /></TooltipPrimitive.Provider>));
    const trigger = host.querySelector<HTMLButtonElement>("button");
    trigger?.focus();

    await act(async () => trigger?.click());

    const drawer = host.querySelector<HTMLElement>("[role='complementary']");
    const labelledBy = drawer?.getAttribute("aria-labelledby");
    expect(document.getElementById(labelledBy ?? "")?.textContent).toBe("openrouter");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Provider ID");

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    expect(host.querySelector("[role='complementary']")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
