import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Circle,
  CircleDot,
  Download,
  Flame,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import { api } from "../../api";
import type { LearningItem, LearningSnapshot, LearningStatus } from "../../types";
import { PageHeader } from "./shared";
import LearningItemModal from "./LearningItemModal";

interface Props {
  onAskTutor: (text: string, data?: Record<string, unknown>) => void;
  /** 从 ⌘K 命令面板跳转过来时自动打开指定关卡 */
  focusKey?: string | null;
  onFocusConsumed?: () => void;
}

const STATUS_META: Record<LearningStatus, { label: string; className: string }> = {
  not_started: { label: "未开始", className: "ls-todo" },
  learning: { label: "在学", className: "ls-learning" },
  solved: { label: "已掌握", className: "ls-solved" },
  review: { label: "待复习", className: "ls-review" },
};

const LEVELS = ["low", "medium", "high", "impossible"];
const FILTERS: Array<{ key: "all" | LearningStatus; label: string }> = [
  { key: "all", label: "全部" },
  { key: "learning", label: "在学" },
  { key: "solved", label: "已掌握" },
  { key: "review", label: "待复习" },
  { key: "not_started", label: "未开始" },
];

export default function LearningView({ onAskTutor, focusKey, onFocusConsumed }: Props) {
  const [snapshot, setSnapshot] = useState<LearningSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"dvwa" | "sqli-labs">("dvwa");
  const [statusFilter, setStatusFilter] = useState<"all" | LearningStatus>("all");
  const [notesOnly, setNotesOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LearningItem | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (reseed = false) => {
    try {
      setSnapshot(await api.learning(reseed));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!focusKey || !snapshot) return;
    const all = [...snapshot.labs.dvwa, ...snapshot.labs["sqli-labs"]];
    const target = all.find((item) => item.key === focusKey);
    if (target) {
      setTab(target.lab === "dvwa" ? "dvwa" : "sqli-labs");
      setSelected(target);
    }
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, snapshot]);

  async function reseed() {
    setSyncing(true);
    try {
      await load(true);
    } finally {
      setSyncing(false);
    }
  }

  async function exportReport() {
    const includeAi = window.confirm(
      "导出学习报告\n\n点「确定」= 附上 AI 学习教练建议（会调用一次大模型）\n点「取消」= 只导出纯数据版",
    );
    setExporting(true);
    setNotice("");
    try {
      const report = await api.learningReport(includeAi);
      const blob = new Blob([report.markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = report.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(`学习报告已导出：${report.filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  const allItems = useMemo(
    () => [...(snapshot?.labs.dvwa ?? []), ...(snapshot?.labs["sqli-labs"] ?? [])],
    [snapshot],
  );

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const source = tab === "dvwa" ? snapshot?.labs.dvwa ?? [] : snapshot?.labs["sqli-labs"] ?? [];
    return source.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (notesOnly && !item.notes) return false;
      if (!keyword) return true;
      return [item.title, item.notes, item.module_title ?? "", item.lesson ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [snapshot, tab, statusFilter, notesOnly, query]);

  const dvwaRows = useMemo(() => {
    const rows = new Map<string, { title: string; levels: Record<string, LearningItem> }>();
    for (const item of snapshot?.labs.dvwa ?? []) {
      if (!item.module) continue;
      const row = rows.get(item.module) ?? {
        title: item.module_title ?? item.module,
        levels: {},
      };
      if (item.level) row.levels[item.level] = item;
      rows.set(item.module, row);
    }
    return [...rows.entries()];
  }, [snapshot]);

  const summary = snapshot?.summary;
  const percent = summary?.percent ?? 0;

  function renderCell(item: LearningItem | undefined) {
    if (!item) return <span className="learning-cell empty">—</span>;
    const meta = STATUS_META[item.status];
    return (
      <button
        className={`learning-cell ${meta.className}`}
        title={`${item.title} · ${meta.label}${item.hints ? ` · 看过 ${item.hints} 层提示` : ""}${
          item.auto_verified ? " · 自动解题已验证" : ""
        }`}
        onClick={() => setSelected(item)}
      >
        {item.status === "solved" ? (
          <CheckCircle2 size={13} />
        ) : item.status === "not_started" ? (
          <Circle size={12} />
        ) : (
          <CircleDot size={12} />
        )}
        <span>
          {item.hints ? `💡${item.hints}` : ""}
          {item.best_score ? ` 🎯${item.best_score}` : ""}
        </span>
        {item.auto_verified && <i className="learning-auto" title="历史自动解题已验证" />}
      </button>
    );
  }

  return (
    <section className="platform-view learning-view">
      <PageHeader
        eyebrow="Learning Progress"
        title="学习进度"
        subtitle="DVWA 76 关 + SQLi-Labs 69 关的掌握度、提示记录与错题本；点关卡可看源码对照并让导师讲解。"
        actions={
          <>
            <button className="btn" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? "spin" : ""} />
              刷新
            </button>
            <button className="btn" onClick={() => void reseed()} disabled={syncing} title="从历史自动解题结果重新同步「已验证」标记">
              <RotateCcw size={14} className={syncing ? "spin" : ""} />
              同步验证结果
            </button>
            <button className="btn primary" onClick={() => void exportReport()} disabled={exporting}>
              <Download size={14} className={exporting ? "spin" : ""} />
              {exporting ? "生成中…" : "导出学习报告"}
            </button>
          </>
        }
      />

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success-alert">{notice}</div>}

      {summary && (
        <div className="learning-stats">
          <div className="learning-stat">
            <span>已掌握</span>
            <b className="ok">{summary.solved}</b>
            <small>/ {summary.total}</small>
          </div>
          <div className="learning-stat">
            <span>在学</span>
            <b className="info">{summary.learning}</b>
            <small>有笔记 {summary.notes} 关</small>
          </div>
          <div className="learning-stat">
            <span>待复习</span>
            <b className="warn">{summary.review}</b>
            <small>今日到期 {summary.due_review}</small>
          </div>
          <div className="learning-stat">
            <span>练习通过</span>
            <b>{summary.quiz_passed}</b>
            <small>AI 出题 ≥80 分</small>
          </div>
          <div className="learning-stat">
            <span>连续学习</span>
            <b className="streak">
              <Flame size={16} /> {summary.streak}
            </b>
            <small>天</small>
          </div>
          <div className="learning-progress-cell">
            <div className="learning-progress-head">
              <span>总进度</span>
              <b>{percent}%</b>
            </div>
            <div className="learning-progress-bar">
              <span style={{ width: `${Math.min(100, percent)}%` }} />
            </div>
          </div>
        </div>
      )}

      <div className="learning-toolbar">
        <div className="segmented learning-tabs">
          <button
            className={`segment ${tab === "dvwa" ? "active" : ""}`}
            onClick={() => setTab("dvwa")}
          >
            DVWA（76 关）
          </button>
          <button
            className={`segment ${tab === "sqli-labs" ? "active" : ""}`}
            onClick={() => setTab("sqli-labs")}
          >
            SQLi-Labs（69 关）
          </button>
        </div>
        <div className="deploy-filter-chips">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              className={`deploy-filter ${statusFilter === filter.key ? "active" : ""}`}
              onClick={() => setStatusFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
          <label className="learning-notes-toggle">
            <input
              type="checkbox"
              checked={notesOnly}
              onChange={(event) => setNotesOnly(event.target.checked)}
            />
            只看有笔记
          </label>
        </div>
        <div className="filter-search learning-search">
          <Search size={14} />
          <input
            className="text-input"
            placeholder="搜索模块 / 关卡 / 笔记…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {summary && summary.due_review > 0 && (
        <div className="alert review-alert">
          <span>
            📌 今天有 <b>{summary.due_review}</b> 个关卡到期待复习：建议先过一遍，再学新关卡（间隔复习记得更牢）。
          </span>
          <button className="btn tiny" onClick={() => setStatusFilter("review")}>
            只看待复习
          </button>
        </div>
      )}

      {loading && !snapshot && <div className="card muted">正在读取学习进度…</div>}

      {snapshot && tab === "dvwa" && (
        <div className="card learning-matrix-card">
          <table className="learning-matrix">
            <thead>
              <tr>
                <th>模块</th>
                {LEVELS.map((level) => (
                  <th key={level}>{level}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dvwaRows.map(([module, row]) => (
                <tr key={module}>
                  <td className="learning-module">{row.title}</td>
                  {LEVELS.map((level) => {
                    const item = row.levels[level];
                    const hidden =
                      item &&
                      ((statusFilter !== "all" && item.status !== statusFilter) ||
                        (notesOnly && !item.notes) ||
                        (query.trim() && !filteredItems.includes(item)));
                    return (
                      <td key={level}>{hidden ? <span className="learning-cell empty">—</span> : renderCell(item)}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="learning-legend">
            {Object.entries(STATUS_META).map(([key, meta]) => (
              <span key={key} className={`learning-legend-item ${meta.className}`}>
                <i /> {meta.label}
              </span>
            ))}
            <span className="learning-legend-item muted">💡n = 已看提示层级 · 「自动验证」表示历史自动解题已跑通</span>
          </div>
        </div>
      )}

      {snapshot && tab === "sqli-labs" && (
        <div className="card">
          <div className="learning-sqli-grid">
            {filteredItems.map((item) => {
              const meta = STATUS_META[item.status];
              return (
                <button
                  key={item.key}
                  className={`learning-lesson ${meta.className}`}
                  title={`${item.title} · ${meta.label}${
                    item.hints ? ` · 看过 ${item.hints} 层提示` : ""
                  }`}
                  onClick={() => setSelected(item)}
                >
                  <b>{item.lesson}</b>
                  <span>
                    {item.hints ? `💡${item.hints}` : meta.label}
                    {item.best_score ? ` 🎯${item.best_score}` : ""}
                  </span>
                  {item.auto_verified && <i className="learning-auto" title="历史自动解题已验证" />}
                </button>
              );
            })}
            {filteredItems.length === 0 && <p className="muted small">没有匹配的关卡。</p>}
          </div>
          <div className="learning-legend">
            {Object.entries(STATUS_META).map(([key, meta]) => (
              <span key={key} className={`learning-legend-item ${meta.className}`}>
                <i /> {meta.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {!loading && snapshot && allItems.length > 0 && (
        <p className="form-hint">
          <Sparkles size={12} /> 点击任意关卡：可标记状态、写错题笔记、查看四难度源码 diff，或一键让 AI 导师结合真实页面给提示。
        </p>
      )}
      {!loading && snapshot && (
        <p className="muted small">
          <BookOpen size={12} /> 自动验证结果来自历史「自动解题」任务，只表示参考答案已跑通，不代表你已掌握。
        </p>
      )}

      {selected && (
        <LearningItemModal
          item={selected}
          onClose={() => setSelected(null)}
          onAskTutor={onAskTutor}
          onUpdated={() => void load()}
        />
      )}
    </section>
  );
}
