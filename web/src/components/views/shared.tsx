import type { ReactNode } from "react";

export const SEVERITY_ORDER = ["Critical", "High", "Medium", "Low", "Info"];

export const SEVERITY_LABELS: Record<string, string> = {
  Critical: "严重",
  High: "高危",
  Medium: "中危",
  Low: "低危",
  Info: "信息",
};

export const SEVERITY_CLASS: Record<string, string> = {
  Critical: "sev-critical",
  High: "sev-high",
  Medium: "sev-medium",
  Low: "sev-low",
  Info: "sev-info",
};

export const VULN_STATUS: Record<string, string> = {
  open: "待确认",
  confirmed: "已确认",
  false_positive: "误报",
  fixed: "已修复",
  risk_accepted: "已接受风险",
};

export function severityClass(severity: string): string {
  return SEVERITY_CLASS[severity] ?? "sev-info";
}

export function formatDateTime(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

interface ScopeSwitchProps {
  value: "all" | "project";
  onChange: (value: "all" | "project") => void;
  projectName?: string;
  projectId: string | null;
}

export function ScopeSwitch({ value, onChange, projectName, projectId }: ScopeSwitchProps) {
  return (
    <div className="segmented scope-switch">
      <button
        className={`segment ${value === "all" ? "active" : ""}`}
        onClick={() => onChange("all")}
      >
        全部项目
      </button>
      <button
        className={`segment ${value === "project" ? "active" : ""}`}
        disabled={!projectId}
        onClick={() => onChange("project")}
      >
        {projectName ? `当前：${projectName}` : "当前项目"}
      </button>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="card empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      {action}
    </div>
  );
}
