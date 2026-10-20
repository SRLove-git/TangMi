import { useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  FileText,
  FlaskConical,
  ListChecks,
  Radar,
  Search,
  Shield,
  Wrench,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ToolCallView } from "../../types";

interface Props {
  tool: ToolCallView;
  /** 当前回合是否仍在流式生成（最后一张卡片可展示实时状态） */
  live?: boolean;
  onOpenMatrix: (runId?: string) => void;
  onOpenFindings: (runId?: string) => void;
  onOpenReport: () => void;
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  get_status: Activity,
  run_web_scan: Radar,
  run_dvwa: FlaskConical,
  run_sqli_labs: FlaskConical,
  verify_all: Zap,
  lab_control: Wrench,
  get_results: ListChecks,
  get_report: FileText,
  list_deployable_labs: Shield,
  deploy_lab: Shield,
  set_target: Search,
  get_current_context: Activity,
  update_plan: ListChecks,
  fetch_lab_context: BookOpen,
  get_knowledge_card: BookOpen,
  get_learning_progress: BookOpen,
};

export function formatElapsed(ms: number | undefined): string {
  if (!ms || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function argSummary(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === null || value === undefined || value === "") continue;
    let text: string;
    if (Array.isArray(value)) {
      text = value.map((item) => String(item)).join(", ");
    } else if (typeof value === "object") {
      text = JSON.stringify(value);
    } else {
      text = String(value);
    }
    if (text.length > 60) text = `${text.slice(0, 60)}…`;
    parts.push(`${key}: ${text}`);
    if (parts.length >= 4) break;
  }
  return parts.join(" · ");
}

export default function ToolCallCard({
  tool,
  live,
  onOpenMatrix,
  onOpenFindings,
  onOpenReport,
}: Props) {
  const Icon = TOOL_ICONS[tool.name] ?? Wrench;
  const [open, setOpen] = useState(tool.status === "error");

  // 出错时自动展开，方便直接看到原因
  useEffect(() => {
    if (tool.status === "error") setOpen(true);
  }, [tool.status]);

  const running = tool.status === "running";
  const actions = tool.actions ?? [];
  const summary = argSummary(tool.args);

  return (
    <div className={`tool-call ${tool.status} ${open ? "open" : ""}`}>
      <button
        type="button"
        className="tool-call-head"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="tool-call-icon">
          <Icon size={13} />
        </span>
        <span className="tool-call-label">{tool.label || tool.name}</span>
        <span className="tool-call-name mono">{tool.name}</span>
        <span className={`tool-call-status ${tool.status}`}>
          {running ? (
            <>
              <span className="tool-spinner" />
              运行中
              {live ? "" : ""}
            </>
          ) : tool.status === "done" ? (
            <>
              ✓ 完成
              {formatElapsed(tool.elapsed_ms) ? ` · ${formatElapsed(tool.elapsed_ms)}` : ""}
            </>
          ) : (
            <>✕ 失败{formatElapsed(tool.elapsed_ms) ? ` · ${formatElapsed(tool.elapsed_ms)}` : ""}</>
          )}
        </span>
        <span className={`tool-caret ${open ? "open" : ""}`}>›</span>
      </button>

      {(summary || open) && (
        <div className="tool-call-body">
          {summary && <div className="tool-call-args mono">{summary}</div>}
          {open && tool.output && (
            <pre className="tool-call-output">{tool.output}</pre>
          )}
          {open && running && !tool.output && (
            <div className="tool-call-waiting">
              <span className="tool-spinner" />
              正在执行，进度会实时同步到对话里…
            </div>
          )}
          {open && actions.length > 0 && (
            <div className="tool-call-actions">
              {actions.includes("findings") && (
                <button className="btn tiny" onClick={() => onOpenFindings(tool.run_id)}>
                  查看发现
                </button>
              )}
              {actions.includes("matrix") && (
                <button className="btn tiny" onClick={() => onOpenMatrix(tool.run_id)}>
                  查看矩阵
                </button>
              )}
              {actions.includes("report") && (
                <button className="btn tiny" onClick={onOpenReport}>
                  打开报告
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
