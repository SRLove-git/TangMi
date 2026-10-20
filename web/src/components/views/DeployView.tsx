import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  Container,
  Database,
  Download,
  ExternalLink,
  Globe,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Server,
  Square,
  Terminal,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../../api";
import type { DeployCatalog, DeployDisk, DeployLab } from "../../types";
import { PageHeader } from "./shared";

const STATE_META: Record<string, { label: string; className: string }> = {
  running: { label: "运行中", className: "up" },
  stopped: { label: "已停止", className: "warn" },
  not_installed: { label: "未部署", className: "off" },
};

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  web: Globe,
  injection: Database,
  upload: Upload,
  api: Braces,
  infra: Server,
  classic: Terminal,
};

type DeployAction = "install" | "start" | "stop" | "remove";

interface Props {
  /** 把运行中的靶场一键加入工作台（创建项目并打开对话） */
  onUseAsProject?: (lab: DeployLab) => void;
}

export default function DeployView({ onUseAsProject }: Props) {
  const [catalog, setCatalog] = useState<DeployCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [logsKey, setLogsKey] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [disk, setDisk] = useState<DeployDisk | null>(null);
  const [pruning, setPruning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.deployCatalog();
      setCatalog(data);
      setError("");
      try {
        setDisk(await api.deployDisk());
      } catch {
        /* 磁盘信息失败不影响主流程 */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  async function pruneImages() {
    if (!disk?.prune_candidates?.length) return;
    if (
      !window.confirm(
        `确定清理 ${disk.prune_candidates.length} 个未被任何容器使用的靶场镜像吗？（约 ${disk.prune_mb} MB，其它项目镜像不受影响）`,
      )
    ) {
      return;
    }
    setPruning(true);
    setError("");
    try {
      const result = await api.deployPrune();
      setNotice(result.message);
      setDisk(await api.deployDisk());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPruning(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 有部署任务时 1.5s 轮询，否则 5s 刷新一次状态
  const hasActiveTask = Boolean(
    catalog?.labs.some((lab) => lab.runtime.task?.status === "running"),
  );
  useEffect(() => {
    const interval = window.setInterval(() => void refresh(), hasActiveTask ? 1500 : 5000);
    return () => window.clearInterval(interval);
  }, [hasActiveTask, refresh]);

  // 日志面板打开时轮询日志
  useEffect(() => {
    if (!logsKey) return;
    let alive = true;
    const load = async () => {
      try {
        const data = await api.deployLogs(logsKey);
        if (alive) setLogs(data.lines);
      } catch {
        /* ignore */
      }
    };
    void load();
    const interval = window.setInterval(load, 1500);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [logsKey]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function runAction(lab: DeployLab, action: DeployAction) {
    setBusyKey(lab.key);
    setError("");
    try {
      const result = await api.deployAction(lab.key, action);
      const labels: Record<DeployAction, string> = {
        install: "开始部署",
        start: "正在启动",
        stop: "正在停止",
        remove: "正在删除",
      };
      setNotice(`${labels[action]}「${lab.name}」…`);
      if (action === "install" || action === "start") {
        setLogsKey(lab.key);
      }
      if (result.task) {
        void refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
      void refresh();
    }
  }

  function copyUrl(lab: DeployLab) {
    const url = lab.runtime.url;
    if (!url) return;
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopiedKey(lab.key);
    window.setTimeout(() => setCopiedKey(null), 1600);
  }

  const labs = useMemo(() => {
    if (!catalog) return [];
    const keyword = query.trim().toLowerCase();
    return catalog.labs.filter((lab) => {
      if (category !== "all" && lab.category !== category) return false;
      if (!keyword) return true;
      return [lab.name, lab.subtitle, lab.description, lab.category_label, ...lab.tags]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [catalog, category, query]);

  const running = catalog?.running ?? 0;
  const total = catalog?.total ?? 0;

  function renderCard(lab: DeployLab) {
    const Icon = CATEGORY_ICONS[lab.category] ?? Container;
    const state = STATE_META[lab.runtime.state] ?? STATE_META.not_installed;
    const task = lab.runtime.task;
    const taskRunning = task?.status === "running";
    const taskFailed = task?.status === "failed";
    const url = lab.runtime.url;
    const isHttp = lab.health_kind === "http";
    const busy = busyKey === lab.key || taskRunning;
    const lastLog = task?.logs?.[task.logs.length - 1] ?? "";

    return (
      <article className="deploy-card" key={lab.key}>
        <div className="deploy-card-head">
          <div className={`deploy-icon deploy-icon-${lab.category}`}>
            <Icon size={17} />
          </div>
          <div className="deploy-title">
            <div className="deploy-name-row">
              <h3>{lab.name}</h3>
              <span className={`deploy-state ${state.className}`}>
                <i className="dot" />
                {state.label}
              </span>
            </div>
            <p className="deploy-subtitle">{lab.subtitle}</p>
          </div>
        </div>

        <p className="deploy-desc">{lab.description}</p>

        <div className="deploy-tags">
          <span className="deploy-chip category">{lab.category_label}</span>
          <span className="deploy-chip">{lab.difficulty}</span>
          {lab.builtin && <span className="deploy-chip builtin">内置</span>}
          {lab.runtime.adopted && <span className="deploy-chip adopted">复用本机容器</span>}
          {lab.heavy && <span className="deploy-chip heavy">内存占用高</span>}
          {lab.tags.slice(0, 3).map((tag) => (
            <span className="deploy-chip tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>

        <div className="deploy-meta">
          <code>{lab.image || "docker compose"}</code>
          <span>
            {lab.runtime.port
              ? `127.0.0.1:${lab.runtime.port} → ${lab.container_port}`
              : `计划端口 127.0.0.1:${lab.preferred_port}`}
          </span>
        </div>

        {lab.runtime.state === "running" && (
          <div className="deploy-url-row">
            {url ? (
              isHttp ? (
                <a className="deploy-url" href={url} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} />
                  {url}
                </a>
              ) : (
                <span className="deploy-url mono">{url}</span>
              )
            ) : (
              <span className="muted small">容器运行中（无映射端口）</span>
            )}
            <span className={`deploy-health ${lab.runtime.healthy ? "ok" : "bad"}`}>
              {lab.runtime.healthy ? (
                <>
                  <CheckCircle2 size={12} /> 响应正常
                </>
              ) : (
                <>
                  <AlertTriangle size={12} /> 暂未响应
                </>
              )}
            </span>
            {url && (
              <button className="btn tiny ghost" onClick={() => copyUrl(lab)}>
                {copiedKey === lab.key ? "已复制" : "复制地址"}
              </button>
            )}
          </div>
        )}

        {lab.credentials && (
          <p className="deploy-credentials">账号：{lab.credentials}</p>
        )}

        {taskRunning && (
          <div className="deploy-progress">
            <div className="deploy-progress-head">
              <Loader2 size={13} className="spin" />
              <span>{task?.action === "install" ? "正在部署…" : "正在执行…"}</span>
            </div>
            <div className="deploy-progress-bar">
              <span />
            </div>
            {lastLog && <p className="deploy-progress-line">{lastLog}</p>}
          </div>
        )}

        {!taskRunning && task && (
          <div className={`deploy-task-result ${taskFailed ? "bad" : "ok"}`}>
            {taskFailed ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
            <span>
              {taskFailed
                ? task.error || "部署失败"
                : task.message || "最近一次操作已完成"}
            </span>
          </div>
        )}

        <div className="deploy-actions">
          {lab.runtime.state === "not_installed" && (
            <button
              className="btn primary tiny"
              onClick={() => void runAction(lab, "install")}
              disabled={busy || catalog?.docker.available === false}
            >
              <Download size={13} />
              {lab.builtin ? "启动内置栈" : "一键部署"}
            </button>
          )}
          {lab.runtime.state === "stopped" && (
            <button
              className="btn primary tiny"
              onClick={() => void runAction(lab, "start")}
              disabled={busy || catalog?.docker.available === false}
            >
              <Play size={13} />
              启动
            </button>
          )}
          {lab.runtime.state === "running" && (
            <>
              {isHttp && url && (
                <a className="btn tiny primary" href={url} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} />
                  打开
                </a>
              )}
              {isHttp && url && onUseAsProject && (
                <button
                  className="btn tiny"
                  onClick={() => onUseAsProject(lab)}
                  title="创建对应工作台项目并打开对话，可直接开始扫描"
                >
                  <Play size={12} />
                  加入工作台
                </button>
              )}
              <button
                className="btn tiny"
                onClick={() => void runAction(lab, "stop")}
                disabled={busy}
              >
                <Square size={12} />
                停止
              </button>
            </>
          )}
          {lab.runtime.state !== "not_installed" && !lab.builtin && (
            <button
              className="btn tiny ghost danger-text"
              onClick={() => {
                if (window.confirm(`确定删除「${lab.name}」的容器吗？镜像会保留。`)) {
                  void runAction(lab, "remove");
                }
              }}
              disabled={busy}
            >
              <Trash2 size={12} />
              删除
            </button>
          )}
          <button
            className="btn tiny ghost"
            onClick={() => setLogsKey(logsKey === lab.key ? null : lab.key)}
          >
            <Terminal size={12} />
            {logsKey === lab.key ? "收起日志" : "日志"}
          </button>
        </div>

        {logsKey === lab.key && (
          <div className="deploy-logs-wrap">
            <div className="deploy-logs-head">
              <span>部署 / 容器日志</span>
              <button className="icon-btn" onClick={() => setLogsKey(null)}>
                ✕
              </button>
            </div>
            <pre className="deploy-logs">{logs.length ? logs.join("\n") : "加载中…"}</pre>
          </div>
        )}

        {lab.notes && <p className="deploy-hint">{lab.notes}</p>}
      </article>
    );
  }

  return (
    <section className="platform-view deploy-view">
      <PageHeader
        eyebrow="Lab Deployment"
        title="靶场部署"
        subtitle={`常见公开靶场一键安装：自动拉取镜像、启动容器、等待就绪。已运行 ${running} / ${total} 个。`}
        actions={
          <button className="btn" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            刷新状态
          </button>
        }
      />

      {disk?.available && (
        <div className="deploy-disk">
          <div className="deploy-disk-info">
            <HardDrive size={15} />
            <span>
              靶场镜像占用 <b>{disk.total_mb} MB</b>（{disk.catalog_image_count ?? disk.images.length} 个）
              {disk.prune_mb > 0 && (
                <em className="deploy-disk-warn">
                  · 有 {disk.prune_candidates.length} 个未使用镜像可清理，约 {disk.prune_mb} MB
                </em>
              )}
            </span>
          </div>
          {disk.prune_candidates.length > 0 && (
            <button className="btn tiny" onClick={() => void pruneImages()} disabled={pruning}>
              <Trash2 size={12} />
              {pruning ? "清理中…" : "清理未使用镜像"}
            </button>
          )}
        </div>
      )}

      {catalog && !catalog.docker.available && (
        <div className="alert error">
          Docker 未就绪：{catalog.docker.version}。请先启动 Docker Desktop，再刷新本页。
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success-alert">{notice}</div>}

      <div className="deploy-toolbar">
        <div className="deploy-filter-chips">
          <button
            className={`deploy-filter ${category === "all" ? "active" : ""}`}
            onClick={() => setCategory("all")}
          >
            全部
          </button>
          {catalog?.categories.map((item) => (
            <button
              key={item.key}
              className={`deploy-filter ${category === item.key ? "active" : ""}`}
              onClick={() => setCategory(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="filter-search deploy-search">
          <Search size={14} />
          <input
            className="text-input"
            placeholder="搜索靶场名称 / 漏洞类型…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {loading && !catalog ? (
        <div className="card muted">正在读取靶场目录与 Docker 状态…</div>
      ) : (
        <div className="deploy-grid">
          {labs.map((lab) => renderCard(lab))}
          {labs.length === 0 && (
            <div className="card muted">没有匹配的靶场，换个关键词试试。</div>
          )}
        </div>
      )}
    </section>
  );
}
