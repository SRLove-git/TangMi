import type { Finding } from "../types";
import { groupFindings, statusMeta } from "../utils";

const LEVEL_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  impossible: "Impossible",
};

interface Props {
  findings: Finding[];
  onSelectFinding: (finding: Finding) => void;
}

export default function MatrixView({ findings, onSelectFinding }: Props) {
  const { dvwa, sqli } = groupFindings(findings);

  if (!dvwa && sqli.length === 0) {
    return <p className="muted">没有可展示的结果。</p>;
  }

  return (
    <div className="matrix-wrap">
      {dvwa && (
        <section className="card">
          <div className="card-head">
            <h3>DVWA 模块矩阵</h3>
            <span className="muted small">
              {dvwa.modules.length} 模块 × {dvwa.levels.length} 难度
            </span>
          </div>
          <div className="table-wrap">
            <table className="matrix-table">
              <thead>
                <tr>
                  <th>模块</th>
                  {dvwa.levels.map((level) => (
                    <th key={level}>{LEVEL_LABEL[level] ?? level}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dvwa.modules.map((module) => (
                  <tr key={module.key}>
                    <td className="module-cell">
                      <span className="mono module-key">{module.key}</span>
                      <span className="muted small ellipsis">{module.title}</span>
                    </td>
                    {dvwa.levels.map((level) => {
                      const finding = dvwa.cells.get(`${module.key}|${level}`);
                      if (!finding) {
                        return (
                          <td key={level} className="matrix-cell">
                            <span className="muted">—</span>
                          </td>
                        );
                      }
                      const meta = statusMeta(finding.status);
                      return (
                        <td key={level} className="matrix-cell">
                          <button
                            className={`status-cell ${meta.className}`}
                            title={`${finding.title} · ${meta.label}`}
                            onClick={() => onSelectFinding(finding)}
                          >
                            <span className="status-cell-icon">{meta.icon}</span>
                            <span className="status-cell-label">{meta.label}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Legend />
        </section>
      )}

      {sqli.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>SQLi-Labs 关卡</h3>
            <span className="muted small">
              {sqli.filter((finding) => finding.status === "exploited").length}/{sqli.length} 已拿下
            </span>
          </div>
          <div className="lesson-grid">
            {sqli.map((finding) => {
              const meta = statusMeta(finding.status);
              return (
                <button
                  key={`${finding.lab}-${finding.target}`}
                  className={`lesson-cell ${meta.className}`}
                  title={`${finding.target} · ${finding.title} · ${meta.label}`}
                  onClick={() => onSelectFinding(finding)}
                >
                  <span className="lesson-number">{finding.target.replace(/^Less-/, "")}</span>
                  <span className="lesson-icon">{meta.icon}</span>
                </button>
              );
            })}
          </div>
          <Legend />
        </section>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span className="legend-item st-exploited">✔ 已拿下</span>
      <span className="legend-item st-protected">🛡 已防御</span>
      <span className="legend-item st-failed">✘ 失败</span>
      <span className="legend-item st-skipped">⏭ 跳过</span>
      <span className="legend-item st-error">⚠ 异常</span>
    </div>
  );
}
