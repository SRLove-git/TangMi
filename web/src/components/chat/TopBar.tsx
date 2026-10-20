import {
  BookOpen,
  Container,
  LayoutDashboard,
  MessageSquare,
  Moon,
  Plus,
  Repeat,
  Search,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AppView, SystemInfo } from "../../types";

interface Props {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  system: SystemInfo | null;
  onNewProject: () => void;
  onOpenPalette: () => void;
  view: AppView;
  onNavigate: (view: AppView) => void;
}

const NAV_ITEMS: Array<{ id: AppView; label: string; icon: LucideIcon }> = [
  { id: "chat", label: "工作台", icon: MessageSquare },
  { id: "deploy", label: "靶场部署", icon: Container },
  { id: "learning", label: "学习", icon: BookOpen },
  { id: "repeater", label: "重放器", icon: Repeat },
  { id: "records", label: "记录", icon: LayoutDashboard },
  { id: "settings", label: "设置", icon: Settings },
];

export default function TopBar({
  theme,
  onToggleTheme,
  system,
  onNewProject,
  onOpenPalette,
  view,
  onNavigate,
}: Props) {

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <div className="brand-logo">
          <ShieldCheck strokeWidth={2} />
        </div>
        <div className="brand-word">
          pentest <span>agent</span>
        </div>
      </div>

      <nav className="topbar-center">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`topbar-nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => onNavigate(item.id)}
            >
              <Icon size={14} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="topbar-actions">
        <span className={`topbar-status ${system?.lab_http.dvwa || system?.lab_http.sqli_labs ? "up" : "down"}`}>
          <i className="dot" />
          靶场{system?.lab_http.dvwa || system?.lab_http.sqli_labs ? "在线" : "离线"}
        </span>
        <button
          className="icon-btn palette-trigger"
          title="全局搜索（⌘K）"
          onClick={onOpenPalette}
        >
          <Search size={16} />
        </button>
        <button
          className="icon-btn"
          title={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
          onClick={onToggleTheme}
        >
          {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
        </button>
        <div className="topbar-divider" />
        <button className="btn primary" onClick={onNewProject}>
          <Plus size={15} />
          新建项目
        </button>
      </div>
    </header>
  );
}
