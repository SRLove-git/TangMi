import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Container,
  CornerDownLeft,
  LayoutDashboard,
  MessageSquare,
  Repeat,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../api";
import type { AppView, DeployLab, LearningItem } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: AppView) => void;
  onOpenLearningItem: (itemKey: string) => void;
}

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  group: string;
  run: () => void;
}

const PAGES: Array<{ view: AppView; label: string; hint: string; icon: LucideIcon }> = [
  { view: "chat", label: "工作台", hint: "对话与执行", icon: MessageSquare },
  { view: "deploy", label: "靶场部署", hint: "一键安装常见靶场", icon: Container },
  { view: "learning", label: "学习进度", hint: "进度 / 错题本 / 源码 / 出题", icon: BookOpen },
  { view: "repeater", label: "请求重放器", hint: "手工改包重放", icon: Repeat },
  { view: "records", label: "记录", hint: "态势 / 资产 / 漏洞 / 扫描", icon: LayoutDashboard },
  { view: "settings", label: "设置", hint: "项目与 AI 教学模型", icon: Settings },
];

/** ⌘K 全局命令面板：搜页面 / 关卡 / 靶场，快速跳转。 */
export default function CommandPalette({ open, onClose, onNavigate, onOpenLearningItem }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [learning, setLearning] = useState<LearningItem[]>([]);
  const [labs, setLabs] = useState<DeployLab[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    void (async () => {
      try {
        const [snapshot, catalog] = await Promise.all([api.learning(), api.deployCatalog()]);
        setLearning([...snapshot.labs.dvwa, ...snapshot.labs["sqli-labs"]]);
        setLabs(catalog.labs);
      } catch {
        /* 面板仍可用，只是没有关卡/靶场结果 */
      }
    })();
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const keyword = query.trim().toLowerCase();
    const match = (text: string) => !keyword || text.toLowerCase().includes(keyword);
    const result: PaletteItem[] = [];

    for (const page of PAGES) {
      if (match(page.label) || match(page.hint)) {
        result.push({
          id: `page-${page.view}`,
          label: page.label,
          hint: page.hint,
          icon: page.icon,
          group: "页面",
          run: () => onNavigate(page.view),
        });
      }
    }
    if (keyword) {
      for (const item of learning) {
        if (!match(item.title)) continue;
        result.push({
          id: `learning-${item.key}`,
          label: item.title,
          hint: `${item.status_label}${item.hints ? ` · 看过 ${item.hints} 层提示` : ""}${
            item.best_score ? ` · 练习 ${item.best_score} 分` : ""
          }`,
          icon: Sparkles,
          group: "学习关卡",
          run: () => onOpenLearningItem(item.key),
        });
        if (result.length > 20) break;
      }
      for (const lab of labs) {
        if (!match(lab.name) && !match(lab.subtitle) && !match(lab.category_label)) continue;
        result.push({
          id: `lab-${lab.key}`,
          label: lab.name,
          hint: `${lab.category_label} · ${lab.runtime.state === "running" ? "运行中" : "未运行"}`,
          icon: Container,
          group: "靶场",
          run: () => onNavigate("deploy"),
        });
      }
    }
    return result.slice(0, 30);
  }, [query, learning, labs, onNavigate, onOpenLearningItem]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  function choose(item: PaletteItem) {
    item.run();
    onClose();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(items.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[active];
      if (item) choose(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  let lastGroup = "";
  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette-panel" onClick={(event) => event.stopPropagation()}>
        <div className="palette-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="搜索页面、学习关卡、靶场…（⌘K 打开 / Esc 关闭）"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="palette-kbd">Esc</kbd>
        </div>
        <div className="palette-results">
          {items.length === 0 && (
            <p className="palette-empty">
              {query.trim() ? "没有匹配结果，换个关键词试试。" : "输入关键词开始搜索；直接回车打开第一项。"}
            </p>
          )}
          {items.map((item, index) => {
            const Icon = item.icon;
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {showGroup && <div className="palette-group">{item.group}</div>}
                <button
                  className={`palette-item ${index === active ? "active" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(item)}
                >
                  <Icon size={15} />
                  <span className="palette-label">{item.label}</span>
                  <span className="palette-hint">{item.hint}</span>
                  {index === active && <CornerDownLeft size={13} className="palette-enter" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span>↑↓ 选择</span>
          <span>↵ 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
