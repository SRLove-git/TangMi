import type { Finding } from "../types";
import { formatDuration, formatTime, statusMeta } from "../utils";

interface Props {
  finding: Finding | null;
  onClose: () => void;
}

export default function FindingDrawer({ finding, onClose }: Props) {
  if (!finding) return null;
  const meta = statusMeta(finding.status);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className={`status-pill ${meta.className}`}>
              {meta.icon} {meta.label}
            </div>
            <h3>{finding.target}</h3>
            <p className="muted small">
              {finding.lab}
              {finding.level ? ` · ${finding.level}` : ""} · {formatTime(finding.timestamp)}
            </p>
          </div>
          <button className="btn ghost tiny" onClick={onClose}>
            ✕
          </button>
        </div>

        <h4>{finding.title}</h4>
        {finding.severity && <p className="muted small">风险等级：{finding.severity}</p>}
        {finding.category && <p className="muted small">漏洞分类：{finding.category}</p>}

        <dl className="kv drawer-kv">
          <dt>利用技术</dt>
          <dd>{finding.technique || "—"}</dd>
          <dt>耗时</dt>
          <dd>{formatDuration(finding.duration_ms)}</dd>
          {finding.cwe && (
            <>
              <dt>CWE</dt>
              <dd>{finding.cwe}</dd>
            </>
          )}
          {typeof finding.cvss === "number" && finding.cvss > 0 && (
            <>
              <dt>CVSS</dt>
              <dd>{finding.cvss}</dd>
            </>
          )}
          {finding.attempts ? (
            <>
              <dt>尝试次数</dt>
              <dd>{finding.attempts}</dd>
            </>
          ) : null}
        </dl>

        <div className="drawer-section">
          <h4>Payload</h4>
          <pre className="code-block">{finding.payload || "—"}</pre>
        </div>

        <div className="drawer-section">
          <h4>证据 / 响应</h4>
          <div className="evidence-block">{finding.evidence || "—"}</div>
        </div>

        {finding.remediation && (
          <div className="drawer-section">
            <h4>修复建议</h4>
            <div className="evidence-block">{finding.remediation}</div>
          </div>
        )}

        {finding.notes && (
          <div className="drawer-section">
            <h4>备注</h4>
            <div className="evidence-block">{finding.notes}</div>
          </div>
        )}

        {finding.request && (
          <div className="drawer-section">
            <h4>请求</h4>
            <pre className="code-block">{finding.request}</pre>
          </div>
        )}
      </aside>
    </div>
  );
}
