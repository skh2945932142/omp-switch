import type { ReactElement } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CircleAlert, FileDiff, Keyboard, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { diffLines, trimContext } from "@omp-switch/shared";

function DiffBlock({ before, after, label }: { before: string; after: string; label: string }): ReactElement | null {
  const { t } = useTranslation();
  const diff = diffLines(before, after);
  const changes = diff.filter((line) => line.kind === "add" || line.kind === "del").length;
  if (changes === 0) return null;
  return <div className="dl-section">
    <div className="dl-section-title"><span className="mono">{label}</span><span className="dl-count">{t("save.linesChanged", { count: changes })}</span></div>
    <div className="diff-view">
      {trimContext(diff).map((line, index) => <div key={index} className={`diff-line ${line.kind}`}>
        <span className="diff-marker">{line.kind === "add" ? "+" : line.kind === "del" ? "-" : ""}</span>
        <span className="diff-text">{line.text || " "}</span>
      </div>)}
    </div>
  </div>;
}

export interface PendingSave {
  title: string;
  beforeModels: string;
  beforeSettings: string;
  afterModels: string;
  afterSettings: string;
  commit: () => Promise<void>;
}

/** The two-step save: show exactly what will be written, then commit on confirmation. */
export function SavePreviewDialog({ pending, busy, onClose, onConfirm }: { pending: PendingSave | null; busy: boolean; onClose: () => void; onConfirm: () => void }): ReactElement {
  const { t } = useTranslation();
  const changes = pending
    ? [pending.beforeModels, pending.afterModels, pending.beforeSettings, pending.afterSettings]
    : [];
  const totalChanges = pending ? (diffLines(changes[0], changes[1]).filter((l) => l.kind !== "ctx").length + diffLines(changes[2], changes[3]).filter((l) => l.kind !== "ctx").length) : 0;
  return <DialogPrimitive.Root open={Boolean(pending)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dl-overlay" />
      <DialogPrimitive.Content className="dl-content">
        <div className="dl-head">
          <div><span className="eyebrow">{t("save.review")}</span><DialogPrimitive.Title asChild><h2>{pending?.title ?? ""}</h2></DialogPrimitive.Title></div>
          <DialogPrimitive.Description className="dl-count-total">{t("save.linesChanged", { count: totalChanges })} · {t("save.autoSnapshot")}</DialogPrimitive.Description>
        </div>
        <div className="dl-body">
          {pending ? <>
            <DiffBlock label="models.yml" before={pending.beforeModels} after={pending.afterModels} />
            <DiffBlock label="config.yml" before={pending.beforeSettings} after={pending.afterSettings} />
            {totalChanges === 0 ? <span className="muted-line">{t("save.noChanges")}</span> : null}
          </> : null}
        </div>
        <div className="dl-actions">
          <DialogPrimitive.Close asChild><button className="secondary-button">{t("common.cancel")}</button></DialogPrimitive.Close>
          <button className="primary-button" onClick={onConfirm} disabled={busy || totalChanges === 0}><FileDiff size={15} />{t("save.confirmWrite")}</button>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

/** The hash guard fired: someone edited the files after we loaded them. Offer a clean reload. */
export function ConflictDialog({ detail, busy, onClose, onReload }: { detail: string | null; busy: boolean; onClose: () => void; onReload: () => void }): ReactElement {
  const { t } = useTranslation();
  return <DialogPrimitive.Root open={Boolean(detail)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dl-overlay" />
      <DialogPrimitive.Content className="dl-content dl-narrow">
        <div className="dl-head">
          <div><span className="eyebrow">{t("save.conflict")}</span><DialogPrimitive.Title asChild><h2>{t("save.conflictTitle")}</h2></DialogPrimitive.Title></div>
        </div>
        <div className="dl-body">
          <div className="inline-status warning"><CircleAlert size={15} /><span>{detail}</span></div>
          <DialogPrimitive.Description className="muted-line">{t("save.conflictBody")}</DialogPrimitive.Description>
        </div>
        <div className="dl-actions">
          <DialogPrimitive.Close asChild><button className="secondary-button">{t("common.cancel")}</button></DialogPrimitive.Close>
          <button className="primary-button" onClick={onReload} disabled={busy}><RefreshCw size={15} />{t("save.reload")}</button>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

/** Replaces window.confirm with an in-app sheet — native confirms clash with the theme. */
export function ConfirmDialog({ open, title, message, confirmLabel, danger, busy, onClose, onConfirm }: {
  open: boolean; title: string; message: string; confirmLabel: string; danger?: boolean; busy?: boolean; onClose: () => void; onConfirm: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return <DialogPrimitive.Root open={open} onOpenChange={(openNext) => { if (!openNext) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dl-overlay" />
      <DialogPrimitive.Content className="dl-content dl-narrow">
        <div className="dl-head"><div><span className="eyebrow">{t("save.confirm")}</span><DialogPrimitive.Title asChild><h2>{title}</h2></DialogPrimitive.Title></div></div>
        <div className="dl-body"><DialogPrimitive.Description className="muted-line">{message}</DialogPrimitive.Description></div>
        <div className="dl-actions">
          <DialogPrimitive.Close asChild><button className="secondary-button">{t("common.cancel")}</button></DialogPrimitive.Close>
          <button className={danger ? "primary-button danger" : "primary-button"} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const { t } = useTranslation();
  const rows: Array<[string, string]> = [
    ["Ctrl + K", t("save.cmdPalette")],
    ["Ctrl + S", t("save.saveAll")],
    ["Ctrl + 1 … 7", t("save.switchPage")],
    ["?", t("save.shortcutHelp")],
    ["↑ ↓ / Enter / Esc", t("save.menuNav")],
  ];
  return <DialogPrimitive.Root open={open} onOpenChange={(openNext) => { if (!openNext) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dl-overlay" />
      <DialogPrimitive.Content className="dl-content dl-narrow">
        <div className="dl-head"><div><span className="eyebrow"><Keyboard size={12} /> {t("save.shortcuts")}</span><DialogPrimitive.Title asChild><h2>{t("save.shortcutsTitle")}</h2></DialogPrimitive.Title></div></div>
        <DialogPrimitive.Description className="visually-hidden">{t("save.menuNav")}</DialogPrimitive.Description>
        <div className="dl-body">
          {rows.map(([keys, label]) => <div className="shortcut-row" key={keys}><span className="mono">{keys}</span><span>{label}</span></div>)}
        </div>
        <div className="dl-actions"><DialogPrimitive.Close asChild><button className="primary-button">{t("common.close")}</button></DialogPrimitive.Close></div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
