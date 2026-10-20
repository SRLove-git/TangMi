import { useEffect, useState } from "react";
import { api } from "../../api";
import type { KnowledgeCard, LabSource, LearningItem, LearningStatus } from "../../types";
import Overlay from "../chat/Overlay";
import QuizModal from "./QuizModal";

interface Props {
  item: LearningItem;
  onClose: () => void;
  onAskTutor: (text: string, data?: Record<string, unknown>) => void;
  onUpdated: () => void;
}

const STATUS_ACTIONS: Array<{ value: LearningStatus; label: string }> = [
  { value: "learning", label: "标记在学" },
  { value: "solved", label: "标记已掌握" },
  { value: "review", label: "加入待复习" },
  { value: "not_started", label: "重置为未开始" },
];

const LEVEL_LABELS: Record<string, string> = {
  low: "low（低）",
  medium: "medium（中）",
  high: "high（高）",
  impossible: "impossible（防御）",
};

export default function LearningItemModal({
  item,
  onClose,
  onAskTutor,
  onUpdated,
}: Props) {
  const [note, setNote] = useState(item.notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [source, setSource] = useState<LabSource | null>(null);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [sourceLevel, setSourceLevel] = useState(item.level ?? "low");
  const [sourceView, setSourceView] = useState<"code" | "diff" | "knowledge">("code");
  const [knowledge, setKnowledge] = useState<KnowledgeCard | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [showQuiz, setShowQuiz] = useState(false);

  useEffect(() => {
    setNote(item.notes);
    setError("");
    setSaved("");
    setSourceLevel(item.level ?? "low");
    let cancelled = false;
    setSourceLoading(true);
    setKnowledgeLoading(true);
    api
      .labKnowledge(item.key)
      .then((data) => {
        if (!cancelled) setKnowledge(data.card);
      })
      .catch(() => {
        if (!cancelled) setKnowledge(null);
      })
      .finally(() => {
        if (!cancelled) setKnowledgeLoading(false);
      });
    api
      .labSource(item.key)
      .then((data) => {
        if (!cancelled) setSource(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.key, item.level, item.notes]);

  async function updateStatus(status: LearningStatus) {
    setSaving(true);
    setError("");
    try {
      await api.updateLearning(item.key, { status });
      setSaved(`状态已更新为「${statusLabel(status)}」`);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    setSaving(true);
    setError("");
    try {
      await api.updateLearning(item.key, { note });
      setSaved("笔记已保存");
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function markReviewed() {
    setSaving(true);
    setError("");
    try {
      await api.updateLearning(item.key, { review_done: true });
      setSaved("已记录一次复习，间隔会递增（3 → 7 → 14 → 30 天）");
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function askTutor(mode: "hint" | "explain" | "read") {
    const prompts = {
      hint: `${item.title} 这一关我不太会，先给我第 1 层提示，不要直接给答案`,
      explain: `帮我讲解 ${item.title} 的原理和利用条件，先给方向不要直接给答案`,
      read: `读取 ${item.title} 的当前页面和源码，先给我第 1 层提示，不要直接给答案`,
    };
    onAskTutor(prompts[mode], { item_key: item.key });
    onClose();
  }

  const currentSource = source?.levels?.[sourceLevel] ?? source?.source;
  const currentDiff = source?.diffs?.find(
    (diff) => diff.from === sourceLevel || diff.to === sourceLevel,
  );

  return (
    <Overlay
      title={item.title}
      subtitle={`${item.status_label} · 已看 ${item.hints} 层提示 · 导师对话 ${item.tutor_turns} 次${
        item.auto_verified ? " · 自动解题已验证" : ""
      }${item.best_score ? ` · AI 练习最高 ${item.best_score} 分` : ""}${
        item.review_at ? ` · 下次复习 ${item.review_at.slice(0, 10)}` : ""
      }`}
      onClose={onClose}
      wide
    >
      {error && <div className="alert error">{error}</div>}
      {saved && <div className="alert success-alert">{saved}</div>}

      <div className="learning-detail-grid">
        <div className="learning-detail-main">
          <div className="learning-action-row">
            {STATUS_ACTIONS.map((action) => (
              <button
                key={action.value}
                className={`btn tiny ${item.status === action.value ? "primary" : ""}`}
                disabled={saving}
                onClick={() => void updateStatus(action.value)}
              >
                {action.label}
              </button>
            ))}
          </div>

          <label className="field-label">我的笔记 / 错题记录</label>
          <textarea
            className="text-input learning-note"
            rows={6}
            placeholder="记录这关的思路、踩过的坑、payload 原理……（保存后可在学习页筛选「有笔记」）"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="learning-note-actions">
            <button className="btn primary tiny" onClick={() => void saveNote()} disabled={saving}>
              {saving ? "保存中…" : "保存笔记"}
            </button>
            <span className="form-hint">
              提示层级与导师对话会自动记录；标记「已掌握」后进度 +1。
            </span>
          </div>

          <div className="learning-tutor-actions">
            <button className="btn tiny" onClick={() => askTutor("hint")}>
              让我先自己想（要提示）
            </button>
            <button className="btn tiny" onClick={() => askTutor("read")}>
              读取当前页面再给提示
            </button>
            <button className="btn tiny" onClick={() => askTutor("explain")}>
              讲解原理
            </button>
            <button className="btn tiny" onClick={() => setShowQuiz(true)}>
              🎯 AI 出题练习
            </button>
            <button className="btn tiny ghost" onClick={() => void markReviewed()} disabled={saving}>
              已复习（下次 +3/7/14 天）
            </button>
            <a className="btn tiny ghost" href={item.url} target="_blank" rel="noreferrer">
              打开靶场
            </a>
          </div>
        </div>

        <div className="learning-detail-side">
          <div className="card-head">
            <h4>源码对照</h4>
            <div className="segmented learning-source-toggle">
              <button
                className={`segment ${sourceView === "code" ? "active" : ""}`}
                onClick={() => setSourceView("code")}
              >
                源码
              </button>
              {source?.kind === "dvwa" && (
                <button
                  className={`segment ${sourceView === "diff" ? "active" : ""}`}
                  onClick={() => setSourceView("diff")}
                >
                  难度 diff
                </button>
              )}
              <button
                className={`segment ${sourceView === "knowledge" ? "active" : ""}`}
                onClick={() => setSourceView("knowledge")}
              >
                知识卡片
              </button>
            </div>
          </div>

          {sourceView === "knowledge" && (
            <>
              {knowledgeLoading && <p className="muted small">加载知识卡片中…</p>}
              {!knowledgeLoading && !knowledge && (
                <p className="muted small">这一关暂时没有内置知识卡片。</p>
              )}
              {!knowledgeLoading && knowledge && (
                <div className="knowledge-card">
                  <div className="knowledge-head">
                    <b>{knowledge.title}</b>
                    <span className="deploy-chip">{knowledge.cwe}</span>
                    <span className="deploy-chip">{knowledge.owasp}</span>
                  </div>
                  <p className="knowledge-principle">{knowledge.principle}</p>
                  {knowledge.key_points?.length ? (
                    <ul className="knowledge-points">
                      {knowledge.key_points.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  ) : null}
                  {knowledge.defense && (
                    <p className="knowledge-defense">
                      <b>防御：</b>
                      {knowledge.defense}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
          {sourceView !== "knowledge" && sourceLoading && <p className="muted small">加载源码中…</p>}
          {sourceView !== "knowledge" && !sourceLoading && source?.kind === "dvwa" && (
            <>
              <div className="learning-level-tabs">
                {["low", "medium", "high", "impossible"]
                  .filter((level) => source.levels[level])
                  .map((level) => (
                  <button
                    key={level}
                    className={`deploy-filter ${sourceLevel === level ? "active" : ""}`}
                    onClick={() => setSourceLevel(level)}
                  >
                    {LEVEL_LABELS[level] ?? level}
                  </button>
                ))}
              </div>
              {sourceView === "code" ? (
                <pre className="code-block">
                  {currentSource?.code || "（该难度源码缺失）"}
                </pre>
              ) : (
                <div className="learning-diffs">
                  {source.diffs.map((diff) => (
                    <details key={`${diff.from}-${diff.to}`} open={Boolean(currentDiff?.from === diff.from)}>
                      <summary>
                        {diff.from} → {diff.to}
                        {!diff.has_changes && "（无差异）"}
                      </summary>
                      <pre className="code-block diff-block">{diff.text || "无差异"}</pre>
                    </details>
                  ))}
                </div>
              )}
            </>
          )}
          {sourceView !== "knowledge" && !sourceLoading && source?.kind === "sqli-labs" && (
            <>
              <p className="form-hint mono">{source.source?.path}</p>
              <pre className="code-block">{source.source?.code || "（源码缺失）"}</pre>
            </>
          )}
          {!sourceLoading && source?.warnings?.length ? (
            <p className="form-hint">⚠ {source.warnings.join("；")}</p>
          ) : null}
        </div>
      </div>

      {showQuiz && (
        <QuizModal item={item} onClose={() => setShowQuiz(false)} onUpdated={onUpdated} />
      )}
    </Overlay>
  );
}

export function statusLabel(status: LearningStatus): string {
  return (
    { not_started: "未开始", learning: "在学", solved: "已掌握", review: "待复习" }[
      status
    ] ?? status
  );
}
