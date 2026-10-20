import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  FileArchive,
  FolderOpen,
  LoaderCircle,
  PlugZap,
  Plus,
  Puzzle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Terminal,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { api } from "../../api";
import type {
  ExtensionsSnapshot,
  MCPServerConfig,
  MCPTestResult,
  MCPToolInfo,
  SkillDetail,
  SkillItem,
} from "../../types";
import Overlay from "../chat/Overlay";
import { PageHeader } from "./shared";

interface Props {
  onNotify?: (message: string) => void;
}

type Tab = "skills" | "mcp";

interface McpForm {
  id?: string;
  name: string;
  transport: "stdio" | "http";
  enabled: boolean;
  description: string;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
  timeout: string;
}

const EMPTY_FORM: McpForm = {
  name: "",
  transport: "stdio",
  enabled: true,
  description: "",
  command: "",
  argsText: "",
  envText: "",
  url: "",
  headersText: "",
  timeout: "30",
};

function formFromServer(server: MCPServerConfig): McpForm {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
    description: server.description ?? "",
    command: server.command ?? "",
    argsText: (server.args ?? []).join("\n"),
    envText: Object.entries(server.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    url: server.url ?? "",
    headersText: Object.entries(server.headers ?? {})
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n"),
    timeout: String(server.timeout ?? 30),
  };
}

function parseKeyValueLines(text: string, separator: "=" | ":"): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf(separator);
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function formatSize(size: number): string {
  if (!size) return "0 KB";
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} KB`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("zh-CN");
}

export default function ExtensionsView({ onNotify }: Props) {
  const [tab, setTab] = useState<Tab>("skills");
  const [snapshot, setSnapshot] = useState<ExtensionsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // 技能
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [installingPath, setInstallingPath] = useState(false);
  const [preview, setPreview] = useState<SkillDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState("");

  // MCP
  const [form, setForm] = useState<McpForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState("");
  const [testResults, setTestResults] = useState<Record<string, MCPTestResult>>({});

  const skills = snapshot?.skills ?? [];
  const servers = snapshot?.mcp.servers ?? [];
  const mcpStatus = snapshot?.mcp.status;
  const enabledSkills = useMemo(() => skills.filter((item) => item.enabled), [skills]);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.extensions());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function flash(text: string) {
    setMessage(text);
    setError("");
    onNotify?.(text);
    window.setTimeout(() => setMessage(""), 4000);
  }

  // ------------------------------------------------------------ 技能操作
  async function handleUpload(file: File | null | undefined) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const data = await api.installSkillZip(file);
      flash(`技能「${data.skill?.name ?? file.name}」安装成功`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function installFromPath() {
    if (!pathInput.trim()) return;
    setInstallingPath(true);
    setError("");
    try {
      const data = await api.installSkillPath(pathInput.trim());
      flash(`技能「${data.skill.name}」已从目录安装`);
      setPathInput("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingPath(false);
    }
  }

  async function toggleSkill(skill: SkillItem) {
    try {
      await api.toggleSkill(skill.id, !skill.enabled);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeSkill(skill: SkillItem) {
    if (!window.confirm(`确定删除已安装技能「${skill.name}」吗？`)) return;
    try {
      await api.deleteSkill(skill.id);
      flash(`技能「${skill.name}」已删除`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openSkill(skill: SkillItem) {
    setPreviewLoading(skill.id);
    try {
      setPreview(await api.skillDetail(skill.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading("");
    }
  }

  // ------------------------------------------------------------ MCP 操作
  function newServer(preset?: Partial<McpForm>) {
    setForm({ ...EMPTY_FORM, ...preset });
    setError("");
  }

  function editServer(server: MCPServerConfig) {
    setForm(formFromServer(server));
    setError("");
  }

  async function saveServer() {
    if (!form) return;
    if (!form.name.trim()) {
      setError("请填写 MCP 服务器名称");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      id: form.id,
      name: form.name.trim(),
      transport: form.transport,
      enabled: form.enabled,
      description: form.description.trim(),
      command: form.transport === "stdio" ? form.command.trim() : "",
      args: form.transport === "stdio"
        ? form.argsText.split("\n").map((line) => line.trim()).filter(Boolean)
        : [],
      env: form.transport === "stdio" ? parseKeyValueLines(form.envText, "=") : {},
      url: form.transport === "http" ? form.url.trim() : "",
      headers: form.transport === "http" ? parseKeyValueLines(form.headersText, ":") : {},
      timeout: Number(form.timeout) || 30,
    };
    try {
      const saved = await api.saveMcpServer(payload);
      flash(`MCP 服务器「${saved.server.name}」已保存，建议点「测试连接」验证`);
      setForm(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function testServer(server: MCPServerConfig) {
    setTestingId(server.id);
    setError("");
    try {
      const result = await api.testMcpServer(server.id);
      setTestResults((prev) => ({ ...prev, [server.id]: result }));
      if (result.ok) {
        flash(
          `「${server.name}」连接成功：${result.tools?.length ?? 0} 个工具 · ${result.latency_ms ?? 0}ms`,
        );
      }
      await refresh();
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setTestResults((prev) => ({
        ...prev,
        [server.id]: { ok: false, error: text },
      }));
      setError(text);
    } finally {
      setTestingId("");
    }
  }

  async function toggleServer(server: MCPServerConfig) {
    try {
      await api.toggleMcpServer(server.id, !server.enabled);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeServer(server: MCPServerConfig) {
    if (!window.confirm(`确定删除 MCP 服务器「${server.name}」吗？`)) return;
    try {
      await api.deleteMcpServer(server.id);
      flash(`MCP 服务器「${server.name}」已删除`);
      if (form?.id === server.id) setForm(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function serverTools(server: MCPServerConfig): MCPToolInfo[] {
    const tested = testResults[server.id];
    if (tested?.ok && tested.tools) return tested.tools;
    return server.tools ?? [];
  }

  // ------------------------------------------------------------ 渲染
  return (
    <section className="platform-view extensions-view">
      <PageHeader
        eyebrow="Extensions"
        title="扩展"
        subtitle="安装技能（Skills）与接入 MCP 服务器，扩展对话 Agent 的能力；装好后 Agent 会自动按需调用。"
        actions={
          <button className="btn tiny" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={13} />
            刷新
          </button>
        }
      />

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success-alert">{message}</div>}

      <div className="ext-tabs">
        <button
          className={`ext-tab ${tab === "skills" ? "active" : ""}`}
          onClick={() => setTab("skills")}
        >
          <Puzzle size={14} />
          技能
          <span className="ext-tab-count">{skills.length}</span>
        </button>
        <button
          className={`ext-tab ${tab === "mcp" ? "active" : ""}`}
          onClick={() => setTab("mcp")}
        >
          <PlugZap size={14} />
          MCP 服务器
          <span className="ext-tab-count">{servers.length}</span>
        </button>
      </div>

      {loading ? (
        <div className="card ext-empty">
          <LoaderCircle size={16} className="ext-spin" /> 正在读取扩展…
        </div>
      ) : tab === "skills" ? (
        <>
          <div className="card ext-install-card">
            <div className="card-head">
              <h4>
                <Upload size={15} /> 安装技能
              </h4>
            </div>
            <p className="muted small">
              一个技能 = 包含 <code>SKILL.md</code> 的文件夹（可选 YAML frontmatter 描述 name /
              description，可附带 scripts/、references/ 等资源）。安装后 Agent 会通过
              <code> list_skills</code> / <code>use_skill</code> 按需读取并照做。
            </p>
            <div className="ext-install-row">
              <input
                ref={fileRef}
                type="file"
                accept=".zip"
                hidden
                onChange={(event) => void handleUpload(event.target.files?.[0])}
              />
              <button
                className="btn primary"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <LoaderCircle size={14} className="ext-spin" /> : <FileArchive size={14} />}
                {uploading ? "安装中…" : "上传技能 ZIP"}
              </button>
              <span className="ext-install-divider">或从本地目录安装</span>
              <input
                className="text-input ext-path-input"
                value={pathInput}
                placeholder="/path/to/skill-folder（目录内含 SKILL.md）"
                onChange={(event) => setPathInput(event.target.value)}
              />
              <button
                className="btn"
                onClick={() => void installFromPath()}
                disabled={!pathInput.trim() || installingPath}
              >
                <FolderOpen size={14} />
                {installingPath ? "安装中…" : "安装目录"}
              </button>
            </div>
            <p className="form-hint">
              安装位置：<code>web_data/skills/</code>；内置技能来自仓库 <code>skills/</code> 目录。
              请只安装可信来源的技能包。
            </p>
          </div>

          <div className="ext-section-head">
            <span className="eyebrow">技能列表</span>
            <span className="muted small">
              共 {skills.length} 个 · 已启用 {enabledSkills.length} 个
            </span>
          </div>

          {skills.length === 0 ? (
            <div className="card ext-empty">
              <Puzzle size={18} />
              还没有技能。上传一个包含 SKILL.md 的 ZIP，或从本地目录安装。
            </div>
          ) : (
            <div className="ext-grid">
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className={`card ext-skill-card ${skill.enabled ? "" : "disabled"}`}
                >
                  <div className="ext-card-top">
                    <div className="ext-card-title">
                      <span className={`ext-icon ${skill.source}`}>
                        {skill.source === "builtin" ? <ShieldCheck size={16} /> : <Puzzle size={16} />}
                      </span>
                      <div>
                        <h4>{skill.name}</h4>
                        <div className="ext-subline">
                          <span className={`ext-badge ${skill.source}`}>
                            {skill.source === "builtin" ? "内置" : "已安装"}
                          </span>
                          <span className="ext-id mono">{skill.id}</span>
                        </div>
                      </div>
                    </div>
                    <label className="switch ext-switch">
                      <input
                        type="checkbox"
                        checked={skill.enabled}
                        onChange={() => void toggleSkill(skill)}
                      />
                      启用
                    </label>
                  </div>
                  <p className="ext-desc">{skill.description}</p>
                  <div className="ext-meta">
                    <span>{skill.files} 个文件</span>
                    <span>{formatSize(skill.size)}</span>
                    <span>更新 {formatDate(skill.updated_at)}</span>
                  </div>
                  <div className="ext-actions">
                    <button
                      className="btn tiny"
                      onClick={() => void openSkill(skill)}
                      disabled={previewLoading === skill.id}
                    >
                      <BookOpen size={13} />
                      {previewLoading === skill.id ? "读取中…" : "预览 SKILL.md"}
                    </button>
                    {skill.source === "installed" && (
                      <button className="btn tiny danger" onClick={() => void removeSkill(skill)}>
                        <X size={13} />
                        删除
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="ext-mcp-status">
            <div className="ext-stat">
              <span>服务器</span>
              <b>{servers.length}</b>
            </div>
            <div className="ext-stat">
              <span>已启用</span>
              <b>{mcpStatus?.enabled ?? 0}</b>
            </div>
            <div className="ext-stat">
              <span>已连接</span>
              <b>{mcpStatus?.connected ?? 0}</b>
            </div>
            <div className="ext-stat">
              <span>可用工具</span>
              <b>{mcpStatus?.tools ?? 0}</b>
            </div>
            <button className="btn primary" onClick={() => newServer()}>
              <Plus size={14} />
              添加 MCP 服务器
            </button>
          </div>

          {form && (
            <div className="card ext-mcp-form">
              <div className="card-head">
                <h4>
                  <PlugZap size={15} /> {form.id ? "编辑 MCP 服务器" : "添加 MCP 服务器"}
                </h4>
                <button className="btn ghost tiny" onClick={() => setForm(null)}>
                  <X size={13} />
                  取消
                </button>
              </div>
              <div className="ext-form-grid">
                <div>
                  <label className="field-label">名称</label>
                  <input
                    className="text-input"
                    value={form.name}
                    placeholder="例如 Demo MCP"
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </div>
                <div>
                  <label className="field-label">传输方式</label>
                  <select
                    className="select"
                    value={form.transport}
                    onChange={(event) =>
                      setForm({ ...form, transport: event.target.value as "stdio" | "http" })
                    }
                  >
                    <option value="stdio">stdio（本地子进程）</option>
                    <option value="http">http（Streamable HTTP）</option>
                  </select>
                </div>
                {form.transport === "stdio" ? (
                  <>
                    <div className="ext-form-row">
                      <div>
                        <label className="field-label">启动命令</label>
                        <input
                          className="text-input"
                          value={form.command}
                          placeholder="python3 / npx / uvx"
                          onChange={(event) => setForm({ ...form, command: event.target.value })}
                        />
                      </div>
                      <div>
                        <label className="field-label">超时（秒）</label>
                        <input
                          className="text-input"
                          type="number"
                          min={5}
                          max={60}
                          value={form.timeout}
                          onChange={(event) => setForm({ ...form, timeout: event.target.value })}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="field-label">参数（每行一个）</label>
                      <textarea
                        className="text-input ext-textarea"
                        rows={3}
                        value={form.argsText}
                        placeholder={"scripts/demo_mcp_server.py"}
                        onChange={(event) => setForm({ ...form, argsText: event.target.value })}
                      />
                    </div>
                    <div>
                      <label className="field-label">环境变量（KEY=VALUE，每行一个，可选）</label>
                      <textarea
                        className="text-input ext-textarea"
                        rows={2}
                        value={form.envText}
                        placeholder={"API_KEY=xxxx"}
                        onChange={(event) => setForm({ ...form, envText: event.target.value })}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="field-label">MCP 端点 URL</label>
                      <input
                        className="text-input"
                        value={form.url}
                        placeholder="http://127.0.0.1:3000/mcp"
                        onChange={(event) => setForm({ ...form, url: event.target.value })}
                      />
                    </div>
                    <div>
                      <label className="field-label">请求头（Name: Value，每行一个，可选）</label>
                      <textarea
                        className="text-input ext-textarea"
                        rows={2}
                        value={form.headersText}
                        placeholder={"Authorization: Bearer xxxx"}
                        onChange={(event) => setForm({ ...form, headersText: event.target.value })}
                      />
                    </div>
                    <div>
                      <label className="field-label">超时（秒）</label>
                      <input
                        className="text-input"
                        type="number"
                        min={5}
                        max={60}
                        value={form.timeout}
                        onChange={(event) => setForm({ ...form, timeout: event.target.value })}
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="field-label">描述（可选）</label>
                  <input
                    className="text-input"
                    value={form.description}
                    placeholder="例如：给 Agent 提供自定义安全工具"
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                  />
                </div>
              </div>
              <div className="ext-form-actions">
                <button className="btn primary" onClick={() => void saveServer()} disabled={saving}>
                  {saving ? <LoaderCircle size={14} className="ext-spin" /> : <Plus size={14} />}
                  {saving ? "保存中…" : "保存配置"}
                </button>
                <p className="form-hint">
                  保存后点「测试连接」验证；测试通过后 MCP 工具（<code>mcp__服务器__工具</code>）
                  会自动并入对话 Agent。
                </p>
              </div>
            </div>
          )}

          {servers.length === 0 && !form ? (
            <div className="card ext-empty ext-mcp-empty">
              <PlugZap size={20} />
              <div>
                <b>还没有接入 MCP 服务器</b>
                <p className="muted small">
                  MCP（Model Context Protocol）可以让 Agent 使用外部工具，例如文件系统、数据库、
                  安全工具。点右上角「添加 MCP 服务器」开始。
                </p>
              </div>
              <div className="ext-presets">
                <button
                  className="btn tiny"
                  onClick={() =>
                    newServer({
                      name: "Pentest Tools（内置安全工具）",
                      command: "python3",
                      argsText: "-m\npentest_agent\nmcp-server",
                      description: "真实安全工具：DNS / HTTP 探测 / 端口 / TLS / hash / JWT 分析",
                    })
                  }
                >
                  <Terminal size={12} /> 内置安全工具 Server
                </button>
                <button
                  className="btn tiny"
                  onClick={() =>
                    newServer({
                      name: "Filesystem MCP",
                      command: "npx",
                      argsText: "-y\n@modelcontextprotocol/server-filesystem\n/tmp",
                      description: "官方文件系统 MCP（只读访问 /tmp）",
                    })
                  }
                >
                  <Terminal size={12} /> 官方 Filesystem Server
                </button>
              </div>
            </div>
          ) : null}

          <div className={`ext-grid ${form ? "" : "ext-grid-mcp"}`}>
            {servers.map((server) => {
              const tested = testResults[server.id];
              const tools = serverTools(server);
              const testing = testingId === server.id;
              return (
                <div
                  key={server.id}
                  className={`card ext-mcp-card ${server.enabled ? "" : "disabled"}`}
                >
                  <div className="ext-card-top">
                    <div className="ext-card-title">
                      <span className="ext-icon mcp">
                        <PlugZap size={16} />
                      </span>
                      <div>
                        <h4>{server.name}</h4>
                        <div className="ext-subline">
                          <span className="ext-badge transport">{server.transport}</span>
                          <span className={`ext-status ${server.connected ? "up" : "idle"}`}>
                            {server.connected ? "已连接" : "未连接"}
                          </span>
                          <span className={`ext-badge ${server.enabled ? "ok" : "off"}`}>
                            {server.enabled ? "已启用" : "已停用"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <label className="switch ext-switch">
                      <input
                        type="checkbox"
                        checked={server.enabled}
                        onChange={() => void toggleServer(server)}
                      />
                      启用
                    </label>
                  </div>

                  <p className="ext-desc">
                    {server.description ||
                      (server.transport === "stdio"
                        ? "本地 stdio MCP 服务器"
                        : "Streamable HTTP MCP 服务器")}
                  </p>
                  <div className="ext-mono">
                    {server.transport === "stdio"
                      ? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ")
                      : server.url}
                  </div>

                  {tested && tested.ok && (
                    <div className="ext-test-ok">
                      ✓ 连接成功 · {tested.latency_ms ?? 0}ms · {tested.tools?.length ?? 0} 个工具
                    </div>
                  )}
                  {tested && !tested.ok && (
                    <div className="ext-test-error">✕ {tested.error}</div>
                  )}
                  {!tested && server.last_error && (
                    <div className="ext-test-error">✕ {server.last_error}</div>
                  )}
                  {!tested && !server.last_error && server.connected && (
                    <div className="ext-test-ok">✓ 已连接 · {server.tool_count ?? 0} 个工具</div>
                  )}

                  {tools.length > 0 && (
                    <div className="ext-tool-chips">
                      {tools.map((tool) => (
                        <span key={tool.name} className="ext-tool-chip" title={tool.description}>
                          <Wrench size={11} />
                          {tool.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="ext-actions">
                    <button
                      className="btn tiny"
                      onClick={() => void testServer(server)}
                      disabled={testing}
                    >
                      <RefreshCw size={13} className={testing ? "ext-spin" : ""} />
                      {testing ? "测试中…" : "测试连接"}
                    </button>
                    <button className="btn tiny" onClick={() => editServer(server)}>
                      <Settings2 size={13} />
                      编辑
                    </button>
                    <button className="btn tiny danger" onClick={() => void removeServer(server)}>
                      <X size={13} />
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="form-hint ext-footnote">
            stdio 服务器会以当前用户权限执行本地命令，请只接入可信来源；
            HTTP 服务器建议只连本机 / 内网地址。工具调用始终在本机进行。
          </p>
        </>
      )}

      {preview && (
        <Overlay
          title={preview.name}
          subtitle={`${preview.id} · ${preview.source === "builtin" ? "内置技能" : "已安装"} · ${preview.files} 个文件`}
          onClose={() => setPreview(null)}
          wide
        >
          <pre className="ext-skill-content">{preview.content}</pre>
          {preview.file_list.length > 0 && (
            <div className="ext-skill-files">
              <span className="field-label">技能文件</span>
              <div className="ext-tool-chips">
                {preview.file_list.map((file) => (
                  <span key={file} className="ext-tool-chip mono">
                    {file}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Overlay>
      )}
    </section>
  );
}
