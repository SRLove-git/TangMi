import { useEffect, useMemo, useRef, useState } from "react";
import type { ReportFile } from "../types";
import { api } from "../api";
import { formatTime, renderMarkdown } from "../utils";

interface Props {
  reports: ReportFile[];
  onRefresh: () => void;
  compact?: boolean;
}


export default function ReportView({ reports, onRefresh, compact = false }: Props) {
  const [selected, setSelected] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loadedRef = useRef<string>("");

  const markdownReports = useMemo(
    () => reports.filter((report) => report.kind === "markdown"),
    [reports],
  );

  useEffect(() => {
    if (!reports.length) return;
    if (selected && reports.some((report) => report.name === selected)) return;
    const preferred =
      reports.find((report) => report.name === "pentest_report.md") ??
      markdownReports[0] ??
      reports[0];
    setSelected(preferred.name);
  }, [reports, selected, markdownReports]);

  const isHtmlReport = selected.endsWith(".html");

  useEffect(() => {
    if (!selected) return;
    if (loadedRef.current === selected) return;
    loadedRef.current = selected;
    if (selected.endsWith(".html")) {
      setLoading(false);
      setError("");
      setContent("");
      return;
    }
    setLoading(true);
    setError("");
    api
      .report(selected)
      .then((text) => setContent(text))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selected]);

  const isJson = selected.endsWith(".json");
  const html = useMemo(() => {
    if (!content || isJson) return "";
    return renderMarkdown(content);
  }, [content, isJson]);

  return (
    <div className="page report-page">
      <section className={`card report-toolbar ${compact ? "compact" : ""}`}>
        {!compact && (
          <div>
            <h3>测试报告</h3>
            <p className="muted small">
              每次扫描 / 验证会生成 Markdown、HTML 与 JSON 三种报告，可直接预览、下载归档。
            </p>
          </div>
        )}
        <div className="toolbar-actions">
          <select
            className="select"
            value={selected}
            onChange={(event) => {
              loadedRef.current = "";
              setSelected(event.target.value);
            }}
          >
            {reports.length === 0 && <option value="">暂无报告</option>}
            {reports.map((report) => (
              <option key={report.name} value={report.name}>
                {report.name} · {(report.size / 1024).toFixed(0)} KB
              </option>
            ))}
          </select>
          <button className="btn" onClick={onRefresh}>
            刷新列表
          </button>
          {selected && (
            <a
              className="btn primary"
              href={`/api/reports/${encodeURIComponent(selected)}`}
              download={selected}
            >
              下载文件
            </a>
          )}
        </div>
      </section>

      {error && <div className="alert error">{error}</div>}
      {reports.length === 0 && (
        <section className="card empty-state">
          <div className="empty-icon">▤</div>
          <h3>还没有报告</h3>
          <p className="muted">运行一次「全量验证」或「解题任务」后，报告会自动出现在这里。</p>
        </section>
      )}

      {selected && reports.length > 0 && (
        <section className="card report-card">
          <div className="card-head">
            <h4 className="mono">{selected}</h4>
            <span className="muted small">
              {(() => {
                const report = reports.find((item) => item.name === selected);
                return report ? `${formatTime(report.mtime)} · ${(report.size / 1024).toFixed(1)} KB` : "";
              })()}
            </span>
          </div>
          {loading ? (
            <p className="muted">加载中…</p>
          ) : isHtmlReport ? (
            <iframe
              className="report-iframe"
              title={selected}
              src={`/api/reports/${encodeURIComponent(selected)}`}
            />
          ) : isJson ? (
            <pre className="code-block json-block">{content}</pre>
          ) : (
            <article
              className="markdown-body"
              // 内容已通过 marked renderer 转义原始 HTML，内容来源为本地生成报告
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </section>
      )}
    </div>
  );
}
