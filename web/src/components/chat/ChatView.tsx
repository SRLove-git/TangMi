import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  Bug,
  FileText,
  FlaskConical,
  Gauge,
  GraduationCap,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Plus,
  Radar,
  Search,
  Shield,
  ShieldCheck,
  Square,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  ChatMode,
  ConversationState,
  Project,
  RunLive,
  SystemInfo,
} from "../../types";
import Composer from "./Composer";
import LabContextModal from "./LabContextModal";
import MessageItem from "./MessageItem";
import RunCard from "./RunCard";

interface PromptCard {
  title: string;
  desc: string;
  prompt: string;
  icon: LucideIcon;
}

interface Props {
  project: Project | null;
  conversation: ConversationState | null;
  runCards: Record<string, RunLive>;
  system: SystemInfo | null;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  onCreateConversation: () => void;
  onSend: (text: string, data?: Record<string, unknown>) => void;
  onCancel: () => void;
  onOpenMatrix: (runId?: string) => void;
  onOpenFindings: (runId?: string) => void;
  onOpenReport: () => void;
}

const SUGGESTIONS = [
  "全量验证",
  "检查状态",
  "跑一下 DVWA",
  "跑 SQLi-Labs 1-10",
  "重置数据库",
];

const WEB_SUGGESTIONS = ["扫描一下", "只做信息收集", "全量扫描", "结果怎么样", "检查状态"];

const TUTOR_SUGGESTIONS = [
  "这道题先给我提示",
  "讲讲原理",
  "为什么我的 payload 不通",
  "直接给答案并解释",
];

const TUTOR_PROMPT_CARDS: PromptCard[] = [
  {
    title: "给我提示（不剧透）",
    desc: "卡住时先要思路和下一步，完整答案自己找",
    prompt: "这道题我不会，先给我提示，不要直接给答案",
    icon: Lightbulb,
  },
  {
    title: "讲解原理",
    desc: "把漏洞成因、利用条件和防御讲透",
    prompt: "讲讲这个漏洞的原理、利用条件和常见防御方式",
    icon: BookOpen,
  },
  {
    title: "分析失败原因",
    desc: "贴报错 / 无回显，导师带你逐项排查",
    prompt: "我的 payload 没打通，帮我分析可能的原因和排查步骤",
    icon: Bug,
  },
  {
    title: "要完整解法",
    desc: "明确要求时才给完整步骤 + 逐行解释",
    prompt: "直接给我完整解法和 payload，并解释每一步为什么这么构造",
    icon: ListChecks,
  },
];

const PROMPT_CARDS: PromptCard[] = [
  {
    title: "全量验收",
    desc: "DVWA + SQLi-Labs 一键跑完并生成报告",
    prompt: "全量验证",
    icon: Zap,
  },
  {
    title: "DVWA 单靶场",
    desc: "19 个模块 × 4 个难度自动通关",
    prompt: "跑一下 DVWA 全部难度",
    icon: Shield,
  },
  {
    title: "SQLi-Labs 指定关卡",
    desc: "支持 1-10、25a、46-53 等范围写法",
    prompt: "跑 SQLi-Labs 1-10",
    icon: FlaskConical,
  },
  {
    title: "检查靶场状态",
    desc: "查看 Docker / HTTP / 镜像就绪情况",
    prompt: "检查状态",
    icon: Activity,
  },
];

const WEB_PROMPT_CARDS: PromptCard[] = [
  {
    title: "扫描当前目标",
    desc: "信息收集 + 配置/敏感文件 + 常见漏洞检测",
    prompt: "扫描一下",
    icon: Radar,
  },
  {
    title: "只做信息收集",
    desc: "指纹 / 端口 / 爬虫 / 安全头，不发攻击载荷",
    prompt: "只做信息收集",
    icon: Search,
  },
  {
    title: "全量深度扫描",
    desc: "深度爬取 + 时间盲注 + 默认口令检测",
    prompt: "全量扫描",
    icon: Gauge,
  },
  {
    title: "查看最近发现",
    desc: "汇总风险等级与主要漏洞",
    prompt: "结果怎么样",
    icon: ListChecks,
  },
];

export default function ChatView({
  project,
  conversation,
  runCards,
  system,
  mode,
  onModeChange,
  onCreateConversation,
  onSend,
  onCancel,
  onOpenMatrix,
  onOpenFindings,
  onOpenReport,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showLabPicker, setShowLabPicker] = useState(false);
  const messages = conversation?.messages ?? [];
  const activeCards = Object.values(runCards).filter((card) =>
    ["running", "pending", "cancelling"].includes(card.status),
  );
  const busy = conversation?.busy ?? false;
  const typing =
    busy &&
    activeCards.length === 0 &&
    messages.length > 0 &&
    messages[messages.length - 1]?.role === "user";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy, activeCards.length, messages[messages.length - 1]?.content]);

  const promptCards =
    mode === "tutor"
      ? TUTOR_PROMPT_CARDS
      : project?.lab === "web"
        ? WEB_PROMPT_CARDS
        : PROMPT_CARDS;
  const suggestions =
    mode === "tutor"
      ? TUTOR_SUGGESTIONS
      : project?.lab === "web"
        ? WEB_SUGGESTIONS
        : SUGGESTIONS;
  const tutorReady = system?.llm_configured;
  const isWebTarget = project?.lab === "web" || project?.lab === "unknown";
  const lastMessage = messages[messages.length - 1];
  const lastRunId =
    conversation?.last_run_id ??
    ([...messages].reverse().find((message) => message.data?.run_id)?.data?.run_id as
      | string
      | undefined);

  if (!project) {
    return (
      <main className="chat-main">
        <div className="chat-welcome">
          <div className="welcome-mark">
            <ShieldCheck />
          </div>
          <span className="eyebrow">本地授权安全评估</span>
          <h1>左侧选择或新建一个项目</h1>
          <p>一个项目对应一个授权目标（DVWA / SQLi-Labs / 任意 Web 地址），项目内可以开启多个对话。</p>
        </div>
      </main>
    );
  }

  const projectReady =
    project.lab === "dvwa"
      ? system?.lab_http.dvwa
      : project.lab === "sqli-labs"
        ? system?.lab_http.sqli_labs
        : undefined;

  function renderPromptCards() {
    return (
      <div className="prompt-cards">
        {promptCards.map((card) => {
          const Icon = card.icon;
          return (
            <button key={card.title} className="prompt-card" onClick={() => onSend(card.prompt)}>
              <span className="prompt-icon">
                <Icon />
              </span>
              <span className="prompt-title">{card.title}</span>
              <span className="prompt-desc">{card.desc}</span>
              <span className="prompt-example">{card.prompt}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <main className="chat-main">
      <header className="chat-header">
        <div className="chat-title-group">
          <span className="chat-eyebrow">当前目标 · {project.lab}</span>
          <div className="chat-title-row">
            <h2>{project.name}</h2>
            {projectReady != null && (
              <span className={`status-dot ${projectReady ? "up" : "down"}`}>
                {projectReady ? "已就绪" : "未启动"}
              </span>
            )}
          </div>
          <div className="chat-subtitle mono">{project.target}</div>
        </div>

        <div className="chat-actions">
          {busy && (
            <button className="btn danger tiny" onClick={onCancel}>
              <Square size={12} />
              停止
            </button>
          )}
          {mode === "tutor" && (project.lab === "dvwa" || project.lab === "sqli-labs") && (
            <button
              className="btn tiny"
              onClick={() => setShowLabPicker(true)}
              title="选择当前关卡，导师会读取真实页面与源码"
            >
              <Search size={13} />
              读取关卡
            </button>
          )}
          {isWebTarget ? (
            <button className="btn tiny" onClick={() => onOpenFindings(lastRunId)}>
              <ListChecks size={13} />
              发现
            </button>
          ) : (
            <button className="btn tiny" onClick={() => onOpenMatrix(lastRunId)}>
              <LayoutGrid size={13} />
              矩阵
            </button>
          )}
          <button className="btn tiny" onClick={onOpenReport}>
            <FileText size={13} />
            报告
          </button>
          <button className="btn primary tiny" onClick={onCreateConversation}>
            <Plus size={13} />
            新对话
          </button>
        </div>
      </header>

      <div className="chat-body">
        {!conversation ? (
          <div className="chat-welcome">
            <div className="welcome-mark">
              {mode === "tutor" ? <GraduationCap /> : <ShieldCheck />}
            </div>
            <span className="eyebrow">
              {mode === "tutor" ? "AI 教学模式 · 靶场导师" : "本地授权安全评估"}
            </span>
            <h1>{mode === "tutor" ? "卡住了？直接问导师" : "今天想打哪个靶场？"}</h1>
            <p>
              {mode === "tutor"
                ? "我像实验课助教一样陪你做靶场：先给思路和提示，不直接剧透；贴报错、贴现象、要原理解析都可以。首次使用请在「设置 → AI 教学模型」配置一次。"
                : "用自然语言告诉我目标与范围，我会自动调用靶场管理、渗透扫描与报告工具，并实时汇报进度。"}
            </p>
            {renderPromptCards()}
            <button className="btn primary" onClick={onCreateConversation}>
              <Plus size={15} />
              开始新对话
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-welcome compact">
            <div className="welcome-mark">
              {mode === "tutor" ? <GraduationCap /> : <ShieldCheck />}
            </div>
            <span className="eyebrow">{mode === "tutor" ? "教学模式" : "新对话"}</span>
            <h1>{project.name}</h1>
            <p>
              {mode === "tutor"
                ? "遇到不会的关卡、看不懂的报错、想不通的 payload，直接输入问题即可。"
                : "直接输入指令，或选择下方推荐任务开始。"}
            </p>
            {renderPromptCards()}
          </div>
        ) : (
          <div className="messages">
            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                runCards={runCards}
                onOpenMatrix={onOpenMatrix}
                onOpenFindings={onOpenFindings}
                onOpenReport={onOpenReport}
                onTutorAction={(text, data) => onSend(text, data)}
              />
            ))}

            {activeCards.map((card) => (
              <div className="chat-row assistant" key={card.run_id}>
                <div className="avatar agent-avatar">◆</div>
                <div className="bubble agent-bubble run-bubble">
                  <RunCard run={card} onOpenMatrix={() => onOpenMatrix(card.run_id)} />
                </div>
              </div>
            ))}

            {typing && (
              <div className="chat-row assistant">
                <div className={`avatar agent-avatar ${mode === "tutor" ? "tutor-avatar" : ""}`}>
                  {mode === "tutor" ? <GraduationCap size={15} /> : "◆"}
                </div>
                <div className="bubble agent-bubble typing-bubble">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-text">
                    {mode === "tutor" ? "导师正在思考…" : "正在思考并按计划执行…"}
                  </span>
                </div>
              </div>
            )}
            {lastMessage && <div ref={bottomRef} />}
          </div>
        )}
      </div>

      <Composer
        busy={busy}
        mode={mode}
        onModeChange={onModeChange}
        onSend={onSend}
        suggestions={suggestions}
        tutorReady={tutorReady}
      />

      {showLabPicker && project && (
        <LabContextModal
          project={project}
          onClose={() => setShowLabPicker(false)}
          onPick={(itemKey, title) => {
            setShowLabPicker(false);
            onSend(
              `读取 ${title} 的当前页面和源码，先给我第 1 层提示，不要直接给答案`,
              { item_key: itemKey },
            );
          }}
        />
      )}
    </main>
  );
}
