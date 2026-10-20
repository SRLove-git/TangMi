import { useCallback, useEffect, useState } from "react";
import { FileText, Play, Radar } from "lucide-react";
import { api } from "../../api";
import type { Project, ScanRecord } from "../../types";
import { EmptyState, PageHeader, ScopeSwitch, formatDateTime } from "./shared";

interface Props {
  activeProject: Project | null;
  onOpenRun: (runId: string, lab: string) => void;
  onGoChat: () => void;
}

const LAB_LABELS: Record<string, string> = {
  web: "通用扫描",
  dvwa: "DVWA",
  "sqli-labs": "SQLi-Labs",
  generic: "通用扫描",
};

export default function ScansView({ activeProject, onOpenRun, onGoChat }: Props) {
  const [scope, setScope] = useState<"all" | "project">("all");
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const projectId = scope === "project" ? activeProject?.id : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.scans(projectId);
      setScans(data.scans);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="platform-view">
      <PageHeader
        eyebrow="Scan History"
        title="扫描记录"
        subtitle="所有扫描任务的执行历史，可回看发现结果与报告。"
        actions={
          <>
            <ScopeSwitch
              value={scope}
              onChange={setScope}
              projectId={activeProject?.id ?? null}
              projectName={activeProject?.name}
            />
            <button className="btn primary" onClick={onGoChat}>
              <Play size={14} />
              新建扫描
            </button>
          </>
        }
      />

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <p className="muted">加载中…</p>
      ) : scans.length === 0 ? (
        <EmptyState
          icon={<Radar size={24} />}
          title="还没有扫描记录"
          description="在对话工作台发送「扫描一下」或「全量扫描」，执行记录会自动归档到这里。"
          action={
            <button className="btn primary" onClick={onGoChat}>
              去工作台
            </button>
          }
        />
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>目标</th>
                  <th>类型</th>
                  <th>模式</th>
                  <th>状态</th>
                  <th>风险分布</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <tr key={scan.run_id}>
                    <td className="mono small">{formatDateTime(scan.finished_at || scan.created_at)}</td>
                    <td>
                      <div className="cell-primary mono ellipsis">{scan.target}</div>
                      <div className="cell-sub mono">{scan.run_id}</div>
                    </td>
                    <td>{LAB_LABELS[scan.lab] ?? scan.lab}</td>
                    <td>{scan.profile || "-"}</td>
                    <td>
                      <span className={`run-status ${scan.status}`}>{scan.status}</span>
                    </td>
                    <td>
                      <div className="mini-sev-row">
                        <span className="mini-sev sev-critical">C {scan.critical}</span>
                        <span className="mini-sev sev-high">H {scan.high}</span>
                        <span className="mini-sev sev-medium">M {scan.medium}</span>
                        <span className="mini-sev sev-low">L {scan.low}</span>
                        <span className="mini-sev sev-info">I {scan.info}</span>
                      </div>
                    </td>
                    <td>
                      <button className="btn tiny" onClick={() => onOpenRun(scan.run_id, scan.lab)}>
                        <FileText size={13} />
                        结果
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
