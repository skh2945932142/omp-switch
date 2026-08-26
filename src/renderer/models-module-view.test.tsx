// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OmpProvider } from "@omp-switch/core";
import i18n from "./i18n";
import { ModelsModule } from "./models-module";

const sampleProviders: Array<[string, OmpProvider]> = [
  [
    "openai",
    {
      baseUrl: "https://api.openai.com/v1",
      api: "openai-completions",
      apiKey: "OPENAI_API_KEY",
      models: [
        { id: "gpt-4.1", name: "GPT-4.1", contextWindow: 128000, reasoning: true, input: ["text", "image"] },
      ],
    },
  ],
  [
    "local-ollama",
    {
      baseUrl: "http://127.0.0.1:11434",
      api: "ollama",
      auth: "none",
      discovery: { type: "ollama" },
      models: [
        { id: "llama3.2", name: "Llama 3.2", contextWindow: 8192 },
      ],
    },
  ],
];

function Harness(props: {
  onApplyProvider?: (id: string) => void;
  onEditProvider?: (id: string) => void;
  onRemoveProvider?: (id: string) => void;
  providers?: Array<[string, OmpProvider]>;
}) {
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");

  return (
    <TooltipPrimitive.Provider>
      <ModelsModule
        profileId="default"
        providers={props.providers ?? sampleProviders}
        preferredProviderId="openai"
        applyingProviderId={null}
        expandedProviders={expandedProviders}
        setExpandedProviders={setExpandedProviders}
        query={query}
        setQuery={setQuery}
        readOnly={false}
        busy={false}
        pendingSave={false}
        draftDisabledProviders={[]}
        agentDir="~/.omp/agent"
        roleIds={[["default", "默认主力"]]}
        roles={{ default: "openai/gpt-4.1" }}
        providerIds={["openai", "local-ollama"]}
        onApplyProvider={props.onApplyProvider ?? vi.fn()}
        onEditProvider={props.onEditProvider ?? vi.fn()}
        onRemoveProvider={props.onRemoveProvider ?? vi.fn()}
        onAddCustom={vi.fn()}
        onAddPreset={vi.fn()}
        onImportCatalog={vi.fn()}
        onAssignModelToRole={vi.fn()}
        onOpenRoles={vi.fn()}
        coverageFor={() => 1}
      />
    </TooltipPrimitive.Provider>
  );
}

describe("ModelsModule Quiet Instrument View", () => {
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

  it("clicking provider header toggle expands/collapses models without opening edit sheet", async () => {
    const onEditProvider = vi.fn();
    await act(async () => root.render(<Harness onEditProvider={onEditProvider} />));

    const toggles = host.querySelectorAll<HTMLButtonElement>(".provider-card-toggle");
    expect(toggles.length).toBe(2);

    // Click toggle to expand
    await act(async () => toggles[0].click());
    expect(onEditProvider).not.toHaveBeenCalled();

    const openWraps = host.querySelectorAll(".model-list-wrap.open");
    expect(openWraps.length).toBe(1);
  });

  it("clicking edit button invokes onEditProvider exclusively", async () => {
    const onEditProvider = vi.fn();
    await act(async () => root.render(<Harness onEditProvider={onEditProvider} />));

    const editBtns = host.querySelectorAll<HTMLButtonElement>("button.provider-edit");
    expect(editBtns.length).toBe(2);

    await act(async () => editBtns[0].click());
    expect(onEditProvider).toHaveBeenCalledWith("openai");
  });

  it("clicking delete button invokes onRemoveProvider", async () => {
    const onRemoveProvider = vi.fn();
    await act(async () => root.render(<Harness onRemoveProvider={onRemoveProvider} />));

    const deleteBtns = host.querySelectorAll<HTMLButtonElement>("button.provider-delete");
    expect(deleteBtns.length).toBe(2);

    await act(async () => deleteBtns[1].click());
    expect(onRemoveProvider).toHaveBeenCalledWith("local-ollama");
  });

  it("clicking apply button on non-preferred provider invokes onApplyProvider", async () => {
    const onApplyProvider = vi.fn();
    await act(async () => root.render(<Harness onApplyProvider={onApplyProvider} />));

    const applyBtns = host.querySelectorAll<HTMLButtonElement>(".provider-apply");
    expect(applyBtns.length).toBe(2);

    // openai is preferred (disabled for re-apply), local-ollama is unapplied
    await act(async () => applyBtns[1].click());
    expect(onApplyProvider).toHaveBeenCalledWith("local-ollama");
  });

  it("renders a single clear empty state when no providers exist", async () => {
    await act(async () => root.render(<Harness providers={[]} />));

    const emptyCard = host.querySelector(".empty-card");
    expect(emptyCard).not.toBeNull();
    expect(emptyCard?.textContent).toContain("还没有供应商");
    expect(host.querySelectorAll(".provider-card").length).toBe(0);
  });
});
