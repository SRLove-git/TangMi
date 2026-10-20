import {
  FileText,
  FlaskConical,
  Folder,
  Globe,
  MessageSquare,
  Plus,
  Shield,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Project, SystemInfo } from "../../types";

interface Props {
  projects: Project[];
  system: SystemInfo | null;
  activeProjectId: string | null;
  activeConversationId: string | null;
  onSelectProject: (id: string) => void;
  onSelectConversation: (id: string) => void;
  onCreateProject: () => void;
  onCreateConversation: () => void;
  onDeleteProject: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onOpenReport: () => void;
  showConversations?: boolean;
}

const LAB_ICONS: Record<string, LucideIcon> = {
  dvwa: Shield,
  "sqli-labs": FlaskConical,
  web: Globe,
  unknown: Folder,
};

export default function Sidebar({
  projects,
  system,
  activeProjectId,
  activeConversationId,
  onSelectProject,
  onSelectConversation,
  onCreateProject,
  onCreateConversation,
  onDeleteProject,
  onDeleteConversation,
  onOpenReport,
  showConversations = true,
}: Props) {
  function projectState(project: Project): boolean | null {
    if (!system) return null;
    if (project.lab === "dvwa") return system.lab_http.dvwa;
    if (project.lab === "sqli-labs") return system.lab_http.sqli_labs;
    return null;
  }

  return (
    <aside className="sidebar">
      <div className="side-heading">
        <span className="eyebrow">项目</span>
        <button className="icon-btn small" title="新建项目" onClick={onCreateProject}>
          <Plus size={14} />
        </button>
      </div>

      <div className="side-section">
        <div className="project-list">
          {projects.map((project) => {
            const active = project.id === activeProjectId;
            const Icon = LAB_ICONS[project.lab] ?? Folder;
            const state = projectState(project);
            return (
              <div key={project.id} className={`project-block ${active ? "active" : ""}`}>
                <div className="project-row">
                  <button className="project-main" onClick={() => onSelectProject(project.id)}>
                    <span className="project-icon">
                      <Icon />
                    </span>
                    <span className="project-meta">
                      <span className="project-name">{project.name}</span>
                      <span className="project-target mono">{project.target}</span>
                    </span>
                    <span
                      className={`mini-dot ${
                        state === null ? "unknown" : state ? "up" : "down"
                      }`}
                    />
                  </button>
                  <button
                    className="icon-btn"
                    title="删除项目"
                    onClick={() => onDeleteProject(project.id)}
                  >
                    <X size={12} />
                  </button>
                </div>

                {active && showConversations && (
                  <div className="conversation-list">
                    {project.conversations.length === 0 && (
                      <div className="conv-empty">还没有会话</div>
                    )}
                    {project.conversations.map((conversation) => (
                      <div
                        key={conversation.id}
                        className={`conv-row ${
                          conversation.id === activeConversationId ? "active" : ""
                        }`}
                      >
                        <button
                          className="conv-main"
                          onClick={() => onSelectConversation(conversation.id)}
                          title={conversation.title}
                        >
                          <span className="conv-icon">
                            <MessageSquare />
                          </span>
                          <span className="conv-title">{conversation.title}</span>
                          {conversation.busy && <span className="conv-busy">运行中</span>}
                        </button>
                        <button
                          className="icon-btn"
                          title="删除会话"
                          onClick={() => onDeleteConversation(conversation.id)}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <button className="new-conv-btn" onClick={onCreateConversation}>
                      <Plus size={13} />
                      新对话
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {projects.length === 0 && (
            <div className="conv-empty">点击「新建项目」添加你的第一个授权目标</div>
          )}
        </div>
      </div>

      <div className="side-footer">
        <div className="side-status">
          <span className={`mini-dot ${system?.lab_http.dvwa ? "up" : "down"}`} /> DVWA
          <span className={`mini-dot ${system?.lab_http.sqli_labs ? "up" : "down"}`} /> SQLi-Labs
        </div>
        <div className="side-actions">
          <button className="link-btn" onClick={onOpenReport}>
            <FileText size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            查看报告
          </button>
          <span className="side-version">v{system?.version ?? "1.0.0"}</span>
        </div>
        <div className="side-disclaimer">仅限本地授权靶场 · 作用域守卫已启用</div>
      </div>
    </aside>
  );
}
