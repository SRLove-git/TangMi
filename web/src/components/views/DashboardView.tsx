import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Network,
  Radar,
  ShieldAlert,
} from "lucide-react";
import { api } from "../../api";
import type { DashboardData, Project } from "../../types";
import {
  EmptyState,
  PageHeader,
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  ScopeSwitch,
  formatDateTime,
  severityClass,
  VULN_STATUS,
} from "./shared";

interface Props {
  activeProject: Project | null;
  onOpenRun: (runId: string, lab: string) => void;
  onGoChat: () => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "var(--sev-critical)",
  High: "var(--sev-high)",
  Medium: "var(--sev-medium)",
  Low: "var(--sev-low)",
  Info: "var(--sev-info)",
};

export default function DashboardView({ activeProject, onOpenRun, onGoChat }: Props) {
  const [scope, setScope] = useState<"all" | "project">("all");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const projectId = scope === "project" ? activeProject?.id : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.dashboard(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const severity = data?.severity ?? {};
  const total = data?.vuln_total ?? 0;
  const maxCategory = Math.max(1, ...(data?.categories ?? []).map((item) => item.count));

  return (
    <section className="platform-view">
      <PageHeader
        eyebrow="Security Overview"
        title="安全态势"
        subtitle="汇总资产、漏洞与扫描活动，掌握当前攻击面与风险分布。"
        actions={
          <>
            <ScopeSwitch
              value={scope}
              onChange={setScope}
              projectId={activeProject?.id ?? null}
              projectName={activeProject?.name}
            />
            <button className="btn primary" onClick={onGoChat}>
              发起扫描
              <ArrowRight size={15} />
            </button>
          </>
        }
      />

      {error && <div className="alert error">{error}</div>}

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-icon"><ShieldAlert size={16} /></span>
          <span className="stat-label">风险总数</span>
          <b>{loading ? "—" : total}</b>
          <span className="stat-hint">已收录的漏洞条目</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon warning"><AlertTriangle size={16} /></span>
          <span className="stat-label">待处理</span>
          <b>{loading ? "—" : data?.open_total ?? 0}</b>
          <span className="stat-hint">待确认 + 已确认</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon info"><Network size={16} /></span>
          <span className="stat-label">资产数</span>
          <b>{loading ? "—" : data?.assets ?? 0}</b>
          <span className="stat-hint">主机 / 端口 / 服务 / 接口</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon success"><Radar size={16} /></span>
          <span className="stat-label">扫描次数</span>
          <b>{loading ? "—" : data?.scans ?? 0}</b>
          <span className="stat-hint">累计发现 {data?.findings_total ?? 0} 次</span>
        </div>
      </div>

      {!loading && total === 0 && (
        <EmptyState
          icon={<ShieldAlert size={24} />}
          title="还没有漏洞数据"
          description="运行一次全量扫描后，风险会按严重程度、OWASP 分类自动汇总到这里。"
          action={
            <button className="btn primary" onClick={onGoChat}>
              去工作台发起扫描
            </button>
          }
        />
      )}

      {total > 0 && (
        <>
          <div className="card">
            <div className="card-head">
              <h4>风险分布</h4>
              <span className="muted small">共 {total} 条</span>
            </div>
            <div className="severity-bar">
              {SEVERITY_ORDER.filter((item) => (severity[item] ?? 0) > 0).map((item) => (
                <span
                  key={item}
                  style={{
                    width: `${((severity[item] ?? 0) / total) * 100}%`,
                    background: SEVERITY_COLORS[item],
                  }}
                  title={`${SEVERITY_LABELS[item]} ${severity[item]}`}
                />
              ))}
            </div>
            <div className="severity-grid">
              {SEVERITY_ORDER.map((item) => (
                <div className={`severity-cell ${severityClass(item)}`} key={item}>
                  <span>{SEVERITY_LABELS[item]}</span>
                  <b>{severity[item] ?? 0}</b>
                </div>
              ))}
            </div>
            <div className="status-row">
              {Object.entries(VULN_STATUS).map(([key, label]) => (
                <span className="status-count" key={key}>
                  {label}
                  <b>{data?.status?.[key] ?? 0}</b>
                </span>
              ))}
            </div>
          </div>

          <div className="two-col">
            <div className="card">
              <div className="card-head">
                <h4>漏洞分类 TOP 8</h4>
              </div>
              <div className="bar-list">
                {(data?.categories ?? []).map((item) => (
                  <div className="bar-row" key={item.category}>
                    <span className="bar-label compact">{item.category}</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ width: `${(item.count / maxCategory) * 100}%` }}
                      />
                    </div>
                    <b>{item.count}</b>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="card-head">
                <h4>OWASP Top 10 分布</h4>
              </div>
              <div className="bar-list">
                {(data?.owasp ?? []).map((item) => (
                  <div className="bar-row" key={item.owasp}>
                    <span className="bar-label">{item.owasp}</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill subtle"
                        style={{
                          width: `${(item.count / Math.max(1, ...(data?.owasp ?? []).map((x) => x.count))) * 100}%`,
                        }}
                      />
                    </div>
                    <b>{item.count}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="card">
        <div className="card-head">
          <h4>最近扫描</h4>
          <button className="btn tiny" onClick={() => void load()}>
            刷新
          </button>
        </div>
        {(data?.recent_scans ?? []).length === 0 ? (
          <p className="muted small">暂无扫描记录。</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>目标</th>
                  <th>模式</th>
                  <th>状态</th>
                  <th>风险</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(data?.recent_scans ?? []).map((scan) => (
                  <tr key={scan.run_id}>
                    <td className="mono small">{formatDateTime(scan.finished_at || scan.created_at)}</td>
                    <td className="mono ellipsis">{scan.target}</td>
                    <td>{scan.profile || scan.lab}</td>
                    <td>
                      <span className={`run-status ${scan.status}`}>{scan.status}</span>
                    </td>
                    <td>
                      <span className="muted small">
                        {scan.findings_count} 条
                        {scan.critical > 0 && <b className="sev-critical-text"> · C{scan.critical}</b>}
                        {scan.high > 0 && <b className="sev-high-text"> · H{scan.high}</b>}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn tiny ghost"
                        onClick={() => onOpenRun(scan.run_id, scan.lab)}
                      >
                        查看
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
