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

  it("satisfies layout invariants: in-flow button children never exceed grid column capacity", async () => {
    // Test a combination of active models (count) + dirty roles (dot)
    await act(async () => root.render(
      <TooltipPrimitive.Provider>
        <LeftRail
          {...baseProps}
          section="roles"
          rolesDirty={true}
          providerCount={12}
          settingsDirty={true}
          errorCount={3}
        />
      </TooltipPrimitive.Provider>,
    ));

    const sectionButtons = Array.from(host.querySelectorAll<HTMLButtonElement>(".section-nav button"));
    expect(sectionButtons.length).toBe(7);

    // CSS grid-template-columns is 4 columns (20px minmax(0, 1fr) auto auto)
    const MAX_IN_FLOW_COLUMNS = 4;
    for (const btn of sectionButtons) {
      const allChildren = Array.from(btn.children);
      const inFlowChildren = allChildren.filter((child) => !child.classList.contains("nav-active-pill"));
      expect(inFlowChildren.length).toBeLessThanOrEqual(MAX_IN_FLOW_COLUMNS);
      expect(inFlowChildren.length).toBeGreaterThanOrEqual(2); // at least icon + label

      // If active, pill must be present with absolute positioning class
      if (btn.classList.contains("active")) {
        const pill = btn.querySelector(".nav-active-pill");
        expect(pill).not.toBeNull();
      }
    }

    // Check footer rail-actions
    const railActions = Array.from(host.querySelectorAll<HTMLButtonElement>(".rail-action"));
    expect(railActions.length).toBeGreaterThanOrEqual(2);
    for (const action of railActions) {
      const count = action.querySelector(".nav-count");
      const dot = action.querySelector(".nav-dot");
      const labelSpan = Array.from(action.querySelectorAll("span")).find(
        (s) => !s.classList.contains("nav-count") && !s.classList.contains("nav-dot"),
      );
      expect(labelSpan).toBeDefined();
    }
  });
});
