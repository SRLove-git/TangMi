import { ChevronRight } from "lucide-react";
import type { RunLive } from "../../types";
import { statusMeta } from "../../utils";

interface Props {
  run: RunLive;
  onOpenMatrix: () => void;
}

const RUN_LABELS: Record<string, string> = {
  running: "运行中",
  pending: "准备中",
  cancelling: "取消中",
  completed: "已完成",
  partial: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};

export default function RunCard({ run, onOpenMatrix }: Props) {
  const running = ["running", "pending", "cancelling"].includes(run.status);
  const percent = Math.min(100, run.progress?.percent ?? 0);
  const latest = run.latest_finding;
  const meta = latest ? statusMeta(latest.status) : null;
  const logs = (run.logs ?? []).slice(-8);

  return (
    <div className={`run-card ${running ? "live" : ""}`}>
      <div className="run-card-head">
        <div>
          <div className="run-card-eyebrow">
            {running ? "TASK · RUNNING" : `TASK · ${RUN_LABELS[run.status] ?? run.status}`}
          </div>
          <div className="run-card-title">{run.label ?? "任务"}</div>
        </div>
        <span className={`run-status ${run.status}`}>{RUN_LABELS[run.status] ?? run.status}</span>
      </div>

      <div className="run-progress-track">
        <div
          className={`run-progress-fill ${run.status}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="run-card-meta">
        <span>
          {run.progress?.done ?? 0} / {run.progress?.total || "?"} 个目标
        </span>
        <span>
          已发现 <b>{run.findings_count ?? 0}</b> 条 · {percent}%
        </span>
      </div>

      {latest && meta && (
        <div className={`run-latest ${meta.className}`}>
          <span>{meta.icon}</span>
          <span className="mono">
            {latest.target}
            {latest.level ? ` / ${latest.level}` : ""}
          </span>
          <span className="ellipsis">{latest.title}</span>
          <span className="muted small">{meta.label}</span>
        </div>
      )}

      {logs.length > 0 && (
        <details className="run-logs">
          <summary>执行日志（最近 {logs.length} 行）</summary>
          <div className="run-log-body">
            {logs.map((entry, index) => (
              <div key={index} className={`log-line ${entry.level}`}>
                <span className="log-mark">›</span>
                {entry.message}
              </div>
            ))}
          </div>
        </details>
      )}

      {!running && (
        <div className="run-card-actions">
          <button className="btn tiny" onClick={onOpenMatrix}>
            查看结果
            <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
