import { marked } from "marked";
import type { Finding, RunSnapshot, Status } from "./types";

export const STATUS_META: Record<
  Status,
  { icon: string; label: string; className: string }
> = {
  exploited: { icon: "✔", label: "已拿下", className: "st-exploited" },
  protected: { icon: "🛡", label: "已防御", className: "st-protected" },
  failed: { icon: "✘", label: "失败", className: "st-failed" },
  skipped: { icon: "⏭", label: "跳过", className: "st-skipped" },
  error: { icon: "⚠", label: "异常", className: "st-error" },
};

export function statusMeta(status: string) {
  return (
    STATUS_META[status as Status] ?? {
      icon: "?",
      label: status,
      className: "st-skipped",
    }
  );
}

export function formatTime(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDuration(ms: number | undefined): string {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export interface MatrixData {
  lab: string;
  levels: string[];
  modules: { key: string; title: string }[];
  cells: Map<string, Finding>;
}

const LEVEL_ORDER = ["low", "medium", "high", "impossible"];

/** 将 findings 按 DVWA 矩阵 / SQLi 关卡分组。 */
export function groupFindings(findings: Finding[]): {
  dvwa: MatrixData | null;
  sqli: Finding[];
} {
  const dvwaFindings = findings.filter(
    (finding) => finding.level && finding.level !== "",
  );
  const sqliFindings = findings
    .filter((finding) => !finding.level || finding.level === "")
    .sort((a, b) => lessonNumber(a.target) - lessonNumber(b.target));

  let dvwa: MatrixData | null = null;
  if (dvwaFindings.length > 0) {
    const levels = LEVEL_ORDER.filter((level) =>
      dvwaFindings.some((finding) => finding.level === level),
    );
    const modules: { key: string; title: string }[] = [];
    const cells = new Map<string, Finding>();
    for (const finding of dvwaFindings) {
      if (!modules.some((module) => module.key === finding.target)) {
        modules.push({ key: finding.target, title: finding.title });
      }
      cells.set(`${finding.target}|${finding.level}`, finding);
    }
    modules.sort((a, b) => a.key.localeCompare(b.key));
    dvwa = { lab: "DVWA", levels, modules, cells };
  }
  return { dvwa, sqli: sqliFindings };
}

function lessonNumber(target: string): number {
  const match = /Less-(\d+)([a-z]?)/i.exec(target);
  if (!match) return 9999;
  return Number(match[1]) + (match[2] ? 0.5 : 0);
}

/** 从一次运行中提取 lab 分组结果（兼容历史运行记录的 result 字段）。 */
export function runsFromSnapshot(snapshot: RunSnapshot): {
  lab: string;
  targetUrl: string;
  summary: Record<string, number | boolean | string>;
  findings: Finding[];
}[] {
  if (snapshot.result?.runs?.length) {
    return snapshot.result.runs.map((run) => ({
      lab: run.lab,
      targetUrl: run.target_url,
      summary: run.summary as unknown as Record<string, number | boolean | string>,
      findings: run.findings,
    }));
  }
  const summary = (snapshot.summary ?? {}) as Record<string, number | boolean | string>;
  return [
    {
      lab: String(snapshot.config?.lab && snapshot.config.lab !== "auto"
        ? snapshot.config.lab
        : summary.lab ?? "scan"),
      targetUrl: String(snapshot.config?.target ?? ""),
      summary,
      findings: snapshot.findings ?? [],
    },
  ];
}

/** 由「最新验证结果 JSON」构造一个伪运行快照，用于结果页展示。 */
export function snapshotFromLatestResult(data: {
  runs: {
    lab: string;
    target_url: string;
    summary: unknown;
    findings: Finding[];
  }[];
}): RunSnapshot {
  const findings = data.runs.flatMap((run) =>
    run.findings.map((finding) => ({ ...finding })),
  );
  const totals = data.runs.reduce(
    (acc, run) => {
      const summary = run.summary as Record<string, number | boolean> | undefined;
      acc.total += Number(summary?.total ?? 0);
      acc.exploited += Number(summary?.exploited ?? 0);
      acc.protected += Number(summary?.protected ?? 0);
      acc.failed += Number(summary?.failed ?? 0);
      return acc;
    },
    { total: 0, exploited: 0, protected: 0, failed: 0 },
  );
  const coverage = totals.total
    ? Math.round(((totals.exploited + totals.protected) / totals.total) * 1000) / 10
    : 0;
  return {
    id: "latest-report",
    kind: "scan",
    config: { target: "reports/pentest_results.json（最新验证报告）", lab: "verify" },
    status: "completed",
    created_at: "",
    started_at: "",
    finished_at: "",
    error: "",
    summary: {
      total: totals.total,
      exploited: totals.exploited,
      protected: totals.protected,
      failed: totals.failed,
      skipped: 0,
      coverage,
      fully_solved: totals.failed === 0 && totals.total > 0,
    } as unknown as Record<string, unknown>,
    progress: { done: findings.length, total: findings.length, percent: 100 },
    findings,
    logs: [],
    seq: 0,
    result: { runs: data.runs as never },
  };
}

export function percent(done: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((done / total) * 1000) / 10);
}


/* ------------------------------------------------------------ Markdown 渲染 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const markdownRenderer = new marked.Renderer();
markdownRenderer.html = ((token: unknown) => {
  const text =
    typeof token === "string"
      ? token
      : ((token as { text?: string })?.text ?? String(token));
  return `<pre class="raw-html">${escapeHtml(text)}</pre>`;
}) as never;
marked.setOptions({ renderer: markdownRenderer, gfm: true, breaks: true });

/** 渲染 Markdown；报告/对话内容来自本地 Agent，但会转义原始 HTML 防止被执行。 */
export function renderMarkdown(text: string): string {
  try {
    const result = marked.parse(text ?? "");
    const html = typeof result === "string" ? result : "";
    if (!html) return html;
    // 代码块注入「复制」按钮：点击事件在消息容器上统一代理（见 MessageItem）
    return html.replace(
      /<pre>([\s\S]*?)<\/pre>/g,
      (_match, inner: string) =>
        `<pre class="code-block">${inner}<button type="button" class="code-copy" aria-label="复制代码">复制</button></pre>`,
    );
  } catch {
    return `<p>${escapeHtml(text ?? "")}</p>`;
  }
}
