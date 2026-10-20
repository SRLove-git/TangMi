import { useEffect, useRef, useState } from "react";
import {
  Brain,
  ChevronRight,
  Copy,
  GraduationCap,
  ListChecks,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { ChatMessage, PlanState, RunLive } from "../../types";
import { formatTime, renderMarkdown, statusMeta } from "../../utils";
import RunCard from "./RunCard";
import ToolCallCard from "./ToolCallCard";

interface Props {
  message: ChatMessage;
  runCards: Record<string, RunLive>;
  onOpenMatrix: (runId?: string) => void;
  onOpenFindings: (runId?: string) => void;
  onOpenReport: () => void;
  /** 教学模式的快捷操作（提示 / 答案 / 我懂了） */
  onTutorAction?: (text: string, data?: Record<string, unknown>) => void;
}

export default function MessageItem({
  message,
  runCards,
  onOpenMatrix,
  onOpenFindings,
  onOpenReport,
  onTutorAction,
}: Props) {
  const isUser = message.role === "user";
  const actions = message.data?.actions ?? [];
  const summary = (message.data?.summary ?? null) as Record<string, unknown> | null;
  const runCard = message.data?.run_id ? runCards[message.data.run_id] : undefined;
  const isTutor = message.data?.mode === "tutor" || message.kind === "tutor";
  const isError = message.kind === "error";
  const reasoning = typeof message.data?.reasoning === "string" ? message.data.reasoning : "";
  const tools = message.data?.tools ?? [];
  const plan = (message.data?.plan as PlanState | undefined) ?? null;
  const streaming = Boolean(message.data?.streaming);
  const stopped = Boolean(message.data?.stopped);
  const elapsed = useElapsedSeconds(streaming, message.created_at);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  function handleBubbleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const button = target.closest(".code-copy") as HTMLElement | null;
    if (!button) return;
    const pre = button.closest("pre");
    const code = pre?.querySelector("code");
    const text = code?.textContent ?? pre?.textContent ?? "";
    void copyToClipboard(text);
    button.textContent = "已复制";
    window.setTimeout(() => {
      button.textContent = "复制";
    }, 1400);
  }

  async function handleCopyMessage() {
    await copyToClipboard(message.content ?? "");
    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  if (isUser) {
    return (
      <div className="chat-row user">
        <div className="bubble user-bubble">
          {message.data?.mode === "tutor" && (
            <span className="mode-tag">
              <GraduationCap size={11} /> 教学提问
            </span>
          )}
          {message.content}
        </div>
        <div className="avatar user-avatar">你</div>
      </div>
    );
  }

  const hasTool = tools.length > 0;
  const showThinking =
    streaming && !message.content.trim() && !hasTool && !reasoning.trim();

  return (
    <div className="chat-row assistant">
      <div className={`avatar agent-avatar ${isTutor ? "tutor-avatar" : ""}`}>
        {isTutor ? <GraduationCap size={15} /> : <Sparkles size={15} />}
      </div>
      <div
        className={`bubble agent-bubble ${isError ? "error" : ""} ${
          isTutor && !isError ? "tutor-bubble" : ""
        } ${streaming ? "streaming" : ""}`}
        onClick={handleBubbleClick}
      >
        {!isError && (
          <span className="agent-meta-line">
            <span className={`mode-tag ${isTutor ? "tutor-tag" : "agent-tag"}`}>
              {isTutor ? (
                <>
                  <GraduationCap size={11} /> 靶场导师
                </>
              ) : (
                <>
                  <Wrench size={11} /> 执行 Agent
                </>
              )}
            </span>
            {message.data?.model && (
              <span className="model-chip mono">{String(message.data.model)}</span>
            )}
            {isTutor && message.data?.item_key && (
              <span className="meta-chip">{itemLabel(String(message.data.item_key))}</span>
            )}
            {isTutor && message.data?.hint_level ? (
              <span className="meta-chip">提示 L{String(message.data.hint_level)}</span>
            ) : null}
            {stopped && <span className="meta-chip stopped">已停止</span>}
          </span>
        )}

        {!isError && reasoning.trim() && (
          <ReasoningBlock text={reasoning} streaming={streaming} />
        )}

        {!isError && plan && plan.steps.length > 0 && (
          <PlanCard plan={plan} streaming={streaming} />
        )}

        {!isError && hasTool && (
          <div className="tool-call-list">
            {tools.map((tool) => (
              <ToolCallCard
                key={tool.id}
                tool={tool}
                live={streaming}
                onOpenMatrix={onOpenMatrix}
                onOpenFindings={onOpenFindings}
                onOpenReport={onOpenReport}
              />
            ))}
          </div>
        )}

        {showThinking && (
          <div className="agent-thinking">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="agent-thinking-text">
              {isTutor ? "导师正在思考" : "正在思考"} · {elapsed}s
            </span>
          </div>
        )}

        {isError ? (
          <div className="bubble-markdown markdown-body">
            {message.content}
          </div>
        ) : (
          <div
            className="bubble-markdown markdown-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        )}
        {streaming && (
          <span className="stream-status">
            {message.content.trim() ? (
              <>
                <span className="stream-caret" />
                正在输出 · {elapsed}s
              </>
            ) : (
              <>思考中 · {elapsed}s</>
            )}
          </span>
        )}

        <div className="bubble-time">{formatTime(message.created_at)}</div>

        {!streaming && message.content.trim() !== "" && !isError && (
          <div className="msg-actions">
            <button
              type="button"
              className="msg-action"
              onClick={() => void handleCopyMessage()}
            >
              <Copy size={12} />
              {copied ? "已复制" : "复制"}
            </button>
          </div>
        )}

        {isTutor && message.kind !== "error" && message.data?.item_key && onTutorAction && (
          <div className="bubble-actions tutor-actions">
            {[
              { level: 1, label: "提示①" },
              { level: 2, label: "提示②" },
              { level: 3, label: "提示③" },
            ].map((item) => (
              <button
                key={item.level}
                className="btn tiny"
                onClick={() =>
                  onTutorAction(
                    `给我第 ${item.level} 层提示（${
                      item.level === 1
                        ? "只给方向，不要给具体方法"
                        : item.level === 2
                          ? "给判断方法和步骤，但别给完整 payload"
                          : "给关键 payload 结构，留最后一步我自己做"
                    }）`,
                    { item_key: message.data.item_key, hint_level: item.level },
                  )
                }
              >
                {item.label}
              </button>
            ))}
            <button
              className="btn tiny"
              onClick={() =>
                onTutorAction("直接给我完整解法和 payload，并逐行解释", {
                  item_key: message.data.item_key,
                  hint_level: 4,
                })
              }
            >
              给答案
            </button>
            <button
              className="btn tiny primary"
              onClick={() =>
                onTutorAction("我懂了，帮我总结这一关的核心知识点和防御要点", {
                  item_key: message.data.item_key,
                  mark_solved: true,
                })
              }
            >
              我懂了 ✓
            </button>
          </div>
        )}

        {summary && message.kind === "scan_summary" && (
          <div className="severity-grid">
            {(["Critical", "High", "Medium", "Low", "Info"] as const).map((severity) => {
              const labels: Record<string, string> = {
                Critical: "严重",
                High: "高危",
                Medium: "中危",
                Low: "低危",
                Info: "信息",
              };
              const classes: Record<string, string> = {
                Critical: "sev-critical",
                High: "sev-high",
                Medium: "sev-medium",
                Low: "sev-low",
                Info: "sev-info",
              };
              const count = Number(summary[severity] ?? 0);
              if (!count) return null;
              return (
                <div key={severity} className={`severity-cell ${classes[severity]}`}>
                  <span>{labels[severity]}</span>
                  <b>{count}</b>
                </div>
              );
            })}
          </div>
        )}

        {summary && message.kind !== "scan_summary" && (
          <div className="summary-grid">
            <div className="summary-cell">
              <span>已拿下</span>
              <b className="ok">{String(summary.exploited ?? 0)}</b>
            </div>
            <div className="summary-cell">
              <span>已防御</span>
              <b className="info">{String(summary.protected ?? 0)}</b>
            </div>
            <div className="summary-cell">
              <span>失败</span>
              <b className="bad">{String(summary.failed ?? 0)}</b>
            </div>
            <div className="summary-cell">
              <span>覆盖率</span>
              <b>{String(summary.coverage ?? 0)}%</b>
            </div>
          </div>
        )}

        {(actions.length > 0 || runCard) && (
          <div className="bubble-actions">
            {actions.includes("findings") && (
              <button
                className="btn tiny"
                onClick={() => onOpenFindings(message.data?.run_id)}
              >
                ▦ 查看发现
              </button>
            )}
            {actions.includes("matrix") && (
              <button
                className="btn tiny"
                onClick={() => onOpenMatrix(message.data?.run_id)}
              >
                ▦ 查看矩阵
              </button>
            )}
            {actions.includes("report") && (
              <button className="btn tiny" onClick={onOpenReport}>
                ▤ 打开报告
              </button>
            )}
          </div>
        )}

        {runCard && ["running", "pending", "cancelling"].includes(runCard.status) && (
          <RunCard run={runCard} onOpenMatrix={() => onOpenMatrix(runCard.run_id)} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 思考过程折叠 */
function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);

  useEffect(() => {
    setOpen(streaming);
  }, [streaming]);

  return (
    <div className={`reasoning-block ${open ? "open" : ""}`}>
      <button
        type="button"
        className="reasoning-head"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <Brain size={12} />
        <span>思考过程</span>
        <span className="reasoning-meta">
          {streaming ? "正在思考…" : `${text.length} 字`}
        </span>
        <ChevronRight size={12} className={`reasoning-caret ${open ? "open" : ""}`} />
      </button>
      {open && <div className="reasoning-body">{text}</div>}
    </div>
  );
}

/* ------------------------------------------------------------ 执行计划清单 */
function PlanCard({ plan, streaming }: { plan: PlanState; streaming: boolean }) {
  const total = plan.steps.length;
  const done = streaming ? 0 : total;
  return (
    <div className="plan-card">
      <div className="plan-head">
        <ListChecks size={13} />
        <span>执行计划</span>
        <span className="plan-progress">
          {done}/{total}
        </span>
      </div>
      <ol className="plan-steps">
        {plan.steps.map((step, index) => {
          const active = streaming && index === 0;
          const complete = streaming ? false : true;
          return (
            <li
              key={`${index}-${step.text}`}
              className={`plan-step ${complete ? "done" : active ? "active" : "pending"}`}
            >
              <span className="plan-mark">{complete ? "✓" : active ? "•" : "○"}</span>
              <span>{step.text}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ 工具函数 */
function useElapsedSeconds(active: boolean, startIso: string | undefined): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const start = startIso ? new Date(startIso).getTime() : Date.now();
    const tick = () => {
      const diff = Math.max(0, Math.round((Date.now() - start) / 1000));
      setSeconds(diff);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active, startIso]);

  return seconds;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* 降级方案：老浏览器 / 非安全上下文 */
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(area);
  }
}

function itemLabel(itemKey: string): string {
  const parts = itemKey.split(":");
  if (parts[0] === "dvwa" && parts.length === 3) {
    const moduleTitles: Record<string, string> = {
      brute: "暴力破解",
      exec: "命令注入",
      fi: "文件包含",
      upload: "文件上传",
      sqli: "SQL 注入",
      sqli_blind: "SQL 盲注",
      csrf: "CSRF",
      captcha: "验证码",
      weak_id: "弱会话",
      xss_d: "DOM XSS",
      xss_r: "反射 XSS",
      xss_s: "存储 XSS",
      csp: "CSP",
      javascript: "JS 攻击",
      open_redirect: "重定向",
      authbypass: "越权",
      bac: "访问控制",
      cryptography: "密码学",
      api: "API",
    };
    return `DVWA ${moduleTitles[parts[1]] ?? parts[1]} ${parts[2]}`;
  }
  if (parts[0] === "sqli" && parts.length === 2) {
    return `SQLi ${parts[1]}`;
  }
  return itemKey;
}

export const _statusMeta = statusMeta;
