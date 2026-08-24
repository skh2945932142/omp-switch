import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import {
  Download,
  FileCheck2,
  FilePlus2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import type { ManagedSurfaceEntry, SurfaceBundle } from "@omp-switch/core";
import { ConfirmDialog } from "../../components/save-flow";
import { IconButton } from "../../components/ui-primitives";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../locale";

type AppApi = NonNullable<Window["ompSwitch"]>;
type Notice = { tone: "success" | "error" | "info"; text: string };

export interface SurfaceModuleProps {
  api: AppApi;
  profileId: string;
  kind: "prompt" | "skill";
  readOnly: boolean;
  onNotice: (notice: Notice) => void;
}

function triggerDownload(filename: string, content: string, type = "application/json"): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function SurfaceModule({ api, profileId, kind, readOnly, onNotice }: SurfaceModuleProps): ReactElement {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ManagedSurfaceEntry[]>([]);
  const [selected, setSelected] = useState<ManagedSurfaceEntry | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const label = t(kind === "prompt" ? "surfaces.prompt" : "surfaces.skill");

  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      const next = await api.listSurface(profileId, kind);
      setEntries(next);
      if (selected) {
        const current = next.find((entry) => entry.id === selected.id);
        if (!current) {
          setSelected(null);
          setEditing(false);
        } else setSelected(current);
      }
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [profileId, kind]);

  async function openEntry(entry: ManagedSurfaceEntry): Promise<void> {
    setLoading(true);
    try {
      setSelected(entry);
      setName(entry.name);
      setContent(await api.readSurface(profileId, kind, entry.name));
      setEditing(false);
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  function beginNew(): void {
    setSelected(null);
    setName("");
    setContent("");
    setEditing(true);
  }

  async function saveEntry(): Promise<void> {
    if (readOnly) return onNotice({ tone: "error", text: t("surfaces.readonly") });
    if (!name.trim()) return onNotice({ tone: "error", text: t("surfaces.nameRequired", { label }) });
    setLoading(true);
    try {
      const saved = await api.writeSurface(profileId, kind, name.trim(), content);
      await refresh();
      setSelected(saved);
      setName(saved.name);
      setEditing(false);
      onNotice({ tone: "success", text: t("surfaces.saved", { label }) });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function removeEntry(): Promise<void> {
    if (!selected || selected.source !== "profile") return;
    setConfirmDelete(true);
  }

  async function confirmRemove(): Promise<void> {
    if (!selected || selected.source !== "profile") return;
    setConfirmDelete(false);
    setLoading(true);
    try {
      await api.deleteSurface(profileId, kind, selected.name);
      setSelected(null);
      setEditing(false);
      await refresh();
      onNotice({ tone: "success", text: t("surfaces.deleted", { label }) });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function exportEntries(): Promise<void> {
    try {
      const bundle = await api.exportSurfaces(profileId);
      triggerDownload(`omp-${profileId}-surfaces.json`, JSON.stringify(bundle, null, 2));
      onNotice({ tone: "success", text: t("surfaces.exported") });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function importEntries(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text()) as SurfaceBundle;
      const imported = await api.importSurfaces(profileId, bundle);
      await refresh();
      onNotice({ tone: "success", text: t("surfaces.imported", { count: imported.length }) });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  const writable = Boolean(selected?.source === "profile" || !selected);
  return (
    <section className="module-view module-shell">
      <div className="workspace-heading module-heading">
        <div>
          <span className="eyebrow">{profileId}</span>
          <h1>{label}<span className="heading-count">{entries.length}</span></h1>
        </div>
        <div className="heading-actions">
          <IconButton label={t("surfaces.refresh")} onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} />
          </IconButton>
          <IconButton label={t("surfaces.export")} onClick={() => void exportEntries()} disabled={loading}>
            <Download size={16} />
          </IconButton>
          <IconButton label={t("surfaces.import")} onClick={() => fileInput.current?.click()} disabled={loading || readOnly}>
            <Upload size={16} />
          </IconButton>
          <input name={`${kind}Import`} ref={fileInput} className="visually-hidden" type="file" accept="application/json,.json" aria-label={t("surfaces.import")} onChange={(event) => void importEntries(event)} />
          <button className="primary-button" onClick={beginNew} disabled={readOnly}>
            <Plus size={16} />{t("surfaces.new")}
          </button>
        </div>
      </div>
      <div className="module-columns">
        <div className="module-list-panel">
          {entries.length === 0 ? (
            <div className="module-empty compact-empty">
              <span className="empty-glyph"><FileCheck2 size={26} /></span>
              <strong>{t("surfaces.empty", { label })}</strong>
              <span className="empty-desc">{t("surfaces.emptyHint", { label })}</span>
              <div className="empty-actions">
                <button className="primary-button" onClick={beginNew} disabled={readOnly}>
                  <FilePlus2 size={15} />{t("surfaces.newWithLabel", { label })}
                </button>
                <button className="secondary-button" onClick={() => fileInput.current?.click()} disabled={loading || readOnly}>
                  <Upload size={15} />{t("surfaces.import")}
                </button>
              </div>
            </div>
          ) : (
            entries.map((entry) => (
              <button key={entry.id} className={`module-list-row ${selected?.id === entry.id ? "active" : ""}`} onClick={() => void openEntry(entry)}>
                <span className="module-row-main">
                  <strong>{entry.name}</strong>
                  <small>{formatDateTime(entry.updatedAt)}</small>
                </span>
                <span className={`status-chip ${entry.source === "profile" ? "ok" : "neutral"}`}>
                  {entry.source === "profile" ? t("surfaces.editable") : t("surfaces.readonlyBadge")}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="module-editor-panel">
          {selected || editing ? (
            <>
              <div className="editor-head">
                <div>
                  <span className="eyebrow">{selected ? t(`surfaces.source.${selected.source}`) : t("common.profile")}</span>
                  <strong>{editing ? (selected ? t("surfaces.edit") : t("surfaces.new")) : selected?.name}</strong>
                </div>
                <div className="drawer-actions">
                  {selected && !editing ? (
                    <IconButton label={t("common.delete")} variant="danger" onClick={() => void removeEntry()} disabled={loading || selected.source !== "profile"}>
                      <Trash2 size={15} />
                    </IconButton>
                  ) : null}
                  <button className="secondary-button" onClick={() => setEditing((value) => !value)} disabled={!writable}>
                    {editing ? t("surfaces.preview") : t("surfaces.edit")}
                  </button>
                </div>
              </div>
              {editing ? (
                <>
                  <label className="module-field">
                    <span>{t("surfaces.name")}</span>
                    <input name={`${kind}Name`} value={name} onChange={(event) => setName(event.target.value)} disabled={Boolean(selected && selected.source !== "profile")} placeholder={kind === "prompt" ? "review" : "release"} />
                  </label>
                  <label className="module-field">
                    <span>{kind === "prompt" ? t("surfaces.content") : "SKILL.md"}</span>
                    <textarea name={`${kind}Content`} className="surface-editor" value={content} onChange={(event) => setContent(event.target.value)} disabled={!writable} spellCheck={false} />
                  </label>
                  <button className="primary-button full-width" onClick={() => void saveEntry()} disabled={loading || !writable}>
                    <Save size={15} />{t("common.save")}
                  </button>
                </>
              ) : (
                <pre className="raw-view surface-readonly">{content || t("surfaces.blank")}</pre>
              )}
            </>
          ) : (
            <div className="module-empty compact-empty">
              <span className="empty-glyph"><FileCheck2 size={26} /></span>
              <strong>{t("surfaces.selectPrompt", { label })}</strong>
              <span className="empty-desc">{t("surfaces.selectHint", { label })}</span>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={t("common.delete")}
        message={t("surfaces.deleteConfirm", { label, name: selected?.name ?? "" })}
        confirmLabel={t("common.delete")}
        danger
        busy={loading}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void confirmRemove()}
      />
    </section>
  );
}
