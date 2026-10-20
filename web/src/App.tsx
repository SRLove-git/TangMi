import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamConversation } from "./api";
import CommandPalette from "./components/CommandPalette";
import ChatView from "./components/chat/ChatView";
import FindingsModal from "./components/chat/FindingsModal";
import MatrixModal from "./components/chat/MatrixModal";
import NewProjectModal from "./components/chat/NewProjectModal";
import ReportModal from "./components/chat/ReportModal";
import Sidebar from "./components/chat/Sidebar";
import TopBar from "./components/chat/TopBar";
import DeployView from "./components/views/DeployView";
import LearningView from "./components/views/LearningView";
import RecordsView from "./components/views/RecordsView";
import RepeaterView from "./components/views/RepeaterView";
import SettingsView from "./components/views/SettingsView";
import FindingDrawer from "./components/FindingDrawer";
import type {
  AppView,
  ChatEvent,
  ChatMessage,
  ChatMode,
  ConversationState,
  DeployLab,
  Finding,
  Project,
  RunLive,
  SystemInfo,
} from "./types";

type OverlayState =
  | { type: "matrix"; runId?: string }
  | { type: "findings"; runId?: string }
  | { type: "report" }
  | null;

export default function App() {
  const [view, setView] = useState<AppView>("chat");
  const [projects, setProjects] = useState<Project[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationState | null>(null);
  const [runCards, setRunCards] = useState<Record<string, RunLive>>({});
  const [overlay, setOverlay] = useState<OverlayState>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [learningFocus, setLearningFocus] = useState<string | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ChatMode>(() => {
    try {
      return window.localStorage.getItem("pa-chat-mode") === "tutor" ? "tutor" : "agent";
    } catch {
      return "agent";
    }
  });

  const changeMode = useCallback((next: ChatMode) => {
    setMode(next);
    try {
      window.localStorage.setItem("pa-chat-mode", next);
    } catch {
      /* ignore */
    }
  }, []);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = window.localStorage.getItem("pa-theme");
      if (saved === "light" || saved === "dark") return saved;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("theme-transition");
    root.classList.toggle("dark", theme === "dark");
    try {
      window.localStorage.setItem("pa-theme", theme);
    } catch {
      /* ignore */
    }
    const timer = setTimeout(() => root.classList.remove("theme-transition"), 280);
    return () => clearTimeout(timer);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  }, []);

  // ⌘K / Ctrl+K 打开全局命令面板
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowPalette((current) => !current);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const lastSeqRef = useRef(0);
  const closeStreamRef = useRef<(() => void) | null>(null);
  const conversationRef = useRef<ConversationState | null>(null);

  conversationRef.current = conversation;

  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3600);
    return () => clearTimeout(timer);
  }, [toast]);

  const refreshSystem = useCallback(async () => {
    try {
      setSystem(await api.system());
    } catch {
      /* ignore */
    }
  }, []);

  const refreshProjects = useCallback(async (): Promise<Project[]> => {
    try {
      const data = await api.projects();
      setProjects(data.projects);
      return data.projects;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }, []);

  // ------------------------------------------------------------- 事件流
  const applyChatEvent = useCallback((event: ChatEvent) => {
    if (event.seq !== -1) {
      if (event.seq <= lastSeqRef.current) return;
      lastSeqRef.current = event.seq;
    }
    if (event.type === "message") {
      const message = event.payload as unknown as ChatMessage;
      setConversation((prev) => {
        if (!prev) return prev;
        const index = prev.messages.findIndex((item) => item.id === message.id);
        const messages =
          index >= 0
            ? prev.messages.map((item) => (item.id === message.id ? message : item))
            : [...prev.messages, message];
        return { ...prev, messages };
      });
    } else if (event.type === "delta") {
      const payload = event.payload as { message_id: string; text: string };
      setConversation((prev) => {
        if (!prev) return prev;
        const index = prev.messages.findIndex((item) => item.id === payload.message_id);
        if (index < 0) {
          return {
            ...prev,
            messages: [
              ...prev.messages,
              {
                id: payload.message_id,
                role: "assistant",
                content: payload.text,
                kind: "text",
                created_at: new Date().toISOString(),
                data: {},
              },
            ],
          };
        }
        return {
          ...prev,
          messages: prev.messages.map((item, itemIndex) =>
            itemIndex === index ? { ...item, content: item.content + payload.text } : item,
          ),
        };
      });
    } else if (event.type === "run") {
      const payload = event.payload as Record<string, unknown>;
      const runId = String(payload.run_id ?? "");
      if (!runId) return;
      setRunCards((prev) => {
        const existing: RunLive =
          prev[runId] ?? {
            run_id: runId,
            status: "running",
            progress: { done: 0, total: 0, percent: 0 },
            findings_count: 0,
            logs: [],
          };
        return {
          ...prev,
          [runId]: {
            ...existing,
            ...(payload as Partial<RunLive>),
            logs: existing.logs ?? [],
          },
        };
      });
    } else if (event.type === "run_log") {
      const payload = event.payload as {
        run_id: string;
        message: string;
        level: string;
      };
      setRunCards((prev) => {
        const existing = prev[payload.run_id];
        if (!existing) return prev;
        return {
          ...prev,
          [payload.run_id]: {
            ...existing,
            logs: [
              ...existing.logs,
              { level: payload.level, message: payload.message },
            ].slice(-120),
          },
        };
      });
    } else if (event.type === "turn") {
      const busy = Boolean((event.payload as { busy?: boolean }).busy);
      setConversation((prev) => (prev ? { ...prev, busy } : prev));
    }
  }, []);

  const closeStream = useCallback(() => {
    closeStreamRef.current?.();
    closeStreamRef.current = null;
  }, []);

  const subscribe = useCallback(
    (conversationId: string, after: number) => {
      closeStream();
      closeStreamRef.current = streamConversation(conversationId, after, {
        onEvent: applyChatEvent,
        onEnd: () => {
          setConversation((prev) => (prev ? { ...prev, busy: false } : prev));
          void (async () => {
            try {
              const latest = await api.conversation(conversationId);
              setConversation((prev) => (prev && prev.id === latest.id ? latest : prev));
            } catch {
              /* ignore */
            }
            await refreshProjects();
            await refreshSystem();
          })();
        },
        onError: () => setError("实时连接中断，可刷新页面恢复"),
      });
    },
    [applyChatEvent, closeStream, refreshProjects, refreshSystem],
  );

  // ------------------------------------------------------------- 初始化
  useEffect(() => {
    void (async () => {
      const [projectData, sys] = await Promise.all([api.projects(), api.system()]);
      setProjects(projectData.projects);
      setSystem(sys);
      const first = projectData.projects[0];
      if (first) {
        setActiveProjectId(first.id);
        if (first.conversations.length > 0) {
          void openConversation(first.conversations[0].id);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refreshSystem(), 15000);
    return () => clearInterval(timer);
  }, [refreshSystem]);

  // ------------------------------------------------------------- 会话操作
  async function openConversation(conversationId: string) {
    closeStream();
    try {
      const state = await api.conversation(conversationId);
      setConversation(state);
      setActiveConversationId(conversationId);
      setActiveProjectId(state.project_id);
      setRunCards({});
      lastSeqRef.current = state.seq;
      if (state.busy) {
        subscribe(conversationId, state.seq);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function selectProject(projectId: string) {
    setActiveProjectId(projectId);
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    if (project.conversations.length > 0) {
      void openConversation(project.conversations[0].id);
    } else {
      closeStream();
      setConversation(null);
      setActiveConversationId(null);
    }
  }

  async function createConversation() {
    const projectId = activeProjectId ?? projects[0]?.id;
    if (!projectId) {
      setShowNewProject(true);
      return;
    }
    try {
      const state = await api.createConversation(projectId);
      setConversation(state);
      setActiveConversationId(state.id);
      setActiveProjectId(projectId);
      lastSeqRef.current = state.seq;
      setRunCards({});
      await refreshProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteConversation(conversationId: string) {
    if (!window.confirm("确定删除这个会话吗？")) return;
    try {
      await api.deleteConversation(conversationId);
      const data = await refreshProjects();
      if (activeConversationId === conversationId) {
        const project = data.find((item) => item.id === activeProjectId);
        if (project && project.conversations.length > 0) {
          void openConversation(project.conversations[0].id);
        } else {
          closeStream();
          setConversation(null);
          setActiveConversationId(null);
        }
      }
      notify("会话已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteProject(projectId: string) {
    if (!window.confirm("删除项目会同时删除其中的所有会话，确定吗？")) return;
    try {
      await api.deleteProject(projectId);
      const data = await refreshProjects();
      if (activeProjectId === projectId) {
        closeStream();
        setConversation(null);
        setActiveConversationId(null);
        const next = data[0];
        setActiveProjectId(next?.id ?? null);
        if (next && next.conversations.length > 0) {
          void openConversation(next.conversations[0].id);
        }
      }
      notify("项目已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createProject(name: string, target: string) {
    const { project } = await api.createProject(name, target);
    const data = await refreshProjects();
    const created = data.find((item) => item.id === project.id) ?? project;
    setActiveProjectId(created.id);
    const state = await api.createConversation(created.id);
    setConversation(state);
    setActiveConversationId(state.id);
    lastSeqRef.current = state.seq;
    setRunCards({});
    notify(`项目「${created.name}」已创建（识别为 ${created.lab}）`);
  }

  // ------------------------------------------------------------- 发送消息
  async function sendMessage(
    text: string,
    data?: Record<string, unknown>,
    modeOverride?: ChatMode,
  ) {
    setError("");
    const effectiveMode = modeOverride ?? mode;
    let target = conversationRef.current;
    if (!target) {
      const projectId = activeProjectId ?? projects[0]?.id;
      if (!projectId) {
        setShowNewProject(true);
        return;
      }
      try {
        target = await api.createConversation(projectId);
        setConversation(target);
        setActiveConversationId(target.id);
        setActiveProjectId(projectId);
        lastSeqRef.current = target.seq;
        setRunCards({});
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    try {
      const response = await api.sendMessage(target.id, text, effectiveMode, data);
      setConversation((prev) => {
        const base = prev && prev.id === target?.id ? prev : target;
        if (!base) return prev;
        return {
          ...base,
          busy: true,
          title: base.title === "新对话" ? text.slice(0, 28) : base.title,
          messages: [...base.messages, response.message],
        };
      });
      lastSeqRef.current = response.seq;
      subscribe(target.id, response.seq);
      void refreshProjects();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }

  /** 学习页 / 关卡详情：切到教学模式并直接发问。 */
  async function askTutor(text: string, data?: Record<string, unknown>) {
    changeMode("tutor");
    setView("chat");
    await sendMessage(text, data, "tutor");
  }

  /** 部署页：把运行中的靶场一键加入工作台并打开对话。 */
  async function useDeployedLab(lab: DeployLab) {
    const target = lab.runtime.url || "";
    if (!target.startsWith("http")) {
      notify("该靶场没有 HTTP 地址，可在「重放器」里直接连接");
      return;
    }
    try {
      const { project } = await api.createProject(lab.name, target);
      const data = await refreshProjects();
      const created = data.find((item) => item.id === project.id) ?? project;
      setActiveProjectId(created.id);
      const state = await api.createConversation(created.id);
      setView("chat");
      setConversation(state);
      setActiveConversationId(state.id);
      lastSeqRef.current = state.seq;
      setRunCards({});
      notify(`已创建项目「${created.name}」，可直接说「扫描一下」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelCurrent() {
    if (!conversationRef.current) return;
    try {
      const result = await api.cancelConversation(conversationRef.current.id);
      notify(result.cancelled ? "已发送停止请求" : "当前没有可停止的任务");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const activeProject = projects.find((item) => item.id === activeProjectId) ?? null;

  return (
    <div className="chat-app">
      <TopBar
        theme={theme}
        onToggleTheme={toggleTheme}
        system={system}
        onNewProject={() => setShowNewProject(true)}
        onOpenPalette={() => setShowPalette(true)}
        view={view}
        onNavigate={setView}
      />
      <div className="workspace">
        <Sidebar
          projects={projects}
          system={system}
          activeProjectId={activeProjectId}
          activeConversationId={activeConversationId}
          onSelectProject={selectProject}
          onSelectConversation={(id) => void openConversation(id)}
          onCreateProject={() => setShowNewProject(true)}
          onCreateConversation={() => void createConversation()}
          onDeleteProject={(id) => void deleteProject(id)}
          onDeleteConversation={(id) => void deleteConversation(id)}
          onOpenReport={() => setOverlay({ type: "report" })}
          showConversations={view === "chat"}
        />

        {view !== "chat" ? (
          <div className="platform-content">
            {view === "deploy" && (
              <DeployView onUseAsProject={(lab) => void useDeployedLab(lab)} />
            )}
            {view === "learning" && (
              <LearningView
                onAskTutor={(text, data) => void askTutor(text, data)}
                focusKey={learningFocus}
                onFocusConsumed={() => setLearningFocus(null)}
              />
            )}
            {view === "repeater" && <RepeaterView />}
            {view === "records" && (
              <RecordsView
                activeProject={activeProject}
                onOpenRun={(runId, lab) =>
                  setOverlay({
                    type: lab === "web" || lab === "generic" ? "findings" : "matrix",
                    runId,
                  })
                }
                onGoChat={() => setView("chat")}
              />
            )}
            {view === "settings" && (
              <SettingsView project={activeProject} onSaved={refreshProjects} />
            )}
          </div>
        ) : (
          <ChatView
            project={activeProject}
            conversation={conversation}
            runCards={runCards}
            system={system}
            mode={mode}
            onModeChange={changeMode}
            onCreateConversation={() => void createConversation()}
            onSend={(text, data) => void sendMessage(text, data)}
            onCancel={() => void cancelCurrent()}
            onOpenMatrix={(runId) => setOverlay({ type: "matrix", runId })}
            onOpenFindings={(runId) => setOverlay({ type: "findings", runId })}
            onOpenReport={() => setOverlay({ type: "report" })}
          />
        )}
      </div>

      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        onNavigate={(next) => {
          setView(next);
          setShowPalette(false);
        }}
        onOpenLearningItem={(itemKey) => {
          setLearningFocus(itemKey);
          setView("learning");
          setShowPalette(false);
        }}
      />

      <NewProjectModal
        open={showNewProject}
        onClose={() => setShowNewProject(false)}
        onCreate={createProject}
        onGoDeploy={() => setView("deploy")}
      />

      {overlay?.type === "matrix" && (
        <MatrixModal
          runId={overlay.runId}
          onClose={() => setOverlay(null)}
          onSelectFinding={setSelectedFinding}
        />
      )}
      {overlay?.type === "findings" && (
        <FindingsModal
          runId={overlay.runId}
          onClose={() => setOverlay(null)}
          onSelectFinding={setSelectedFinding}
        />
      )}
      {overlay?.type === "report" && <ReportModal onClose={() => setOverlay(null)} />}

      <FindingDrawer finding={selectedFinding} onClose={() => setSelectedFinding(null)} />

      {error && (
        <div className="chat-error">
          <span>{error}</span>
          <button className="icon-btn" onClick={() => setError("")}>
            ✕
          </button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
