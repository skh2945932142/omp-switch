// @vitest-environment jsdom

import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RefreshCw } from "lucide-react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { IconButton } from "./ui-primitives";

describe("IconButton", () => {
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

  async function render(ui: ReactElement): Promise<void> {
    await act(async () => root.render(<TooltipPrimitive.Provider>{ui}</TooltipPrimitive.Provider>));
  }

  it("uses its tooltip label as the button accessible name", async () => {
    await render(<IconButton label="Refresh"><RefreshCw /></IconButton>);

    const button = host.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Refresh");
    expect(button?.getAttribute("type")).toBe("button");
  });

  it("applies the requested visual variant without losing custom classes", async () => {
    await render(<IconButton label="Delete" variant="danger" className="row-delete"><RefreshCw /></IconButton>);

    expect(host.querySelector("button")?.className).toBe("icon-button danger row-delete");
  });
});
