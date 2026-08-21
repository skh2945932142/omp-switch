import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { ArchiveRestore, History, LoaderCircle } from "lucide-react";
import type { EffectiveConfig, Snapshot } from "@omp-switch/core";

type AppApi = NonNullable<Window["ompSwitch"]>;

/**
 * Snapshot history: every commit creates one, retention is 30 per profile. Restoring runs the
 * same guarded path as always — an external edit since the snapshot still refuses to be trampled.
 */
export function SnapshotTimeline({ api, profileId, busy, onRestored, onNotice }: {
  api: AppApi;
  profileId: string;
  busy: boolean;
  onRestored: (config: EffectiveConfig, snapshot: Snapshot) => void;
  onNotice: (notice: { tone: "success" | "error" | "info"; text: string }) => void;
}): ReactElement {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshots(await api.listSnapshots(profileId));
    } catch {
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, [api, profileId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function restore(snapshot: Snapshot): Promise<void> {
    setLoading(true);
    try {
      const config = await api.restore(snapshot);
      onRestored(config, snapshot);
      onNotice({ tone: "success", text: `已恢复快照 ${formatDate(snapshot.createdAt)}` });
    } catch (error) {
      onNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  return <div className="snapshot-timeline">
    <div className="drawer-actions">
      <button className="secondary-button" onClick={() => void refresh()} disabled={loading}><History size={14} />刷新</button>
    </div>
    {loading && snapshots === null ? <span className="muted-line">读取快照…</span>
      : !snapshots?.length ? <span className="muted-line">暂无快照。每次写入前会自动创建，最多保留 30 个。</span>
      : <div className="snapshot-list">
        {snapshots.map((snapshot, index) => {
          const isLatest = index === 0;
          return <div className={`snapshot-item${index === snapshots.length - 1 ? " last" : ""}${isLatest ? " latest" : ""}`} key={snapshot.id}>
            <span className="snapshot-rail"><span className="snapshot-node" /></span>
            <span className="snapshot-main">
              <strong>{formatDate(snapshot.createdAt)}</strong>
              <small className="mono">{snapshot.id.slice(0, 24)}</small>
              {isLatest ? <small className="snapshot-tag">最近</small> : null}
            </span>
            <button className="snapshot-restore" onClick={() => void restore(snapshot)} disabled={busy || loading} title="恢复此快照"><ArchiveRestore size={14} /><span>恢复</span></button>
          </div>;
        })}
      </div>}
  </div>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
