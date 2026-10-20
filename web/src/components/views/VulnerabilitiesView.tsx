import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Search, ShieldAlert } from "lucide-react";
import { api } from "../../api";
import type { Project, VulnerabilityItem } from "../../types";
import {
  EmptyState,
  PageHeader,
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  ScopeSwitch,
  VULN_STATUS,
  formatDateTime,
  severityClass,
} from "./shared";

interface Props {
  activeProject: Project | null;
}

const STATUS_ACTIONS: Array<{ value: string; label: string; className?: string }> = [
  { value: "confirmed", label: "确认", className: "primary" },
  { value: "fixed", label: "标记修复" },
  { value: "false_positive", label: "误报" },
  { value: "risk_accepted", label: "接受风险" },
];

export default function VulnerabilitiesView({ activeProject }: Props) {
  const [scope, setScope] = useState<"all" | "project">("all");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<VulnerabilityItem[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const projectId = scope === "project" ? activeProject?.id : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.vulnerabilities({ projectId, status, severity, search });
      setItems(data.vulnerabilities);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, status, severity, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const item of items) result[item.severity] = (result[item.severity] ?? 0) + 1;
    return result;
  }, [items]);

  async function updateStatus(item: VulnerabilityItem, next: string) {
    try {
      const data = await api.updateVulnerability(item.id, {
        status: next,
        note: note || item.note,
      });
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? data.vulnerability : entry)),
      );
      setExpanded(null);
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="platform-view">
      <PageHeader
        eyebrow="Vulnerability Management"
        title="漏洞管理"
        subtitle="按严重程度与处理状态跟踪漏洞：确认、误报、修复与风险接受都会持久化。"
        actions={
          <ScopeSwitch
            value={scope}
            onChange={setScope}
            projectId={activeProject?.id ?? null}
            projectName={activeProject?.name}
          />
        }
      />

      {error && <div className="alert error">{error}</div>}

      <div className="filter-row">
        <select className="select compact" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">全部等级</option>
          {SEVERITY_ORDER.map((item) => (
            <option key={item} value={item}>
              {SEVERITY_LABELS[item]}
            </option>
          ))}
        </select>
        <select className="select compact" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(VULN_STATUS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <div className="filter-search">
          <Search size={14} />
          <input
            className="text-input"
            placeholder="搜索标题 / 目标 / 分类…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <span className="muted small">
          共 {items.length} 条
          {SEVERITY_ORDER.filter((item) => counts[item]).map((item) => (
            <span key={item} className={`inline-sev ${severityClass(item)}`}>
              {SEVERITY_LABELS[item]} {counts[item]}
            </span>
          ))}
        </span>
      </div>

      {loading ? (
        <p className="muted">加载中…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert size={24} />}
          title="没有匹配的漏洞"
          description="调整筛选条件，或到工作台发起一次扫描来填充漏洞库。"
        />
      ) : (
        <div className="vuln-list">
          {items.map((item) => {
            const isOpen = expanded === item.id;
            return (
              <div className={`vuln-item ${isOpen ? "expanded" : ""}`} key={item.id}>
                <button
                  className="vuln-head"
                  onClick={() => {
                    setExpanded(isOpen ? null : item.id);
                    setNote(item.note ?? "");
                  }}
                >
                  {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  <span className={`severity-dot ${severityClass(item.severity)}`} />
                  <span className="vuln-title">{item.title}</span>
                  <span className="vuln-tags">
                    {item.category && <span className="tag">{item.category}</span>}
                    {item.cwe && <span className="tag mono">{item.cwe}</span>}
                    {item.owasp && <span className="tag">{item.owasp}</span>}
                  </span>
                  <span className={`vuln-status st-${item.status}`}>
                    {item.status_label || VULN_STATUS[item.status]}
                  </span>
                  <span className={`severity-badge ${severityClass(item.severity)}`}>
                    {SEVERITY_LABELS[item.severity] ?? item.severity}
                  </span>
                </button>

                <div className="vuln-target mono">{item.target}</div>

                {isOpen && (
                  <div className="vuln-detail">
                    <dl className="kv">
                      <dt>技术</dt>
                      <dd>{item.technique || "-"}</dd>
                      <dt>Payload</dt>
                      <dd>
                        <code>{item.payload || "-"}</code>
                      </dd>
                      <dt>证据</dt>
                      <dd>{item.evidence || "-"}</dd>
                      <dt>修复建议</dt>
                      <dd>{item.remediation || "-"}</dd>
                      <dt>首次发现</dt>
                      <dd className="mono small">
                        {formatDateTime(item.first_seen)} · 最近 {formatDateTime(item.last_seen)}
                      </dd>
                    </dl>
                    {item.note && (
                      <p className="note-line">
                        <b>备注：</b>
                        {item.note}
                      </p>
                    )}
                    <textarea
                      className="text-input note-input"
                      rows={2}
                      placeholder="处理备注（可选）"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                    <div className="vuln-actions">
                      {STATUS_ACTIONS.map((action) => (
                        <button
                          key={action.value}
                          className={`btn tiny ${action.className ?? ""}`}
                          onClick={() => void updateStatus(item, action.value)}
                        >
                          <CheckCircle2 size={13} />
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
