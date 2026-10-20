import { useEffect, useMemo, useState } from "react";
import { Bot, KeyRound, Loader2, PlugZap, Save, Search, Settings2, ShieldCheck } from "lucide-react";
import { api } from "../../api";
import type { LLMSettings, Project, ScanPolicy } from "../../types";
import { PageHeader } from "./shared";

interface Props {
  project: Project | null;
  onSaved: () => Promise<unknown> | void;
}

export default function SettingsView({ project, onSaved }: Props) {
  const [policies, setPolicies] = useState<ScanPolicy[]>([]);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [policy, setPolicy] = useState("quick");
  const [headersText, setHeadersText] = useState("");
  const [allowRemote, setAllowRemote] = useState(false);
  const [browser, setBrowser] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  // AI 教学模式（LLM）全局配置
  const [llm, setLlm] = useState<LLMSettings | null>(null);
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmTemperature, setLlmTemperature] = useState("0.5");
  const [llmMaxTokens, setLlmMaxTokens] = useState("1600");
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmTesting, setLlmTesting] = useState(false);
  const [llmMessage, setLlmMessage] = useState("");
  const [llmError, setLlmError] = useState("");
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [llmModelsLoading, setLlmModelsLoading] = useState(false);
  const [llmModelsError, setLlmModelsError] = useState("");

  useEffect(() => {
    api
      .policies()
      .then((data) => setPolicies(data.policies))
      .catch(() => setPolicies([]));
  }, []);

  const loadLlm = () => {
    api
      .llmSettings()
      .then((data) => {
        setLlm(data);
        setLlmBaseUrl(data.base_url);
        setLlmModel(data.model);
        setLlmApiKey("");
        setLlmTemperature(String(data.temperature));
        setLlmMaxTokens(String(data.max_tokens));
      })
      .catch((err) =>
        setLlmError(err instanceof Error ? err.message : String(err)),
      );
  };

  useEffect(() => {
    loadLlm();
  }, []);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setTarget(project.target);
    setPolicy(project.policy ?? "quick");
    setAllowRemote(project.allow_remote);
    setBrowser(project.browser);
    setHeadersText(
      Object.entries(project.headers ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n"),
    );
    setError("");
    setSaved("");
  }, [project]);

  const selectedPolicy = useMemo(
    () => policies.find((item) => item.id === policy),
    [policies, policy],
  );

  // ---------------------------------------------------------- AI 教学模型
  async function saveLLM() {
    setLlmSaving(true);
    setLlmError("");
    setLlmMessage("");
    try {
      const payload: {
        base_url: string;
        model: string;
        temperature: number;
        max_tokens: number;
        api_key?: string;
      } = {
        base_url: llmBaseUrl.trim(),
        model: llmModel.trim(),
        temperature: Number(llmTemperature) || 0.5,
        max_tokens: Number(llmMaxTokens) || 1600,
      };
      if (llmApiKey.trim()) payload.api_key = llmApiKey.trim();
      const updated = await api.saveLLMSettings(payload);
      setLlm(updated);
      setLlmApiKey("");
      setLlmTemperature(String(updated.temperature));
      setLlmMaxTokens(String(updated.max_tokens));
      setLlmMessage(
        updated.configured
          ? "AI 教学模型配置已保存，切到输入框的「教学模式」即可开始提问。"
          : "已保存，但配置还不完整，请检查 Base URL / 模型名称 / API Key。",
      );
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : String(err));
    } finally {
      setLlmSaving(false);
    }
  }

  async function testLLM() {
    setLlmTesting(true);
    setLlmError("");
    setLlmMessage("");
    try {
      const result = await api.testLLMSettings();
      if (result.ok) {
        setLlmMessage(
          `连接成功（${result.latency_ms ?? "?"}ms，模型 ${result.model ?? "?"}）：${
            result.reply ?? ""
          }`,
        );
      } else {
        setLlmError(result.message ?? "连接测试失败");
      }
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : String(err));
    } finally {
      setLlmTesting(false);
    }
  }

  async function detectModels() {
    setLlmModelsLoading(true);
    setLlmModelsError("");
    try {
      const data = await api.llmModels();
      setLlmModels(data.models);
      if (!data.models.length) {
        setLlmModelsError("接口没有返回可用模型列表");
      }
    } catch (err) {
      setLlmModels([]);
      setLlmModelsError(err instanceof Error ? err.message : String(err));
    } finally {
      setLlmModelsLoading(false);
    }
  }

  function renderLlmCard() {
    const configured = llm?.configured ?? false;
    const sourceLabel =
      llm?.source === "env" ? "环境变量" : llm?.source === "ui" ? "界面配置" : "";
    const statusText = `${configured ? "已配置" : "未配置"}${
      sourceLabel ? ` · ${sourceLabel}` : ""
    }`;
    return (
      <div className="card settings-card-wide">
        <div className="card-head">
          <h4>
            <Bot size={15} /> AI 教学模型（靶场导师）
          </h4>
          <span className={`llm-status ${configured ? "ok" : "off"}`}>
            {statusText}
          </span>
        </div>
        <p className="muted small">
          教学模式会把你的问题连同当前靶场上下文发给下方模型，以「助教」方式给思路、提示与
          原理解析（默认不直接剧透）。支持 DeepSeek / OpenAI 兼容接口 / 本地 Ollama。
          密钥只保存在本机 <code>web_data/llm_settings.json</code>（权限 0600），界面只显示掩码。
        </p>
        <div className="llm-grid">
          <div>
            <label className="field-label">Base URL</label>
            <input
              className="text-input"
              placeholder="https://api.deepseek.com"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div>
            <label className="field-label">模型名称</label>
            <input
              className="text-input"
              placeholder="deepseek-flash"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
        <div className="llm-model-detect">
          <button
            className="btn tiny"
            onClick={() => void detectModels()}
            disabled={llmModelsLoading}
            title="使用已保存的 Base URL / Key 查询 /models 接口"
          >
            {llmModelsLoading ? <Loader2 size={12} className="spin" /> : <Search size={12} />}
            {llmModelsLoading ? "探测中…" : "探测可用模型"}
          </button>
          {llmModels.length > 0 && (
            <div className="llm-model-chips">
              {llmModels.map((model) => (
                <button
                  key={model}
                  className={`deploy-filter ${llmModel === model ? "active" : ""}`}
                  onClick={() => {
                    setLlmModel(model);
                    setLlmModelsError("");
                  }}
                >
                  {model}
                </button>
              ))}
              {llmModel && !llmModels.includes(llmModel) && (
                <span className="form-hint">当前填写的模型不在探测结果中，保存前请确认</span>
              )}
            </div>
          )}
          {llmModelsError && <span className="form-hint llm-model-error">{llmModelsError}</span>}
          {llmModels.length > 0 && (
            <span className="form-hint">提示：先保存 Base URL / Key 再探测；点击模型名可一键填入</span>
          )}
        </div>
        <label className="field-label">API Key</label>
        <input
          className="text-input"
          type="password"
          autoComplete="new-password"
          placeholder={
            llm?.has_api_key
              ? `已保存：${llm.api_key_masked}（留空表示不修改）`
              : "sk-...（本地模型可留空）"
          }
          value={llmApiKey}
          onChange={(e) => setLlmApiKey(e.target.value)}
          spellCheck={false}
        />
        <div className="llm-grid llm-grid-small">
          <div>
            <label className="field-label">Temperature</label>
            <input
              className="text-input"
              value={llmTemperature}
              onChange={(e) => setLlmTemperature(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div>
            <label className="field-label">Max Tokens</label>
            <input
              className="text-input"
              value={llmMaxTokens}
              onChange={(e) => setLlmMaxTokens(e.target.value)}
              inputMode="numeric"
            />
          </div>
        </div>
        <p className="form-hint">
          DeepSeek：<code>https://api.deepseek.com</code> + <code>deepseek-flash</code>（快速）或
          <code>deepseek-v4-pro</code>（更强推理），可点上方「探测可用模型」自动获取；
          OpenAI：<code>https://api.openai.com/v1</code> + <code>gpt-4o-mini</code>；
          本地 Ollama：<code>http://127.0.0.1:11434/v1</code> + <code>qwen2.5:7b</code>
          （本地地址可不填 Key）。
        </p>
        {llmError && <div className="alert error">{llmError}</div>}
        {llmMessage && <div className="alert success-alert">{llmMessage}</div>}
        <div className="llm-actions">
          <button
            className="btn primary"
            onClick={() => void saveLLM()}
            disabled={llmSaving}
          >
            <Save size={14} />
            {llmSaving ? "保存中…" : "保存 AI 配置"}
          </button>
          <button
            className="btn"
            onClick={() => void testLLM()}
            disabled={llmTesting || !configured || Boolean(llmApiKey)}
          >
            <PlugZap size={14} />
            {llmTesting ? "测试中…" : "测试连接"}
          </button>
          {Boolean(llmApiKey) && (
            <span className="form-hint">先保存新 Key 再测试连接</span>
          )}
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <section className="platform-view settings-view">
        <PageHeader
          eyebrow="Settings"
          title="设置"
          subtitle="AI 教学模型为全局配置；选择项目后可额外配置项目扫描参数。"
        />
        <div className="settings-grid">{renderLlmCard()}</div>
      </section>
    );
  }

  const currentProject = project;

  async function save() {
    setSaving(true);
    setError("");
    setSaved("");
    const headers: Record<string, string> = {};
    for (const line of headersText.split("\n")) {
      const index = line.indexOf(":");
      if (index > 0) {
        headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      }
    }
    try {
      await api.updateProject(currentProject.id, {
        name,
        target,
        policy,
        headers,
        allow_remote: allowRemote,
        browser,
      });
      await onSaved();
      setSaved("配置已保存，下一次扫描生效。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="platform-view settings-view">
      <PageHeader
        eyebrow="Project Settings"
        title="项目设置"
        subtitle={`当前项目：${project.name} · ${project.target}`}
        actions={
          <button className="btn primary" onClick={() => void save()} disabled={saving}>
            <Save size={14} />
            {saving ? "保存中…" : "保存配置"}
          </button>
        }
      />

      {error && <div className="alert error">{error}</div>}
      {saved && <div className="alert success-alert">{saved}</div>}

      <div className="settings-grid">
        <div className="card">
          <div className="card-head">
            <h4>
              <Settings2 size={15} /> 基本信息
            </h4>
          </div>
          <label className="field-label">项目名称</label>
          <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="field-label">目标地址</label>
          <input className="text-input" value={target} onChange={(e) => setTarget(e.target.value)} />
          <p className="form-hint">
            修改目标地址会重新识别类型并校验作用域；默认只允许 localhost / 内网地址。
          </p>

          <label className="field-label">默认扫描策略</label>
          <select className="select" value={policy} onChange={(e) => setPolicy(e.target.value)}>
            {policies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {item.description}
              </option>
            ))}
          </select>
          {selectedPolicy && (
            <p className="form-hint">
              模块：{selectedPolicy.modules.join(", ")} · profile：{selectedPolicy.profile}
            </p>
          )}

          <div className="switch-row">
            <label className="switch">
              <input
                type="checkbox"
                checked={browser}
                onChange={(e) => setBrowser(e.target.checked)}
              />
              启用无头浏览器验证（DOM XSS / CSP 真实执行）
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={allowRemote}
                onChange={(e) => setAllowRemote(e.target.checked)}
              />
              允许扫描外部目标（需已获得书面授权）
            </label>
          </div>
          {allowRemote && (
            <div className="alert error warn-text">
              已开启外部目标扫描。请确认你拥有该目标的书面授权，并遵守当地法律法规。
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h4>
              <KeyRound size={15} /> 认证扫描
            </h4>
          </div>
          <p className="muted small">
            为需要登录的目标配置请求头（如 Authorization / Cookie），扫描器会自动携带。
          </p>
          <textarea
            className="text-input headers-input"
            rows={6}
            placeholder={"Authorization: Bearer eyJ...\nCookie: session=abc123"}
            value={headersText}
            onChange={(e) => setHeadersText(e.target.value)}
          />
          <p className="form-hint">
            请求头只保存在本地 `web_data/chat.json`，不会上传；报告中不会展示完整凭据。
          </p>

          <div className="card-head section-gap">
            <h4>
              <ShieldCheck size={15} /> 安全边界
            </h4>
          </div>
          <ul className="scope-list">
            <li>默认仅允许 localhost / 内网地址，外部目标必须显式开启。</li>
            <li>扫描为非破坏性：不写文件、不删数据、不反弹 shell。</li>
            <li>基础设施检查只读（INFO / stats / version）。</li>
            <li>发现需人工复核，自动化结果不替代专业渗透测试。</li>
          </ul>
        </div>

        {renderLlmCard()}
      </div>
    </section>
  );
}
