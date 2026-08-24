// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { LeftRail } from "./left-rail";

const baseProps = {
  profileId: "default",
  profiles: [{ id: "default", name: "Default", kind: "default" as const, agentDir: "~/.omp/agent" }],
  onProfileChange: () => undefined,
  agentDir: "~/.omp/agent",
  section: "models" as const,
  onSectionChange: () => undefined,
  providerCount: 1,
  rolesDirty: false,
  settingsDirty: false,
  errorCount: 0,
  onOpenDiagnostics: () => undefined,
  onOpenSettings: () => undefined,
};

describe("LeftRail responsive mode", () => {
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

  it("keeps all sections named while omitting the profile editor in compact mode", async () => {
    await act(async () => root.render(
      <TooltipPrimitive.Provider>
        <LeftRail {...baseProps} compact />
      </TooltipPrimitive.Provider>,
    ));

    expect(host.querySelector(".left-rail")?.classList.contains("compact")).toBe(true);
    expect(host.querySelector("[role='combobox']")).toBeNull();

    const sectionButtons = Array.from(host.querySelectorAll<HTMLButtonElement>(".section-nav button"));
    expect(sectionButtons).toHaveLength(7);
    expect(sectionButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "模型 (Ctrl+1)",
      "角色 (Ctrl+2)",
      "提示 (Ctrl+3)",
      "技能 (Ctrl+4)",
      "会话 (Ctrl+5)",
      "用量 (Ctrl+6)",
      "网关 (Ctrl+7)",
    ]);
  });

  it("uses visible navigation text as the accessible name in expanded mode", async () => {
    await act(async () => root.render(
      <TooltipPrimitive.Provider>
        <LeftRail {...baseProps} />
      </TooltipPrimitive.Provider>,
    ));

    const modelsButton = host.querySelector<HTMLButtonElement>(".section-nav button");
    expect(modelsButton?.getAttribute("aria-label")).toBeNull();
    expect(modelsButton?.textContent).toContain("模型");
  });
});
