import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  Check,
  Clipboard,
  ExternalLink,
  FileSearch,
  FolderPlus,
  History,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import type { PromptAdoptionPreview, PromptLibraryEntry, PromptLibraryMetadata, PromptLibraryView, PromptWriteSnapshot } from "@omp-switch/core";
import { ConfirmDialog } from "../../components/save-flow";
import { IconButton } from "../../components/ui-primitives";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../locale";

interface PromptLibraryModuleProps {
  api: NonNullable<Window["ompSwitch"]>;
  profileId: string;
  readOnly: boolean;
  onNotice: (notice: { tone: "success" | "error" | "info"; text: string }) => void;
  onOpenProfilePrompts?: () => void;
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function PromptLibraryModule({ api, profileId, readOnly, onNotice, onOpenProfilePrompts }: PromptLibraryModuleProps): ReactElement {
  const { t } = useTranslation();
  const [view, setView] = useState<PromptLibraryView | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [targetName, setTargetName] = useState("");
  const [adoption, setAdoption] = useState<PromptAdoptionPreview | null>(null);
  const [history, setHistory] = useState<PromptWriteSnapshot[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<PromptWriteSnapshot | null>(null);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [removeSourceId, setRemoveSourceId] = useState<string | null>(null);

  const selected = useMemo(() => view?.entries.find((entry) => entry.id === selectedId) ?? null, [selectedId, view]);
  const visibleEntries = (view?.entries ?? []).filter((entry) => {
    const metadata = view?.metadata[entry.id] ?? { favorite: false, tags: [] };
    return (!favoriteOnly || metadata.favorite) && (!tagQuery.trim() || metadata.tags.some((tag) => tag.toLowerCase().includes(tagQuery.trim().toLowerCase())));
  });
  const selectedMetadata: PromptLibraryMetadata = selectedId ? (view?.metadata[selectedId] ?? { favorite: false, tags: [] }) : { favorite: false, tags: [] };

  async function load(nextQuery = query): Promise<void> {
    setBusy(true);
    try {
      const next = await api.promptLibraryList(nextQuery);
      setView(next);
      if (selectedId && !next.entries.some((entry) => entry.id === selectedId)) {
        setSelectedId(null); setContent("");
      }
    } catch (error) { onNotice({ tone: "error", text: errorText(error) }); }
    finally { setBusy(false); }
  }

  async function loadHistory(): Promise<void> {
    try { setHistory(await api.listPromptAdoptions(profileId)); }
    catch (error) { onNotice({ tone: "error", text: errorText(error) }); }
  }

  useEffect(() => { void load(""); void loadHistory(); }, [profileId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function addSource(): Promise<void> {
    setBusy(true);
    try { setView(await api.choosePromptLibrarySource(t("surfaces.libraryAddSource"))); onNotice({ tone: "success", text: t("surfaces.librarySourceAdded") }); }
    catch (error) { onNotice({ tone: "error", text: errorText(error) }); }
    finally { setBusy(false); }
  }

  async function removeSource(sourceId: string): Promise<void> {
    setBusy(true);
    try { setView(await api.removePromptLibrarySource(sourceId)); setSelectedId(null); setContent(""); onNotice({ tone: "success", text: t("surfaces.librarySourceRemoved") }); }
    catch (error) { onNotice({ tone: "error", text: errorText(error) }); }
    finally { setBusy(false); }
  }

  async function selectEntry(entry: PromptLibraryEntry): Promise<void> {
    if (!entry.available) return;
    setBusy(true);
    try {
      const text = await api.readPromptLibraryEntry(entry.id);
      setSelectedId(entry.id); setContent(text.content); setTargetName(entry.name);
    } catch (error) { onNotice({ tone: "error", text: errorText(error) }); }
    finally { setBusy(false); }
  }

  async function updateMetadata(patch: { favorite?: boolean; tags?: string[] }): Promise<void> {
    if (!selectedId) return;
    try {
      const next = await api.updatePromptLibraryMetadata(selectedId, patch);
      setView((previous) => previous ? { ...previous, metadata: { ...previous.metadata, [selectedId]: next } } : previous);
    } catch (error) { onNotice({ tone: "error", text: errorText(error) }); }
  }

  async function copySelected(): Promise<void> {
    if (!selectedId) return;
    try {
      if (!navigator.clipboard) throw new Error(t("surfaces.libraryClipboardUnavailable"));
      await navigator.clipboard.writeText(content);
      await api.notePromptLibraryUse(selectedId, "copy");
      onNotice({ tone: "success", text: t("surfaces.libraryCopied") });
    } catch (error) { onNotice({ tone: "error", text: errorText(error) }); }
  }

  async function previewAdoption(): Promise<void> {
    if (!selectedId || !targetName.trim() || readOnly) return;
    setBusy(true);
    try { setAdoption(await api.previewPromptAdoption(profileId, selectedId, targetName.trim())); }
    catch (error) { onNotice({ tone: "error", text: errorText(error) }); }
    finally { setBusy(false); }
  }

  async function commitAdoption(): Promise<void> {
    if (!adoption) return;
    setBusy(true);
    try {
      await api.commitPromptAdoption(adoption.id, adoption.overwriteRequired);
      setAdoption(null); await loadHistory(); onNotice({ tone: "success", text: t("surfaces.libraryAdopted", { name: adoption.name }) });
    } catch (error) { onNotice({ tone: "error", text: errorText(error) }); }
    finally { setBusy(false); }
  }

  async function restoreSnapshot(): Promise<void> {
    if (!restoreTarget) return;
    setBusy(true);
    try { await api.restorePromptAdoption(profileId, restoreTarget.id); setRestoreTarget(null); await loadHistory(); onNotice({ tone: "success", text: t("surfaces.libraryRestored", { name: restoreTarget.name }) }); }
    catch (error) { onNotice({ tone: "error", text: errorText(error) }); }
    finally { setBusy(false); }
  }

  return <section className="module-view module-shell prompt-library-module">
    <div className="workspace-heading module-heading">
      <div><span className="eyebrow">{profileId}</span><h1>{t("surfaces.libraryHeading")}<span className="heading-count">{view?.entries.length ?? 0}</span></h1></div>
      <div className="heading-actions">
        <button className="secondary-button" data-testid="prompt-profile-tab" onClick={onOpenProfilePrompts} disabled={!onOpenProfilePrompts}><FileSearch size={15} />{t("surfaces.profilePrompts")}</button>
        <IconButton label={t("surfaces.libraryRefresh")} onClick={() => void load()} disabled={busy}><RefreshCw size={16} className={busy ? "spin" : ""} /></IconButton>
        <button className="primary-button" data-testid="prompt-library-add-source" onClick={() => void addSource()} disabled={busy}><FolderPlus size={15} />{t("surfaces.libraryAddSource")}</button>
      </div>
    </div>
    <div className="library-toolbar">
      <label className="library-search"><Search size={15} /><span className="visually-hidden">{t("surfaces.librarySearch")}</span><input name="promptLibrarySearch" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("surfaces.librarySearchPlaceholder")} /></label>
      <span className={`library-coverage ${view?.complete === false ? "warn" : ""}`}>{view?.complete === false ? t("surfaces.libraryPartial") : t("surfaces.libraryLocalOnly")}</span>
    </div>
    <div className="library-filter-row">
      <button data-testid="prompt-library-favorites-filter" className={`secondary-button${favoriteOnly ? " active" : ""}`} aria-pressed={favoriteOnly} onClick={() => setFavoriteOnly((value) => !value)}><Star size={14} />{t("surfaces.libraryFavoritesOnly")}</button>
      <label className="library-tag-filter"><Tag size={14} /><span className="visually-hidden">{t("surfaces.libraryFilterTags")}</span><input name="promptLibraryTagFilter" value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} placeholder={t("surfaces.libraryFilterTags")} /></label>
    </div>
    <div className="library-source-strip">
      {(view?.sources ?? []).map((source) => <span className="library-source" key={source.id}><span title={source.root}>{source.label}</span><IconButton label={t("surfaces.libraryRemoveSource", { name: source.label })} variant="subtle" onClick={() => setRemoveSourceId(source.id)} disabled={busy} data-testid="prompt-library-remove-source"><Trash2 size={13} /></IconButton></span>)}
      {!view?.sources.length ? <span className="muted-line">{t("surfaces.libraryNoSource")}</span> : null}
    </div>
    <div className="module-columns library-columns">
      <div className="module-list-panel">
        {!visibleEntries.length ? <div className="module-empty compact-empty"><span className="empty-glyph"><FileSearch size={26} /></span><strong>{t("surfaces.libraryEmpty")}</strong><span className="empty-desc">{t("surfaces.libraryEmptyHint")}</span><button className="secondary-button" onClick={() => void addSource()} disabled={busy}><FolderPlus size={15} />{t("surfaces.libraryAddSource")}</button></div> : visibleEntries.map((entry) => {
          const metadata = view?.metadata[entry.id] ?? { favorite: false, tags: [] };
          return <button data-testid="prompt-library-entry" key={entry.id} className={`module-list-row ${selectedId === entry.id ? "active" : ""} ${entry.available ? "" : "unavailable"}`} onClick={() => void selectEntry(entry)} disabled={!entry.available}>
            <span className="module-row-main"><strong>{entry.name}</strong><small className="mono">{entry.relativePath}</small><small>{formatDateTime(entry.updatedAt)}</small></span>
            <span className="library-row-meta">{metadata.favorite ? <Star size={13} fill="currentColor" /> : null}{metadata.tags.length ? <span>{metadata.tags.slice(0, 2).join(" · ")}</span> : null}{!entry.available ? <span className="status-chip warn">{t("surfaces.libraryUnavailable")}</span> : null}</span>
          </button>;
        })}
      </div>
      <div className="module-editor-panel library-editor">
        {selected ? <>
          <div className="editor-head"><div><span className="eyebrow mono">{selected.relativePath}</span><strong>{selected.name}</strong></div><span className="status-chip neutral">{t("surfaces.libraryReadonlyBadge")}</span></div>
          <pre className="raw-view library-content">{content}</pre>
          <div className="library-actions"><button data-testid="prompt-library-copy" className="secondary-button" onClick={() => void copySelected()}><Clipboard size={15} />{t("surfaces.libraryCopy")}</button><button data-testid="prompt-library-favorite" className="secondary-button" onClick={() => void updateMetadata({ favorite: !selectedMetadata.favorite })}><Star size={15} fill={selectedMetadata.favorite ? "currentColor" : "none"} />{selectedMetadata.favorite ? t("surfaces.libraryUnfavorite") : t("surfaces.libraryFavorite")}</button></div>
          <label className="module-field"><span><Tag size={13} />{t("surfaces.libraryTags")}</span><input value={selectedMetadata.tags.join(", ")} onChange={(event) => setView((previous) => previous ? { ...previous, metadata: { ...previous.metadata, [selected.id]: { ...selectedMetadata, tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) } } } : previous)} onBlur={() => void updateMetadata({ tags: selectedMetadata.tags })} placeholder={t("surfaces.libraryTagsPlaceholder")} /></label>
          <div className="library-adopt-box"><div><strong>{t("surfaces.libraryAdoptTitle")}</strong><span>{t("surfaces.libraryAdoptHint")}</span></div><label className="module-field"><span>{t("surfaces.libraryTargetName")}</span><input name="promptLibraryTargetName" value={targetName} onChange={(event) => setTargetName(event.target.value)} disabled={readOnly} /></label><button data-testid="prompt-library-adopt" className="primary-button" onClick={() => void previewAdoption()} disabled={busy || readOnly || !targetName.trim()}><ExternalLink size={15} />{t("surfaces.libraryAdopt")}</button></div>
        </> : <div className="module-empty compact-empty"><span className="empty-glyph"><FileSearch size={26} /></span><strong>{t("surfaces.librarySelect")}</strong><span className="empty-desc">{t("surfaces.librarySelectHint")}</span></div>}
      </div>
    </div>
    <div className="library-history"><div className="library-history-heading"><span><History size={14} />{t("surfaces.libraryHistory")}</span><small>{t("surfaces.libraryReadonlyHint")}</small></div>{history.map((snapshot) => <div className="library-history-row" key={snapshot.id}><span><strong>{snapshot.name}</strong><small>{formatDateTime(snapshot.createdAt)} · {snapshot.status}</small></span>{snapshot.status === "committed" ? <button className="secondary-button" onClick={() => setRestoreTarget(snapshot)}><RotateCcw size={14} />{t("surfaces.libraryRestore")}</button> : <span className="status-chip neutral"><Check size={13} />{t("surfaces.libraryRestoredBadge")}</span>}</div>)}</div>
    <ConfirmDialog open={Boolean(removeSourceId)} title={t("surfaces.libraryRemoveConfirmTitle")} message={t("surfaces.libraryRemoveConfirmMessage")} confirmLabel={t("surfaces.libraryRemoveConfirmAction")} danger busy={busy} onClose={() => setRemoveSourceId(null)} onConfirm={() => { const id = removeSourceId; setRemoveSourceId(null); if (id) void removeSource(id); }} />
    <ConfirmDialog open={Boolean(adoption)} title={t("surfaces.libraryConfirmTitle")} message={adoption ? t("surfaces.libraryConfirmMessage", { name: adoption.name, target: adoption.targetPath, overwrite: adoption.overwriteRequired ? t("surfaces.libraryOverwriteWarning") : "" }) : ""} confirmLabel={t("surfaces.libraryConfirmAction")} busy={busy} onClose={() => setAdoption(null)} onConfirm={() => void commitAdoption()} />
    <ConfirmDialog open={Boolean(restoreTarget)} title={t("surfaces.libraryRestoreTitle")} message={restoreTarget ? t("surfaces.libraryRestoreMessage", { name: restoreTarget.name }) : ""} confirmLabel={t("surfaces.libraryRestore")} busy={busy} onClose={() => setRestoreTarget(null)} onConfirm={() => void restoreSnapshot()} />
  </section>;
}
