import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, LockKeyhole } from "lucide-react";
import type { Diagnostic } from "@omp-switch/core";

export interface DiagnosticsDrawerProps {
  diagnostics: Diagnostic[];
  onMigratePlaintext?: (providerId?: string) => void;
  busy?: boolean;
}

export function DiagnosticsDrawer({ diagnostics, onMigratePlaintext, busy }: DiagnosticsDrawerProps): ReactElement {
  const { t } = useTranslation();
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const infos = diagnostics.filter((d) => d.severity === "info");

  const plaintextWarnings = warnings.filter((d) => d.code === "provider.apiKey-plaintext");

  const groups: Array<{ key: "error" | "warning" | "info"; label: string; items: Diagnostic[] }> = [
    { key: "error", label: t("diagnostics.error"), items: errors },
    { key: "warning", label: t("diagnostics.warning"), items: warnings },
    { key: "info", label: t("diagnostics.info"), items: infos },
  ].filter((g) => g.items.length > 0) as Array<{ key: "error" | "warning" | "info"; label: string; items: Diagnostic[] }>;

  return (
    <div className="drawer-body">
      <div className="diag-summary">
        <div className="diag-summary-status">
          <span className={`status-led ${errors.length ? "danger" : warnings.length ? "warn" : "ok"}`} />
          <strong>
            {errors.length
              ? t("diagnostics.hasProblems")
              : warnings.length
                ? t("diagnostics.hasWarnings")
                : t("diagnostics.configOk")}
          </strong>
        </div>
        <div className="diag-summary-counts">
          <span className={`diag-count ${errors.length ? "danger" : ""}`}>
            <strong>{errors.length}</strong>
            {t("diagnostics.countError")}
          </span>
          <span className={`diag-count ${warnings.length ? "warn" : ""}`}>
            <strong>{warnings.length}</strong>
            {t("diagnostics.countWarning")}
          </span>
          <span className="diag-count">
            <strong>{infos.length}</strong>
            {t("diagnostics.countInfo")}
          </span>
        </div>
      </div>
      {plaintextWarnings.length > 0 && onMigratePlaintext ? (
        <div className="diag-migrate-banner">
          <div className="diag-migrate-info">
            <LockKeyhole size={16} />
            <span>{t("diagnostics.plaintextBanner", { count: plaintextWarnings.length })}</span>
          </div>
          <button
            type="button"
            className="primary-button compact"
            disabled={busy}
            onClick={() => onMigratePlaintext()}
          >
            {t("diagnostics.migrateAllPlaintext")}
          </button>
        </div>
      ) : null}
      {diagnostics.length === 0 ? (
        <span className="muted-line diag-empty">{t("diagnostics.empty")}</span>
      ) : (
        groups.map((group) => (
          <div className="diag-group" key={group.key}>
            <div className="diag-group-title">
              {group.label}
              <span className="status-chip neutral">{group.items.length}</span>
            </div>
            {group.items.map((item, index) => {
              const isPlaintextKey = item.code === "provider.apiKey-plaintext";
              const match = item.path?.match(/^providers\.([^.]+)\.apiKey$/);
              const providerId = match ? match[1] : undefined;
              return (
                <div className="diagnostic-row" key={`${item.code}-${index}`}>
                  <span className={`diag-icon ${item.severity}`}>
                    <CircleAlert size={14} />
                  </span>
                  <span className="diag-content">
                    <strong>{item.code}</strong>
                    <small>{item.message}</small>
                  </span>
                  {isPlaintextKey && onMigratePlaintext && providerId ? (
                    <button
                      type="button"
                      className="secondary-button compact"
                      disabled={busy}
                      onClick={() => onMigratePlaintext(providerId)}
                    >
                      {t("models.migrateToVault")}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
