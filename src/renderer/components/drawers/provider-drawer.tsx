import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, CloudDownload, Copy, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import type { OmpModel, OmpProvider, ProviderPreset } from "@omp-switch/core";
import { CODE_MODE_VALUES, KNOWN_TOKENIZER_FAMILIES } from "@omp-switch/core/validation";
import { IconButton, StyledSelect } from "../ui-primitives";
import {
  FALLBACK_PRESETS,
  createModelEditorEntry,
  type FormState,
  type ModelEditorEntry,
} from "../../hooks/use-provider-form";

export interface ProviderDrawerProps {
  selectedProviderId: string | null;
  selectedProvider: OmpProvider | null;
  selectedModels: OmpModel[];
  formOpen: boolean;
  editingProviderId: string | null;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  modelEntries: ModelEditorEntry[];
  setModelEntries: React.Dispatch<React.SetStateAction<ModelEditorEntry[]>>;
  advancedOpen: boolean;
  setAdvancedOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  catalog: ProviderPreset[];
  choosePreset: (id: string) => void;
  updateModelEntry: (index: number, patch: Partial<ModelEditorEntry>) => void;
  fetchModels: () => Promise<void>;
  saveProvider: () => Promise<void>;
  editProvider: (id: string) => void;
  removeProvider: (id?: string) => void;
  busy: boolean;
  readOnly: boolean;
}

export function ProviderDrawer({
  selectedProviderId,
  selectedProvider,
  selectedModels,
  formOpen,
  editingProviderId,
  form,
  setForm,
  modelEntries,
  setModelEntries,
  advancedOpen,
  setAdvancedOpen,
  catalog,
  choosePreset,
  updateModelEntry,
  fetchModels,
  saveProvider,
  editProvider,
  removeProvider,
  busy,
  readOnly,
}: ProviderDrawerProps): ReactElement | null {
  const { t } = useTranslation();

  if (formOpen) {
    return (
      <form className="drawer-body form-drawer" onSubmit={(event) => { event.preventDefault(); void saveProvider(); }}>
        <div className="form-group">
          <div className="form-group-title">
            <span>{t("providerEditor.identity")}</span>
          </div>
          <label className="module-field">
            <span>{t("providerEditor.preset")}</span>
            <StyledSelect
              name="preset"
              value={form.id}
              onValueChange={(next) => choosePreset(next)}
              options={[
                { value: "", label: t("providerEditor.presetCustom") },
                ...(catalog.length ? catalog : FALLBACK_PRESETS).map((preset) => ({
                  value: preset.id,
                  label: preset.label,
                })),
              ]}
              ariaLabel={t("providerEditor.preset")}
            />
          </label>
          <div className="form-two">
            <label className="module-field">
              <span>ID</span>
              <input
                name="providerId"
                readOnly={Boolean(editingProviderId)}
                value={form.id}
                onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))}
                placeholder="openrouter"
              />
            </label>
            <label className="module-field">
              <span>API</span>
              <input
                name="providerApi"
                list="omp-api-options"
                value={form.api}
                onChange={(event) => setForm((current) => ({ ...current, api: event.target.value }))}
              />
              <datalist id="omp-api-options">
                <option value="openai-completions" />
                <option value="openai-responses" />
                <option value="openai-codex-responses" />
                <option value="azure-openai-responses" />
                <option value="anthropic-messages" />
                <option value="bedrock-converse-stream" />
                <option value="google-generative-ai" />
                <option value="google-gemini-cli" />
                <option value="google-vertex" />
              </datalist>
            </label>
          </div>
        </div>

        <div className="form-group">
          <div className="form-group-title">
            <span>{t("providerEditor.connection")}</span>
          </div>
          <label className="module-field">
            <span>Endpoint</span>
            <input
              name="baseUrl"
              value={form.baseUrl}
              onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
              placeholder="https://api.example.com/v1"
            />
          </label>
          <div className="form-two">
            <label className="module-field">
              <span>{t("providerEditor.auth")}</span>
              <StyledSelect
                name="auth"
                value={form.auth}
                onValueChange={(next) => setForm((current) => ({ ...current, auth: next }))}
                options={[
                  { value: "apiKey", label: "apiKey" },
                  { value: "none", label: "none" },
                  { value: "oauth", label: "oauth" },
                ]}
                ariaLabel={t("providerEditor.auth")}
                mono
              />
            </label>
            <label className="module-field">
              <span>{t("providerEditor.apiKey")}</span>
              <input
                name="apiKey"
                type="password"
                value={form.key}
                onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))}
                placeholder={t("providerEditor.apiKeyKeep")}
              />
            </label>
          </div>
          <span className="form-group-hint">{t("providerEditor.apiKeyHint")}</span>
        </div>

        <div className="form-group">
          <div className="form-group-title">
            <span>{t("providerEditor.models")}</span>
            <IconButton
              label={t("providerEditor.addModel")}
              onClick={() => setModelEntries((current) => [...current, createModelEditorEntry()])}
            >
              <Plus size={15} />
            </IconButton>
          </div>
          <div className="model-editor">
            {modelEntries.map((entry, index) => (
              <div className="model-editor-card" key={`${entry.raw.id}-${index}`}>
                <div className="model-editor-top">
                  <div className="model-editor-field model-id-field">
                    <span className="model-field-label">ID</span>
                    <input
                      name={`models.${index}.id`}
                      aria-label={t("models.modelField", { id: index + 1, field: "ID" })}
                      value={entry.id}
                      onChange={(event) => updateModelEntry(index, { id: event.target.value })}
                      placeholder="Model ID"
                    />
                  </div>
                  <div className="model-editor-field model-name-field">
                    <span className="model-field-label">{t("models.name")}</span>
                    <input
                      name={`models.${index}.name`}
                      aria-label={t("models.modelField", { id: index + 1, field: t("models.name") })}
                      value={entry.name}
                      onChange={(event) => updateModelEntry(index, { name: event.target.value })}
                      placeholder={t("models.name")}
                    />
                  </div>
                  <IconButton
                    className="model-editor-clone"
                    variant="subtle"
                    label={t("providerEditor.cloneModel")}
                    onClick={() => {
                      const suffix = "-copy";
                      const clonedId = entry.id ? `${entry.id}${suffix}` : "";
                      const cloned = { ...entry, id: clonedId, raw: { ...entry.raw, id: clonedId } };
                      setModelEntries((current) => [
                        ...current.slice(0, index + 1),
                        cloned,
                        ...current.slice(index + 1),
                      ]);
                    }}
                  >
                    <Copy size={14} />
                  </IconButton>
                  <IconButton
                    className="model-editor-delete"
                    variant="danger"
                    label={t("providerEditor.deleteModel")}
                    onClick={() => setModelEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </div>
                <div className="model-editor-params">
                  <div className="model-param-group">
                    <label className="model-param-label">
                      <span>Context</span>
                      <input
                        name={`models.${index}.contextWindow`}
                        aria-label={t("models.modelField", { id: index + 1, field: "Context" })}
                        inputMode="numeric"
                        value={entry.contextWindow}
                        onChange={(event) => updateModelEntry(index, { contextWindow: event.target.value })}
                        placeholder="128000"
                      />
                    </label>
                    <label className="model-param-label">
                      <span>Max</span>
                      <input
                        name={`models.${index}.maxTokens`}
                        aria-label={t("models.modelField", { id: index + 1, field: "Max output" })}
                        inputMode="numeric"
                        value={entry.maxTokens}
                        onChange={(event) => updateModelEntry(index, { maxTokens: event.target.value })}
                        placeholder="16384"
                      />
                    </label>
                  </div>
                  <div className="model-flags-group">
                    <label className="check-line">
                      <input
                        name={`models.${index}.reasoning`}
                        type="checkbox"
                        checked={entry.reasoning}
                        onChange={(event) => updateModelEntry(index, { reasoning: event.target.checked })}
                      />
                      {t("models.capabilityReasoning")}
                    </label>
                    <label className="check-line">
                      <input
                        name={`models.${index}.vision`}
                        type="checkbox"
                        checked={entry.vision}
                        onChange={(event) => updateModelEntry(index, { vision: event.target.checked })}
                      />
                      {t("models.capabilityVision")}
                    </label>
                  </div>
                </div>
                <details className="model-advanced">
                  <summary>{t("providerEditor.advanced")}</summary>
                  <div className="model-advanced-grid">
                    <label>
                      {t("providerEditor.api")}
                      <input
                        name={`models.${index}.api`}
                        list="omp-api-options"
                        value={entry.api}
                        onChange={(event) => updateModelEntry(index, { api: event.target.value })}
                        placeholder={t("providerEditor.inheritProvider")}
                      />
                    </label>
                    <label>
                      Transport
                      <input
                        name={`models.${index}.transport`}
                        value={entry.transport}
                        onChange={(event) => updateModelEntry(index, { transport: event.target.value })}
                        placeholder="pi-native"
                      />
                    </label>
                    <label>
                      {t("providerEditor.imageDecoder")}
                      <input
                        name={`models.${index}.imageInputDecoder`}
                        value={entry.imageInputDecoder}
                        onChange={(event) => updateModelEntry(index, { imageInputDecoder: event.target.value })}
                        placeholder="stb"
                      />
                    </label>
                    <label>
                      Tokenizer
                      <StyledSelect
                        name={`models.${index}.tokenizer`}
                        value={entry.tokenizer}
                        onValueChange={(next) => updateModelEntry(index, { tokenizer: next })}
                        options={[
                          { value: "", label: t("providerEditor.inheritAuto") },
                          ...Array.from(KNOWN_TOKENIZER_FAMILIES).map((family) => ({ value: family, label: family })),
                        ]}
                        ariaLabel={t("models.modelField", { id: index + 1, field: "Tokenizer" })}
                        mono
                      />
                    </label>
                    <label>
                      Headers
                      <textarea
                        name={`models.${index}.headers`}
                        value={entry.headers}
                        onChange={(event) => updateModelEntry(index, { headers: event.target.value })}
                        rows={2}
                        placeholder='{"X-Client":"omp-switch"}'
                      />
                    </label>
                    <label>
                      Compat
                      <textarea
                        name={`models.${index}.compat`}
                        value={entry.compat}
                        onChange={(event) => updateModelEntry(index, { compat: event.target.value })}
                        rows={2}
                      />
                    </label>
                    <label>
                      {t("models.remoteCompactionLabel")}
                      <textarea
                        name={`models.${index}.remoteCompaction`}
                        value={entry.remoteCompaction}
                        onChange={(event) => updateModelEntry(index, { remoteCompaction: event.target.value })}
                        rows={2}
                        placeholder='{"enabled":true}'
                      />
                    </label>
                    <label>
                      Cost
                      <textarea
                        name={`models.${index}.cost`}
                        value={entry.cost}
                        onChange={(event) => updateModelEntry(index, { cost: event.target.value })}
                        rows={2}
                        placeholder='{"input":0.1,"output":0.4}'
                      />
                    </label>
                  </div>
                </details>
              </div>
            ))}
            {!modelEntries.length ? <span className="muted-line">{t("providerEditor.emptyModels")}</span> : null}
          </div>
        </div>

        <div className="form-group">
          <button
            type="button"
            className="drawer-disclosure form-group-disclosure"
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            <span>{t("providerEditor.providerAdvanced")}</span>
            <ChevronDown size={15} className={advancedOpen ? "rotate-open" : ""} />
          </button>
          {advancedOpen ? (
            <div className="advanced-fields">
              <div className="form-two">
                <label className="module-field">
                  <span>{t("providerEditor.discovery")}</span>
                  <StyledSelect
                    name="discoveryType"
                    value={form.discoveryType}
                    onValueChange={(next) => setForm((current) => ({ ...current, discoveryType: next }))}
                    options={[
                      { value: "", label: t("providerEditor.discoveryManual") },
                      { value: "openai-models-list", label: "OpenAI" },
                      { value: "ollama", label: "Ollama" },
                      { value: "llama.cpp", label: "llama.cpp" },
                      { value: "lm-studio", label: "LM Studio" },
                      { value: "proxy", label: "Proxy" },
                      { value: "litellm", label: "LiteLLM" },
                    ]}
                    ariaLabel={t("providerEditor.discovery")}
                  />
                </label>
                <label className="module-field">
                  <span>Transport</span>
                  <input
                    name="transport"
                    value={form.transport}
                    onChange={(event) => setForm((current) => ({ ...current, transport: event.target.value }))}
                    placeholder="pi-native"
                  />
                </label>
              </div>
              <div className="form-two">
                <label className="check-line">
                  <input
                    name="authHeader"
                    type="checkbox"
                    checked={form.authHeader}
                    onChange={(event) => setForm((current) => ({ ...current, authHeader: event.target.checked }))}
                  />
                  Auth header
                </label>
                <label className="check-line">
                  <input
                    name="disableStrictTools"
                    type="checkbox"
                    checked={form.disableStrictTools}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, disableStrictTools: event.target.checked }))
                    }
                  />
                  {t("providerEditor.looseTools")}
                </label>
              </div>
              <label className="module-field">
                <span>Headers</span>
                <textarea
                  name="headers"
                  value={form.headers}
                  onChange={(event) => setForm((current) => ({ ...current, headers: event.target.value }))}
                  rows={3}
                  placeholder='{"X-Client":"omp-switch"}'
                />
              </label>
              <label className="module-field">
                <span>Compat</span>
                <textarea
                  name="compat"
                  value={form.compat}
                  onChange={(event) => setForm((current) => ({ ...current, compat: event.target.value }))}
                  rows={3}
                />
              </label>
              <label className="module-field">
                <span>Overrides</span>
                <textarea
                  name="overrides"
                  value={form.overrides}
                  onChange={(event) => setForm((current) => ({ ...current, overrides: event.target.value }))}
                  rows={3}
                />
              </label>
              <label className="module-field">
                <span>{t("models.remoteCompactionLabel")}</span>
                <textarea
                  name="remoteCompaction"
                  value={form.remoteCompaction}
                  onChange={(event) => setForm((current) => ({ ...current, remoteCompaction: event.target.value }))}
                  rows={3}
                  placeholder='{"enabled":true,"endpoint":"https://..."}'
                />
              </label>
              <label className="module-field">
                <span>Cost</span>
                <textarea
                  name="cost"
                  value={form.cost}
                  onChange={(event) => setForm((current) => ({ ...current, cost: event.target.value }))}
                  rows={2}
                  placeholder='{"input":0.1,"output":0.4}'
                />
              </label>
              <label className="module-field">
                <span>Code Mode</span>
                <StyledSelect
                  name="codeMode"
                  value={form.codeMode}
                  onValueChange={(next) => setForm((current) => ({ ...current, codeMode: next }))}
                  options={[
                    { value: "", label: t("providerEditor.codeModeUnset") },
                    ...CODE_MODE_VALUES.map((mode) => ({ value: mode, label: mode })),
                  ]}
                  ariaLabel="Codex Code Mode"
                  mono
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="drawer-actions form-submit-actions">
          {editingProviderId ? (
            <button
              type="button"
              className="secondary-button danger"
              onClick={() => removeProvider(editingProviderId)}
              disabled={busy || readOnly}
            >
              <Trash2 size={15} />
              {t("common.delete")}
            </button>
          ) : null}
          <button type="button" className="secondary-button" onClick={() => void fetchModels()} disabled={busy}>
            <CloudDownload size={15} />
            {t("providerEditor.testAndDiscover")}
          </button>
          <button type="submit" className="primary-button" disabled={busy || readOnly}>
            <Save size={15} />
            {t("providerEditor.save")}
          </button>
        </div>
      </form>
    );
  }

  if (selectedProvider) {
    return (
      <div className="drawer-body">
        <div className="drawer-section">
          <div className="drawer-section-title">
            <span>{t("providerEditor.connection")}</span>
            <span className="status-chip ok">
              {selectedProvider.auth === "none"
                ? t("models.noKeyNeeded")
                : selectedProvider.apiKey
                  ? t("models.keyConfigured")
                  : t("models.keyNotConfigured")}
            </span>
          </div>
          <div className="detail-grid">
            <span>API</span>
            <strong>{selectedProvider.api ?? "custom"}</strong>
            <span>Endpoint</span>
            <strong className="mono break">{selectedProvider.baseUrl ?? "—"}</strong>
            <span>Auth</span>
            <strong>{selectedProvider.auth ?? "apiKey"}</strong>
          </div>
          <div className="drawer-actions">
            <button className="primary-button" onClick={() => editProvider(selectedProviderId!)}>
              <Sparkles size={15} />
              {t("models.edit")}
            </button>
            <IconButton
              variant="danger"
              label={t("providerEditor.removeProvider", { target: selectedProviderId ?? "" })}
              onClick={() => void removeProvider(selectedProviderId!)}
              disabled={busy || readOnly}
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">
            <span>{t("providerEditor.models")}</span>
            <span className="status-chip neutral">{selectedModels.length}</span>
          </div>
          {selectedModels.map((model) => (
            <div className="mini-model" key={model.id}>
              <strong title={model.name ?? model.id}>{model.name ?? model.id}</strong>
              <span title={model.id}>{model.id}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}
