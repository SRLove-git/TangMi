import { useEffect, useRef, useState } from "react";
import { ArrowUp, GraduationCap, Wrench } from "lucide-react";
import type { ChatMode } from "../../types";

interface Props {
  busy: boolean;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  onSend: (text: string) => void;
  suggestions: string[];
  /** AI 教学模式是否已配置好 LLM（未配置时在切换处给出提示） */
  tutorReady?: boolean;
}

const PLACEHOLDER: Record<ChatMode, string> = {
  agent: "直接说目标，Agent 会思考并调用工具，例如：先检查靶场状态，再跑一轮 DVWA low 难度",
  tutor: "直接提问，导师会先读取当前关卡再回答，例如：Less-5 我判断不出闭合方式，先给我提示",
};

const BUSY_PLACEHOLDER: Record<ChatMode, string> = {
  agent: "Agent 正在思考 / 调用工具，可点击右上角「停止」中断…",
  tutor: "导师正在读取关卡 / 思考，可点击右上角「停止」中断…",
};

export default function Composer({
  busy,
  mode,
  onModeChange,
  onSend,
  suggestions,
  tutorReady,
}: Props) {
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(180, area.scrollHeight)}px`;
  }, [text]);

  function submit() {
    const content = text.trim();
    if (!content || busy) return;
    onSend(content);
    setText("");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer">
      <div className="suggestion-row">
        <div className="mode-switch" role="tablist" aria-label="对话模式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "agent"}
            className={`mode-option ${mode === "agent" ? "active" : ""}`}
            onClick={() => onModeChange("agent")}
            title="执行模式：像 Codex 一样用自然语言指挥 Agent 调用扫描 / 靶场 / 报告工具"
          >
            <Wrench size={12} />
            执行模式
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "tutor"}
            className={`mode-option ${mode === "tutor" ? "active" : ""}`}
            onClick={() => onModeChange("tutor")}
            title="教学模式：AI 导师先读取真实关卡上下文，再讲思路、给分层提示"
          >
            <GraduationCap size={12} />
            教学模式
            {mode === "tutor" && tutorReady === false && (
              <span className="mode-badge" title="尚未配置 AI 教学模型，点击顶部「设置」配置">
                待配置
              </span>
            )}
          </button>
        </div>
        <span className="suggestion-divider" />
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            className="suggestion-chip"
            onClick={() => setText(suggestion)}
            disabled={busy}
          >
            {suggestion}
          </button>
        ))}
      </div>
      <div className="composer-box">
        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          placeholder={busy ? BUSY_PLACEHOLDER[mode] : PLACEHOLDER[mode]}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        <button className="send-btn" onClick={submit} disabled={busy || !text.trim()}>
          <ArrowUp size={15} />
          {busy ? (mode === "tutor" ? "回答中" : "执行中") : mode === "tutor" ? "提问" : "发送"}
        </button>
      </div>
      <div className="composer-hint">
        {mode === "tutor"
          ? "教学模式：默认只讲思路不剧透，明确说「直接给答案」才会给完整解法 · Enter 发送"
          : "Enter 发送 · Shift + Enter 换行 · Agent 会自动调用工具 · 仅限本地授权靶场"}
      </div>
    </div>
  );
}
