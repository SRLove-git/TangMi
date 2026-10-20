import { useEffect, useMemo, useState } from "react";
import { Globe, KeyRound, Link2, Radar } from "lucide-react";
import { api } from "../../api";
import type { Finding } from "../../types";
import Overlay from "./Overlay";

interface Props {
  runId?: string;
  onClose: () => void;
  onSelectFinding: (finding: Finding) => void;
}

const SEVERITY_ORDER = ["Critical", "High", "Medium", "Low", "Info"];

const SEVERITY_META: Record<string, { label: string; className: string }> = {
  Critical: { label: "严重", className: "sev-critical" },
  High: { label: "高危", className: "sev-high" },
  Medium: { label: "中危", className: "sev-medium" },
  Low: { label: "低危", className: "sev-low" },
  Info: { label: "信息", className: "sev-info" },
};

export default function FindingsModal({ runId, onClose, onSelectFinding }: Props) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("扫描发现");
  const [assets, setAssets] = useState<{
    tech: string[];
    ports: number[];
    subdomains: string[];
    endpoints: number;
    secrets: number;
  }>({ tech: [], ports: [], subdomains: [], endpoints: 0, secrets: 0 });

  useEffect(() => {
    let cancelled = false;
    if (!runId) {
      setLoading(false);
      setError("没有可展示的扫描结果，请先执行一次扫描。");
      return;
    }
    setLoading(true);
    api
      .run(runId)
      .then((snapshot) => {
        if (cancelled) return;
        setFindings(snapshot.findings ?? []);
        setTitle(`${snapshot.config?.target ?? ""}`.trim() || "扫描发现");
        const meta = snapshot.result_meta ?? snapshot.result?.meta;
        const rawPorts: unknown[] = meta?.open_ports ?? meta?.ports ?? [];
        const ports = rawPorts
          .map((item) => {
            if (typeof item === "number") return item;
            if (item && typeof item === "object" && "port" in item) {
              return Number((item as { port: unknown }).port);
            }
            return NaN;
          })
          .filter((port) => Number.isFinite(port));
        setAssets({
          tech: meta?.tech ?? [],
          ports: ports ?? [],
          subdomains: meta?.subdomains ?? [],
          endpoints: meta?.endpoints?.length ?? 0,
          secrets: meta?.secrets_count ?? 0,
        });
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const grouped = useMemo(() => {
    const groups: Record<string, Finding[]> = {};
    for (const finding of findings) {
      const severity = finding.severity || "Info";
      (groups[severity] ||= []).push(finding);
    }
    return SEVERITY_ORDER.filter((severity) => (groups[severity] ?? []).length > 0).map(
      (severity) => ({ severity, items: groups[severity] }),
    );
  }, [findings]);

  return (
    <Overlay
      title={`扫描发现 · ${title}`}
      subtitle="按风险等级分组；点击任意条目查看证据、CWE 与修复建议"
      onClose={onClose}
      wide
    >
      {loading && <p className="muted">加载中…</p>}
      {error && <div className="alert error">{error}</div>}
      {(assets.tech.length > 0 || assets.ports.length > 0 || assets.subdomains.length > 0) && (
        <div className="asset-strip">
          {assets.tech.length > 0 && (
            <span className="asset-chip">
              <Globe size={12} /> 技术栈：{assets.tech.slice(0, 6).join(", ")}
            </span>
          )}
          {assets.ports.length > 0 && (
            <span className="asset-chip">
              <Radar size={12} /> 开放端口：{assets.ports.slice(0, 12).join(", ")}
            </span>
          )}
          {assets.subdomains.length > 0 && (
            <span className="asset-chip">
              <Link2 size={12} /> 子域：{assets.subdomains.length} 个
            </span>
          )}
          {assets.endpoints > 0 && (
            <span className="asset-chip">
              <Link2 size={12} /> 接口：{assets.endpoints} 个
            </span>
          )}
          {assets.secrets > 0 && (
            <span className="asset-chip">
              <KeyRound size={12} /> 敏感信息：{assets.secrets} 处
            </span>
          )}
        </div>
      )}
      {!loading && !error && findings.length === 0 && (
        <p className="muted">本次扫描未发现明确风险（建议结合人工测试复核）。</p>
      )}
      {grouped.map((group) => {
        const meta = SEVERITY_META[group.severity] ?? SEVERITY_META.Info;
        return (
          <section className="finding-group" key={group.severity}>
            <div className="finding-group-head">
              <span className={`severity-badge ${meta.className}`}>
                {meta.label} · {group.items.length}
              </span>
              <span className="muted small">{group.severity}</span>
            </div>
            <div className="finding-cards">
              {group.items.map((finding, index) => (
                <button
                  key={`${finding.title}-${index}`}
                  className="finding-card"
                  onClick={() => onSelectFinding(finding)}
                >
                  <div className="finding-card-head">
                    <span className={`severity-dot ${meta.className}`} />
                    <strong>{finding.title}</strong>
                    {finding.cwe && <span className="mono tiny muted">{finding.cwe}</span>}
                  </div>
                  <div className="finding-card-meta">
                    <span className="mono ellipsis">{finding.target}</span>
                    <span className="muted small">{finding.category}</span>
                  </div>
                  {finding.evidence && (
                    <div className="finding-card-evidence ellipsis">{finding.evidence}</div>
                  )}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </Overlay>
  );
}
