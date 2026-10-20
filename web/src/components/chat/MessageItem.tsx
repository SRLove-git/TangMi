import { GraduationCap, Sparkles } from "lucide-react";
import type { ChatMessage, RunLive } from "../../types";
import { formatTime, renderMarkdown, statusMeta } from "../../utils";
import RunCard from "./RunCard";

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

  return (
    <div className="chat-row assistant">
      <div className={`avatar agent-avatar ${isTutor ? "tutor-avatar" : ""}`}>
        {isTutor ? <GraduationCap size={15} /> : <Sparkles size={15} />}
      </div>
      <div
        className={`bubble agent-bubble ${message.kind === "error" ? "error" : ""} ${
          isTutor && message.kind !== "error" ? "tutor-bubble" : ""
        }`}
      >
        {isTutor && message.kind !== "error" && (
          <span className="mode-tag tutor-tag">
            <GraduationCap size={11} /> 靶场导师
            {message.data?.item_key ? ` · ${itemLabel(String(message.data.item_key))}` : ""}
            {message.data?.hint_level ? ` · 提示L${message.data.hint_level}` : ""}
            {message.data?.model ? ` · ${String(message.data.model)}` : ""}
          </span>
        )}
        <div
          className="bubble-markdown markdown-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
        />
        <div className="bubble-time">{formatTime(message.created_at)}</div>

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
