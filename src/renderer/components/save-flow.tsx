import type { ReactElement } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CircleAlert, FileDiff, Keyboard, RefreshCw } from "lucide-react";

/** LCS line diff. Config files are small, so the O(n·m) table is fine and always correct. */
export interface DiffLine { kind: "add" | "del" | "ctx" | "gap"; text: string }

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: "ctx", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "del", text: a[i] }); i++; }
    else { out.push({ kind: "add", text: b[j] }); j++; }
  }
  while (i < a.length) { out.push({ kind: "del", text: a[i] }); i++; }
  while (j < b.length) { out.push({ kind: "add", text: b[j] }); j++; }
  return out;
}

/** Collapses runs of unchanged lines to ±radius around edits, so a whole file never scrolls by. */
export function trimContext(lines: DiffLine[], radius = 3): DiffLine[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === "ctx") return;
    for (let k = Math.max(0, index - radius); k <= Math.min(lines.length - 1, index + radius); k++) keep[k] = true;
  });
  const out: DiffLine[] = [];
  let gapping = false;
  lines.forEach((line, index) => {
    if (keep[index]) { out.push(line); gapping = false; }
    else if (!gapping) { out.push({ kind: "gap", text: "…" }); gapping = true; }
  });
  return out;
}

function DiffBlock({ before, after, label }: { before: string; after: string; label: string }): ReactElement | null {
  const diff = diffLines(before, after);
  const changes = diff.filter((line) => line.kind === "add" || line.kind === "del").length;
  if (changes === 0) return null;
  return <div className="dl-section">
    <div className="dl-section-title"><span className="mono">{label}</span><span className="dl-count">{changes} 行变更</span></div>
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
  const changes = pending
    ? [pending.beforeModels, pending.afterModels, pending.beforeSettings, pending.afterSettings]
    : [];
  const totalChanges = pending ? (diffLines(changes[0], changes[1]).filter((l) => l.kind !== "ctx").length + diffLines(changes[2], changes[3]).filter((l) => l.kind !== "ctx").length) : 0;
  return <DialogPrimitive.Root open={Boolean(pending)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dl-overlay" />
      <DialogPrimitive.Content className="dl-content">
        <div className="dl-head">
          <div><span className="eyebrow">REVIEW</span><h2>{pending?.title ?? ""}</h2></div>
          <span className="dl-count-total">{totalChanges} 行变更 · 写入前自动创建快照</span>
        </div>
        <div className="dl-body">
          {pending ? <>
            <DiffBlock label="models.yml" before={pending.beforeModels} after={pending.afterModels} />
            <DiffBlock label="config.yml" before={pending.beforeSettings} after={pending.afterSettings} />
            {totalChanges === 0 ? <span className="muted-line">两个文件均无实际变更。</span> : null}
          </> : null}
        </div>
        <div className="dl-actions">
          <DialogPrimitive.Close asChild><button className="secondary-button">取消</button></DialogPrimitive.Close>
          <button className="primary-button" onClick={onConfirm} disabled={busy || totalChanges === 0}><FileDiff size={15} />确认写入</button>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

/** The hash guard fired: someone edited the files after we loaded them. Offer a clean reload. */
export function ConflictDialog({ detail, busy, onClose, onReload }: { detail: string | null; busy: boolean; onClose: () => void; onReload: () => void }): ReactElement {
  return <DialogPrimitive.Root open={Boolean(detail)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dl-overlay" />
      <DialogPrimitive.Content className="dl-content dl-narrow">
        <div className="dl-head">
          <div><span className="eyebrow">CONFLICT</span><h2>文件已被外部修改</h2></div>
        </div>
        <div className="dl-body">
          <div className="inline-status warning"><CircleAlert size={15} /><span>{detail}</span></div>
          <span className="muted-line">配置文件在读取之后被其他工具或手工编辑过。为避免覆盖外部改动，写入被拒绝。重新加载会放弃当前未保存的编辑；文件本身的改动会保留。</span>
        </div>
        <div className="dl-actions">
          <DialogPrimitive.Close asChild><button className="secondary-button">取消</button></DialogPrimitive.Close>
          <button className="primary-button" onClick={onReload} disabled={busy}><RefreshCw size={15} />重新加载</button>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

/** Replaces window.confirm with an in-app sheet — native confirms clash with the theme. */
export function ConfirmDialog({ open, title, message, confirmLabel, danger, busy, onClose, onConfirm }: {
  open: boolean; title: string; message: string; confirmLabel: string; danger?: boolean; busy?: boolean; onClose: () => void; onConfirm: () => void;
}): ReactElement {
  return <DialogPrimitive.Root open={open} onOpenChange={(openNext) => { if (!openNext) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dl-overlay" />
      <DialogPrimitive.Content className="dl-content dl-narrow">
        <div className="dl-head"><div><span className="eyebrow">CONFIRM</span><h2>{title}</h2></div></div>
        <div className="dl-body"><span className="muted-line">{message}</span></div>
        <div className="dl-actions">
          <DialogPrimitive.Close asChild><button className="secondary-button">取消</button></DialogPrimitive.Close>
          <button className={danger ? "primary-button danger" : "primary-button"} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const rows: Array<[string, string]> = [
    ["Ctrl + K", "命令面板"],
    ["Ctrl + S", "保存全部未保存改动"],
    ["Ctrl + 1 … 7", "切换页面（模型 / 角色 / 提示 / 技能 / 会话 / 用量 / 网关）"],
    ["?", "本快捷键说明"],
    ["↑ ↓ / Enter / Esc", "选择器与菜单内导航"],
  ];
  return <DialogPrimitive.Root open={open} onOpenChange={(openNext) => { if (!openNext) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dl-overlay" />
      <DialogPrimitive.Content className="dl-content dl-narrow">
        <div className="dl-head"><div><span className="eyebrow"><Keyboard size={12} /> SHORTCUTS</span><h2>快捷键</h2></div></div>
        <div className="dl-body">
          {rows.map(([keys, label]) => <div className="shortcut-row" key={keys}><span className="mono">{keys}</span><span>{label}</span></div>)}
        </div>
        <div className="dl-actions"><DialogPrimitive.Close asChild><button className="primary-button">关闭</button></DialogPrimitive.Close></div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
