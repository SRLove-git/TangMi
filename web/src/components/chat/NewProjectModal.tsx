import { useCallback, useEffect, useMemo, useState } from "react";
import { Container, ExternalLink, Link2, RefreshCw, Server } from "lucide-react";
import { api } from "../../api";
import type { LocalLabSource, LocalLabSources } from "../../types";
import Overlay from "./Overlay";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, target: string) => Promise<void> | void;
  /** 本地没有可用靶场时，跳转到靶场部署页 */
  onGoDeploy?: () => void;
}

type Mode = "local" | "custom";

const PRESETS = [
  { name: "DVWA 本地靶场", target: "http://127.0.0.1:4280" },
  { name: "SQLi-Labs 本地靶场", target: "http://127.0.0.1:8085" },
  { name: "内置演示漏洞站", target: "http://127.0.0.1:8899" },
];

const KIND_LABEL: Record<string, string> = {
  builtin: "内置",
  deploy: "已部署",
  demo: "演示",
};

export default function NewProjectModal({ open, onClose, onCreate, onGoDeploy }: Props) {
  const [mode, setMode] = useState<Mode>("local");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [sources, setSources] = useState<LocalLabSources | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    setSourcesError("");
    try {
      const data = await api.labSources();
      setSources(data);
      const firstOnline = data.sources.find((source) => source.online);
      if (firstOnline) {
        setSelectedKey((current) => current || firstOnline.key);
        setName((current) => current || firstOnline.name);
        setTarget((current) => current || firstOnline.target);
      }
    } catch (err) {
      setSourcesError(err instanceof Error ? err.message : String(err));
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError("");
    setCreating(false);
    setMode("local");
    setSelectedKey("");
    setName("");
    setTarget("");
    void loadSources();
  }, [open, loadSources]);

  const selected = useMemo(
    () => sources?.sources.find((source) => source.key === selectedKey) ?? null,
    [sources, selectedKey],
  );

  if (!open) return null;

  function selectSource(source: LocalLabSource) {
    if (!source.online) return;
    setSelectedKey(source.key);
    setName(source.name);
    setTarget(source.target);
    setError("");
  }

  async function submit() {
    const finalTarget = mode === "local" ? selected?.target ?? target : target;
    const finalName = (name.trim() || selected?.name || finalTarget).trim();
    if (mode === "local" && !selected) {
      setError("请先从本机靶场列表里选择一个");
      return;
    }
    if (!finalTarget.trim()) {
      setError("请填写目标地址");
      return;
    }
    if (!/^https?:\/\//i.test(finalTarget.trim())) {
      setError("目标地址必须以 http:// 或 https:// 开头");
      return;
    }
    setCreating(true);
    setError("");
    try {
      await onCreate(finalName || finalTarget, finalTarget.trim());
      setCreating(false);
      onClose();
    } catch (err) {
      setCreating(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Overlay
      title="新建项目"
      subtitle="一个项目对应一个授权目标：可以直接选择本机靶场，也可以手动输入靶场 / 内网 / 已授权外部地址"
      onClose={onClose}
      wide
    >
      <div className="project-mode-tabs">
        <button
          className={`project-mode-tab ${mode === "local" ? "active" : ""}`}
          onClick={() => {
            setMode("local");
            setError("");
          }}
        >
          <Server size={15} />
          本地靶场
          <small>内置 / 已部署 / 演示站，一键选择</small>
        </button>
        <button
          className={`project-mode-tab ${mode === "custom" ? "active" : ""}`}
          onClick={() => {
            setMode("custom");
            setError("");
          }}
        >
          <Link2 size={15} />
          自定义地址
          <small>手动输入任意授权目标</small>
        </button>
      </div>

      {mode === "local" && (
        <div className="lab-source-panel">
          <div className="lab-source-head">
            <span>
              本机可用靶场
              {sources && (
                <em className="muted">
                  · {sources.online}/{sources.total} 在线
                </em>
              )}
            </span>
            <button className="btn tiny ghost" onClick={() => void loadSources()} disabled={sourcesLoading}>
              <RefreshCw size={12} className={sourcesLoading ? "spin" : ""} />
              刷新
            </button>
          </div>

          {sourcesError && <div className="alert error">{sourcesError}</div>}
          {sourcesLoading && !sources && <p className="muted small">正在探测本机靶场…</p>}

          {sources && (
            <div className="lab-source-list">
              {sources.sources.map((source) => (
                <button
                  key={source.key}
                  className={`lab-source-item ${selectedKey === source.key ? "selected" : ""} ${
                    source.online ? "" : "offline"
                  }`}
                  onClick={() => selectSource(source)}
                  disabled={!source.online}
                >
                  <span className={`deploy-state ${source.online ? "up" : "off"}`}>
                    <i className="dot" />
                    {source.online ? "在线" : "未启动"}
                  </span>
                  <span className="lab-source-main">
                    <b>{source.name}</b>
                    <small className="mono">{source.target}</small>
                  </span>
                  <span className="lab-source-tags">
                    <span className="deploy-chip">{KIND_LABEL[source.kind] ?? source.kind}</span>
                    {source.tags
                      .filter((tag) => tag !== KIND_LABEL[source.kind])
                      .slice(0, 2)
                      .map((tag) => (
                        <span className="deploy-chip tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                  </span>
                </button>
              ))}
              {sources.sources.length === 0 && (
                <p className="muted small">本机暂无可直接选择的靶场。</p>
              )}
            </div>
          )}

          <div className="lab-source-foot">
            <span className="form-hint">
              {selected?.credentials ? `默认账号：${selected.credentials} · ` : ""}
              没找到想要的靶场？去「靶场部署」页一键安装后再回来。
            </span>
            {onGoDeploy && (
              <button
                className="btn tiny"
                onClick={() => {
                  onClose();
                  onGoDeploy();
                }}
              >
                <Container size={12} />
                去靶场部署
              </button>
            )}
          </div>
        </div>
      )}

      {mode === "custom" && (
        <>
          <label className="field-label" htmlFor="project-target-custom">
            靶场地址
          </label>
          <input
            id="project-target-custom"
            className="text-input"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="http://127.0.0.1:4280"
            spellCheck={false}
          />
          <div className="chip-row preset-row">
            {PRESETS.map((preset) => (
              <button
                key={preset.target}
                className="chip"
                onClick={() => {
                  setName(preset.name);
                  setTarget(preset.target);
                }}
              >
                {preset.name.replace(" 本地靶场", "")} · {preset.target}
              </button>
            ))}
          </div>
        </>
      )}

      <label className="field-label" htmlFor="project-name">
        项目名称
      </label>
      <input
        id="project-name"
        className="text-input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="例如：我的 DVWA 靶场"
      />

      {mode === "local" && selected && (
        <p className="form-hint">
          <ExternalLink size={11} /> 已选择：{selected.name} · {selected.target}
          {selected.note ? ` · ${selected.note}` : ""}
        </p>
      )}

      {error && <div className="form-error">{error}</div>}

      <div className="modal-actions">
        <button className="btn" onClick={onClose} disabled={creating}>
          取消
        </button>
        <button
          className="btn primary"
          onClick={submit}
          disabled={creating || (mode === "local" && !selected)}
        >
          {creating ? "创建并识别中…" : "创建项目"}
        </button>
      </div>
      <p className="form-hint">
        支持任意已授权目标（本地靶场、内网系统或书面授权外部系统）。默认仅允许本地 / 内网地址；
        非本地目标需要以 --allow-remote 或环境变量显式授权。
      </p>
    </Overlay>
  );
}
