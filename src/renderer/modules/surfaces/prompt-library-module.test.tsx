// @vitest-environment jsdom
import { act } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { createMockApi } from "../../api";
import { PromptLibraryModule } from "./prompt-library-module";

const roots: Root[] = [];
afterEach(() => { for (const root of roots.splice(0)) root.unmount(); });
async function renderModule(onOpenProfilePrompts = vi.fn()) {
  const container = document.createElement("div"); document.body.appendChild(container);
  const api = createMockApi(); const notices: Array<{ tone: string; text: string }> = [];
  await act(async () => { const root = createRoot(container); roots.push(root); root.render(<TooltipPrimitive.Provider><PromptLibraryModule api={api} profileId="default" readOnly={false} onNotice={(notice) => notices.push(notice)} onOpenProfilePrompts={onOpenProfilePrompts} /></TooltipPrimitive.Provider>); });
  return { container, api, notices };
}

describe("PromptLibraryModule", () => {
  it("offers the local library beside the profile prompt workflow", async () => {
    const { container } = await renderModule();
    expect(container.textContent).toContain(i18n.t("surfaces.libraryHeading"));
    expect(container.querySelector("button[aria-label='surfaces.libraryAddSource']") ?? container.textContent).toBeTruthy();
    expect(container.querySelector("input[name='promptLibrarySearch']")).toBeTruthy();
  });
  it("keeps the existing profile prompt editor available as a sibling view", async () => {
    const onOpenProfilePrompts = vi.fn();
    const { container } = await renderModule(onOpenProfilePrompts);
    const profileTab = container.querySelector("button[data-testid='prompt-profile-tab']") as HTMLButtonElement;
    expect(profileTab).toBeTruthy();
    await act(async () => { profileTab.click(); });
    expect(onOpenProfilePrompts).toHaveBeenCalledTimes(1);
  });
  it("adds a source, searches its body, selects an entry and copies it", async () => {
    const { container, notices } = await renderModule();
    const add = container.querySelector("button[data-testid='prompt-library-add-source']") as HTMLButtonElement;
    await act(async () => { add.click(); });
    expect(container.textContent).toContain("代码审查");
    const search = container.querySelector("input[name='promptLibrarySearch']") as HTMLInputElement;
    await act(async () => { search.value = "edge cases"; search.dispatchEvent(new Event("input", { bubbles: true })); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toContain("代码审查");
    const row = container.querySelector("button[data-testid='prompt-library-entry']") as HTMLButtonElement;
    await act(async () => { row.click(); });
    expect(container.textContent).toContain("Inspect edge cases");
    await act(async () => { (container.querySelector("button[data-testid='prompt-library-copy']") as HTMLButtonElement).click(); });
    expect(notices.some((notice) => notice.tone === "success")).toBe(true);
  });
  it("filters favorites and tags without losing the full source index", async () => {
    const { container, api } = await renderModule();
    await act(async () => { (container.querySelector("button[data-testid='prompt-library-add-source']") as HTMLButtonElement).click(); });
    await act(async () => { (container.querySelector("button[data-testid='prompt-library-entry']") as HTMLButtonElement).click(); });
    await act(async () => { (container.querySelector("button[data-testid='prompt-library-favorite']") as HTMLButtonElement).click(); });
    const favorites = container.querySelector("button[data-testid='prompt-library-favorites-filter']") as HTMLButtonElement;
    await act(async () => { favorites.click(); });
    expect(container.querySelectorAll("button[data-testid='prompt-library-entry']")).toHaveLength(1);
    expect(container.textContent).toContain("代码审查");
    const tags = container.querySelector("input[name='promptLibraryTagFilter']") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(tags, "release"); tags.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(container.querySelectorAll("button[data-testid='prompt-library-entry']")).toHaveLength(0);
    expect(container.textContent).toContain("demo-prompts");
  });
  it("requires confirmation before removing a source and its labels", async () => {
    const { container, api } = await renderModule();
    await act(async () => { (container.querySelector("button[data-testid='prompt-library-add-source']") as HTMLButtonElement).click(); });
    const view = await api.promptLibraryList(); const id = view.entries[0].id;
    await api.updatePromptLibraryMetadata(id, { favorite: true, tags: ["keep"] });
    await act(async () => { await (container.querySelector("button[data-testid='prompt-library-remove-source']") as HTMLButtonElement).click(); });
    expect((await api.promptLibraryList()).metadata[id].favorite).toBe(true);
    expect(document.body.textContent).toContain(i18n.t("surfaces.libraryRemoveConfirmTitle"));
  });
  it("keeps the adoption action explicit and shows a target-name field", async () => {
    const { container } = await renderModule();
    await act(async () => { (container.querySelector("button[data-testid='prompt-library-add-source']") as HTMLButtonElement).click(); });
    await act(async () => { (container.querySelector("button[data-testid='prompt-library-entry']") as HTMLButtonElement).click(); });
    expect(container.querySelector("input[name='promptLibraryTargetName']")).toBeTruthy();
    expect(container.querySelector("button[data-testid='prompt-library-adopt']")).toBeTruthy();
    expect(container.textContent).toContain(i18n.t("surfaces.libraryReadonlyHint"));
  });
});
