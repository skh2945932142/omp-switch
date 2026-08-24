import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Check, CircleAlert, Download, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

type AppApi = NonNullable<Window["ompSwitch"]>;
type Notice = { tone: "success" | "error" | "info"; text: string };

export function ProjectOverlayBadge({ api, profileId, onNotice }: { api: AppApi; profileId: string; onNotice: (notice: Notice) => void }): ReactElement {
  const { t } = useTranslation();
  const [context, setContext] = useState<Awaited<ReturnType<AppApi["projectOverlay"]>> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.projectOverlay(profileId).then(setContext).catch(() => setContext(null)); }, [api, profileId]);

  async function chooseRoot(): Promise<void> {
    setBusy(true);
    try {
      setContext(await api.chooseProjectRoot(profileId));
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function copyPatch(): Promise<void> {
    const overlay = context?.overlay;
    if (!overlay) return;
    const text = `${overlay.models.raw || "providers: {}\n"}\n${overlay.settings.raw || "{}\n"}`;
    try {
      await navigator.clipboard.writeText(text);
      onNotice({ tone: "success", text: t("project.patchCopied") });
    } catch {
      onNotice({ tone: "error", text: t("project.copyFailed") });
    }
  }

  if (!context) return <span className="muted-line">{t("project.reading")}</span>;
  const { overlay, precedence } = context;
  return (
    <div className="project-overlay">
      <div className="project-overlay-head">
        {overlay ? <span className="status-chip neutral">{t("project.hasOverlay")}</span> : <span className="status-chip neutral">{t("project.noOverlay")}</span>}
        {!context.explicit ? <span className="status-chip warn" title={t("project.inferredTitle")}>{t("project.inferredDir")}</span> : null}
        <button className="secondary-button" onClick={() => void chooseRoot()} disabled={busy}>
          <FolderOpen size={14} />{t("project.chooseDir")}
        </button>
      </div>
      <span className="muted-line mono break">{context.root}</span>
      {overlay ? (
        <div className="project-overlay-actions">
          <button className="secondary-button" onClick={() => void copyPatch()}>
            <Download size={14} />{t("project.copyPatch")}
          </button>
          {overlay.diagnostics.length ? (
            <span className="status-chip danger"><CircleAlert size={13} />{overlay.diagnostics.length}</span>
          ) : (
            <span className="status-chip ok"><Check size={13} />{t("project.normal")}</span>
          )}
        </div>
      ) : null}
      {precedence.map((item, index) => (
        <span key={`${item.code}-${index}`} className={`muted-line ${item.severity === "warning" ? "warn-line" : ""}`}>
          {item.message}
        </span>
      ))}
    </div>
  );
}
