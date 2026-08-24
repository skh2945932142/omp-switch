// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import { ShortcutsDialog } from "./save-flow";

describe("ShortcutsDialog accessibility", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await i18n.changeLanguage("zh");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("connects the dialog accessible name to its visible heading", async () => {
    await act(async () => root.render(<ShortcutsDialog open onClose={() => undefined} />));

    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    const labelledBy = dialog?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy ?? "")?.textContent).toBe("快捷键");
  });
});
