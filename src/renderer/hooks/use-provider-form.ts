import { useState } from "react";
import type { OmpModel, OmpProvider, ProviderPreset } from "@omp-switch/core";
import {
  FALLBACK_PRESETS,
  type FormState,
  type ModelEditorEntry,
  blankForm,
  formatJson,
  toModelEditorEntry,
  providerModels,
} from "@omp-switch/shared";

export { FALLBACK_PRESETS, blankForm, formatJson, toModelEditorEntry, createModelEditorEntry, parseHeaders, parseObjectJson, parseModelOverrides, parseCost, parseOptionalPositiveInteger, buildModels, providerModels } from "@omp-switch/shared";
export type { FormState, ModelEditorEntry } from "@omp-switch/shared";

export function useProviderForm(catalog: ProviderPreset[]) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [modelEntries, setModelEntries] = useState<ModelEditorEntry[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function openCreateForm() {
    setEditingProviderId(null);
    setForm(blankForm());
    setModelEntries([
      toModelEditorEntry({
        id: "gpt-4.1",
        name: "GPT-4.1",
        reasoning: true,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16384,
      }),
    ]);
    setAdvancedOpen(false);
    setFormOpen(true);
  }

  function openEditForm(providerId: string, provider: OmpProvider) {
    setEditingProviderId(providerId);
    setForm({
      id: providerId,
      baseUrl: provider.baseUrl ?? "",
      api: provider.api ?? "openai-completions",
      auth: provider.auth ?? "apiKey",
      key: "",
      headers: formatJson(provider.headers),
      compat: formatJson(provider.compat),
      overrides: formatJson(provider.modelOverrides),
      discoveryType: provider.discovery?.type ?? "",
      authHeader: provider.authHeader ?? true,
      disableStrictTools: Boolean(provider.disableStrictTools),
      transport: provider.transport ?? "",
      remoteCompaction: formatJson(provider.remoteCompaction),
      cost: formatJson(provider.cost),
      codeMode: provider.codeMode ?? "",
    });
    setModelEntries(providerModels(provider).map(toModelEditorEntry));
    setAdvancedOpen(false);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingProviderId(null);
  }

  function choosePreset(id: string) {
    const preset = catalog.find((item) => item.id === id) ?? FALLBACK_PRESETS.find((item) => item.id === id || item.label === id);
    if (!preset) return;
    setForm((current) => ({
      ...current,
      id: preset.id,
      baseUrl: preset.baseUrl,
      api: preset.api,
      auth: preset.auth ?? current.auth,
      discoveryType: preset.discovery?.type ?? "",
    }));
  }

  function updateModelEntry(index: number, patch: Partial<ModelEditorEntry>) {
    setModelEntries((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  return {
    formOpen,
    setFormOpen,
    editingProviderId,
    form,
    setForm,
    modelEntries,
    setModelEntries,
    advancedOpen,
    setAdvancedOpen,
    openCreateForm,
    openEditForm,
    closeForm,
    choosePreset,
    updateModelEntry,
  };
}
