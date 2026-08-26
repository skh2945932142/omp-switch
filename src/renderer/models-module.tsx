import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  CloudDownload,
  Copy,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { looksLikePlaintextSecret, type OmpModel, type OmpProvider } from "@omp-switch/core";
import { IconButton, IconButtonTip } from "./components/ui-primitives";
import { QuickAssign } from "./components/quick-assign";
import { providerModels } from "./hooks/use-provider-form";
import {
  isProviderDisabled,
  providerApplyBlockReason,
  type DisabledProviderRule,
} from "./provider-selection";

export interface ModelsModuleProps {
  profileId: string;
  providers: Array<[string, OmpProvider]>;
  preferredProviderId: string | null;
  applyingProviderId: string | null;
  expandedProviders: Record<string, boolean>;
  setExpandedProviders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  query: string;
  setQuery: (q: string) => void;
  readOnly: boolean;
  busy: boolean;
  pendingSave: boolean;
  draftDisabledProviders: DisabledProviderRule[];
  agentDir: string;
  roleIds: Array<[string, string]>;
  roles: Record<string, string>;
  providerIds: string[];
  onApplyProvider: (id: string) => void;
  onEditProvider: (id: string) => void;
  onRemoveProvider: (id: string) => void;
  onAddCustom: () => void;
  onAddPreset: () => void;
  onImportCatalog: (event: ChangeEvent<HTMLInputElement>) => void;
  onAssignModelToRole: (roleId: string, providerId: string, modelId: string) => void;
  onOpenRoles: () => void;
  coverageFor: (provider: OmpProvider, id: string) => number;
  onNotice?: (notice: { tone: "info" | "success" | "error"; text: string }) => void;
  onMigratePlaintext?: (providerId: string) => void;
}

export type ProviderCategory = "all" | "enabled" | "local" | "cloud";

function isLocalProvider(provider: OmpProvider): boolean {
  if (provider.discovery?.type && ["ollama", "llama.cpp", "lm-studio"].includes(provider.discovery.type)) return true;
  const url = (provider.baseUrl ?? "").toLowerCase();
  return url.includes("127.0.0.1") || url.includes("localhost") || url.includes("0.0.0.0");
}

export function ModelsModule({
  profileId,
  providers,
  preferredProviderId,
  applyingProviderId,
  expandedProviders,
  setExpandedProviders,
  query,
  setQuery,
  readOnly,
  busy,
  pendingSave,
  draftDisabledProviders,
  agentDir,
  roleIds,
  roles,
  providerIds,
  onApplyProvider,
  onEditProvider,
  onRemoveProvider,
  onAddCustom,
  onAddPreset,
  onImportCatalog,
  onAssignModelToRole,
  onOpenRoles,
  coverageFor,
  onNotice,
  onMigratePlaintext,
}: ModelsModuleProps): ReactElement {
  const { t } = useTranslation();
  const catalogInput = useRef<HTMLInputElement | null>(null);
  const [category, setCategory] = useState<ProviderCategory>("all");

  const counts = useMemo(() => {
    let enabled = 0;
    let local = 0;
    let cloud = 0;
    for (const [id, provider] of providers) {
      if (coverageFor(provider, id) > 0 && !isProviderDisabled(id, draftDisabledProviders, agentDir)) enabled++;
      if (isLocalProvider(provider)) local++;
      else cloud++;
    }
    return { all: providers.length, enabled, local, cloud };
  }, [providers, draftDisabledProviders, agentDir, coverageFor]);

  const filteredProviders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return providers.filter(([id, provider]) => {
      if (category === "enabled" && (coverageFor(provider, id) === 0 || isProviderDisabled(id, draftDisabledProviders, agentDir))) return false;
      if (category === "local" && !isLocalProvider(provider)) return false;
      if (category === "cloud" && isLocalProvider(provider)) return false;

      if (!q) return true;
      const text = `${id} ${provider.api ?? ""} ${provider.baseUrl ?? ""} ${providerModels(provider)
        .map((model) => `${model.id} ${model.name ?? ""}`)
        .join(" ")}`.toLowerCase();
      return text.includes(q);
    });
  }, [providers, query, category, draftDisabledProviders, agentDir, coverageFor]);

  return (
    <>
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">{profileId}</span>
          <h1>{t("models.heading")}</h1>
        </div>
        <div className="heading-actions">
          <div className="search-box">
            <Search size={15} />
            <input
              name="providerSearch"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("models.searchPlaceholder")}
              aria-label={t("models.searchAria")}
            />
          </div>
          <div className="new-wrap">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="primary-button" disabled={readOnly}>
                  <Plus size={16} />
                  {t("models.add")}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="dd-menu" align="end" sideOffset={6} collisionPadding={10}>
                  <DropdownMenu.Item className="dd-item" onSelect={onAddCustom}>
                    {t("models.custom")}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="dd-item" onSelect={onAddPreset}>
                    {t("models.preset")}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="dd-item" onSelect={() => catalogInput.current?.click()}>
                    {t("models.importCatalog")}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <input
              name="catalogFile"
              ref={catalogInput}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              aria-label={t("models.importCatalog")}
              onChange={onImportCatalog}
            />
          </div>
        </div>
      </div>

      <div className="filter-pill-bar" role="tablist" aria-label={t("models.filterCategoriesAria")}>
        <button
          role="tab"
          aria-selected={category === "all"}
          className={`filter-pill ${category === "all" ? "active" : ""}`}
          onClick={() => setCategory("all")}
        >
          {t("models.filterAll")}
          <span className="pill-count">{counts.all}</span>
        </button>
        <button
          role="tab"
          aria-selected={category === "enabled"}
          className={`filter-pill ${category === "enabled" ? "active" : ""}`}
          onClick={() => setCategory("enabled")}
        >
          {t("models.filterEnabled")}
          <span className="pill-count">{counts.enabled}</span>
        </button>
        <button
          role="tab"
          aria-selected={category === "local"}
          className={`filter-pill ${category === "local" ? "active" : ""}`}
          onClick={() => setCategory("local")}
        >
          {t("models.filterLocal")}
          <span className="pill-count">{counts.local}</span>
        </button>
        <button
          role="tab"
          aria-selected={category === "cloud"}
          className={`filter-pill ${category === "cloud" ? "active" : ""}`}
          onClick={() => setCategory("cloud")}
        >
          {t("models.filterCloud")}
          <span className="pill-count">{counts.cloud}</span>
        </button>
      </div>

      <div className="provider-grid">
        {filteredProviders.length === 0 ? (
          <div className="empty-card">
            <CloudDownload size={24} />
            <strong>{t("models.noProviders")}</strong>
            <span>{t("models.noProvidersHint")}</span>
          </div>
        ) : null}
        {filteredProviders.map(([id, provider]) => {
          const models = providerModels(provider);
          const expanded = expandedProviders[id] ?? false;
          const preferred = preferredProviderId === id;
          const applying = applyingProviderId === id;
          const coverage = coverageFor(provider, id);
          const applyReason = providerApplyBlockReason({
            readOnly,
            disabled: isProviderDisabled(id, draftDisabledProviders, agentDir),
            modelCount: models.length,
            auth: provider.auth ?? "apiKey",
            apiKey: provider.apiKey,
          });
          const applyTooltip = applyReason
            ? t(`models.applyBlocked.${applyReason}`)
            : preferred
              ? t("models.applied")
              : t("models.applyHint");

          return (
            <article
              className={`provider-card${preferred ? " preferred" : ""}${applying ? " applying" : ""}`}
              key={id}
            >
              <div className="provider-card-head">
                <button
                  className="provider-card-toggle"
                  onClick={() => setExpandedProviders((current) => ({ ...current, [id]: !expanded }))}
                  aria-expanded={expanded}
                >
                  <span className="provider-title">
                    <strong>{id}</strong>
                    <small>{provider.api ?? "custom"}</small>
                  </span>
                  <span className="provider-model-count">{models.length}</span>
                  <ChevronDown size={16} className={`provider-chevron${expanded ? " open" : ""}`} />
                </button>
                <div className="provider-actions">
                  <IconButtonTip label={applyTooltip}>
                    <span className="provider-action-tip">
                      <button
                        className={`provider-apply${preferred ? " applied" : ""}`}
                        aria-label={applyTooltip}
                        aria-pressed={preferred}
                        disabled={Boolean(applyReason) || preferred || busy || pendingSave}
                        onClick={(event) => {
                          event.stopPropagation();
                          onApplyProvider(id);
                        }}
                      >
                        {applying ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : preferred ? (
                          <Check size={14} />
                        ) : (
                          <ArrowUp size={14} />
                        )}
                        <span>
                          {applying ? t("models.applying") : preferred ? t("models.applied") : t("models.apply")}
                        </span>
                      </button>
                    </span>
                  </IconButtonTip>
                  <IconButton
                    className="provider-edit"
                    label={t("models.editAria", { id })}
                    onClick={() => onEditProvider(id)}
                  >
                    <Pencil size={15} />
                  </IconButton>
                  <IconButton
                    className="provider-delete"
                    label={t("providerEditor.removeProvider", { target: id })}
                    variant="danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveProvider(id);
                    }}
                    disabled={readOnly || busy || pendingSave}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              </div>
              <div className={`model-list-wrap${expanded ? " open" : ""}`}>
                <div className="model-list-clip">
                  <div className="provider-meta-bar">
                    <span className="provider-meta-endpoint mono" title={provider.baseUrl ?? ""}>
                      {provider.baseUrl ?? t("models.noEndpoint")}
                    </span>
                    <span className="provider-meta-sep">·</span>
                    {(() => {
                      const isPlaintext = typeof provider.apiKey === "string" && looksLikePlaintextSecret(provider.apiKey);
                      return (
                        <>
                          <span
                            className={`provider-meta-status ${
                              provider.auth === "none"
                                ? "ok"
                                : isPlaintext
                                  ? "warn"
                                  : provider.apiKey
                                    ? "ok"
                                    : "warn"
                            }`}
                          >
                            {provider.auth === "none"
                              ? t("models.noKeyNeeded")
                              : isPlaintext
                                ? t("models.plaintextKeyWarn")
                                : provider.apiKey
                                  ? t("models.keyConfigured")
                                  : t("models.keyNotConfigured")}
                          </span>
                          {isPlaintext && onMigratePlaintext && !readOnly ? (
                            <>
                              <span className="provider-meta-sep">·</span>
                              <button
                                type="button"
                                className="provider-meta-migrate-btn"
                                disabled={busy || pendingSave}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMigratePlaintext(id);
                                }}
                                title={t("models.migrateToVaultTooltip")}
                              >
                                <LockKeyhole size={11} />
                                <span>{t("models.migrateToVault")}</span>
                              </button>
                            </>
                          ) : null}
                        </>
                      );
                    })()}
                    {models.length > 0 && coverage < models.length ? (
                      <>
                        <span className="provider-meta-sep">·</span>
                        <span
                          className="provider-meta-coverage warn-line"
                          title={t("models.coverageTitle")}
                        >
                          {coverage === 0
                            ? t("models.coverageNotEnabled")
                            : t("models.coveragePartial", { covered: coverage, total: models.length })}
                        </span>
                      </>
                    ) : null}
                  </div>
                  <div className="model-list">
                    {models.map((model) => (
                      <div className="model-row" key={model.id}>
                        <span className="model-name">
                          <strong title={model.name ?? model.id}>{model.name ?? model.id}</strong>
                          <small title={model.id}>{model.id}</small>
                          {model.disabledReason ? (
                            <span className="model-disabled-reason warn-line" title={model.disabledReason}>
                              <CircleAlert size={12} />
                              <span>{model.disabledReason}</span>
                            </span>
                          ) : null}
                        </span>
                        <span className="model-api" title={model.api ?? provider.api ?? "—"}>
                          {model.api ?? provider.api ?? "—"}
                        </span>
                        <span className="model-context">
                          {typeof model.contextWindow === "number" ? model.contextWindow.toLocaleString() : "—"}
                        </span>
                        <span className="capabilities">
                          <span className={model.reasoning ? "capability on" : "capability"}>
                            {model.reasoning ? t("models.capabilityReasoning") : t("models.capabilityStandard")}
                          </span>
                          <span className="capability">
                            {model.input?.includes("image") ? t("models.capabilityVision") : t("models.capabilityText")}
                          </span>
                        </span>
                        <QuickAssign
                          roles={roleIds}
                          assignments={roles}
                          providerId={id}
                          modelId={model.id ?? ""}
                          providerIds={providerIds}
                          onAssign={(roleId) => onAssignModelToRole(roleId, id, model.id ?? "")}
                          onOpenRoles={onOpenRoles}
                        />
                        <IconButton
                          label={t("models.copyModelId", { model: `${id}/${model.id}` })}
                          variant="subtle"
                          onClick={(event) => {
                            event.stopPropagation();
                            const identifier = `${id}/${model.id}`;
                            void navigator.clipboard.writeText(identifier);
                            onNotice?.({ tone: "success", text: t("models.copiedModelId", { model: identifier }) });
                          }}
                        >
                          <Copy size={13} />
                        </IconButton>
                      </div>
                    ))}
                    {models.length === 0 ? <div className="model-empty">{t("models.emptyModels")}</div> : null}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
