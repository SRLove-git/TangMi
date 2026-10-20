import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  History,
  Play,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { api } from "../../api";
import type { RepeaterResult } from "../../types";
import { PageHeader } from "./shared";

interface HistoryItem {
  id: string;
  ts: string;
  method: string;
  url: string;
  headers: string;
  body: string;
}

const HISTORY_KEY = "pa-repeater-history";
const MAX_HISTORY = 20;

const PRESETS: Array<{ label: string; method: string; url: string; headers: string; body: string }> = [
  {
    label: "DVWA 登录页",
    method: "GET",
    url: "http://127.0.0.1:4280/login.php",
    headers: "",
    body: "",
  },
  {
    label: "DVWA SQL 注入",
    method: "GET",
    url: "http://127.0.0.1:4280/vulnerabilities/sqli/?id=1&Submit=Submit",
    headers: "Cookie: security=low; PHPSESSID=你的会话ID",
    body: "",
  },
  {
    label: "SQLi-Labs Less-1",
    method: "GET",
    url: "http://127.0.0.1:8085/Less-1/?id=1",
    headers: "",
    body: "",
  },
  {
    label: "演示站搜索（SQLi）",
    method: "POST",
    url: "http://127.0.0.1:8899/search",
    headers: "Content-Type: application/x-www-form-urlencoded",
    body: "q=test",
  },
];

function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const index = line.indexOf(":");
    if (index > 0) {
      headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
  }
  return headers;
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as HistoryItem[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export default function RepeaterView() {
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("http://127.0.0.1:4280/login.php");
  const [headersText, setHeadersText] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<RepeaterResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [responseTab, setResponseTab] = useState<"body" | "headers" | "render">("body");
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory());
  const [copied, setCopied] = useState(false);

  const prettyBody = useMemo(() => {
    const text = result?.response.body ?? "";
    if (!text) return "";
    const contentType = result?.response.content_type ?? "";
    if (contentType.includes("json")) {
      try {
        return JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        return text;
      }
    }
    return text;
  }, [result]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function send() {
    setLoading(true);
    setError("");
    try {
      const data = await api.repeaterSend({
        method,
        url,
        headers: parseHeaders(headersText),
        body,
      });
      setResult(data);
      const entry: HistoryItem = {
        id: `${Date.now()}`,
        ts: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        method,
        url,
        headers: headersText,
        body,
      };
      const next = [entry, ...history].slice(0, MAX_HISTORY);
      setHistory(next);
      try {
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setMethod(preset.method);
    setUrl(preset.url);
    setHeadersText(preset.headers);
    setBody(preset.body);
    setResult(null);
    setError("");
  }

  function restore(item: HistoryItem) {
    setMethod(item.method);
    setUrl(item.url);
    setHeadersText(item.headers);
    setBody(item.body);
    setResult(null);
    setError("");
  }

  function clearHistory() {
    setHistory([]);
    try {
      window.localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="platform-view repeater-view">
      <PageHeader
        eyebrow="HTTP Repeater"
        title="请求重放器"
        subtitle="手工改包重放，实时查看原始响应 —— 学 SQLi / XSS / 越权时最直接的验证工具。仅允许本机 / 内网靶场。"
        actions={
          <button className="btn" onClick={() => void send()} disabled={loading}>
            <Send size={14} />
            {loading ? "发送中…" : "发送请求"}
          </button>
        }
      />

      {error && <div className="alert error">{error}</div>}

      <div className="repeater-presets">
        {PRESETS.map((preset) => (
          <button key={preset.label} className="deploy-filter" onClick={() => applyPreset(preset)}>
            {preset.label}
          </button>
        ))}
      </div>

      <div className="repeater-grid">
        <div className="card repeater-request">
          <div className="card-head">
            <h4>
              <Play size={15} /> 请求
            </h4>
          </div>
          <div className="repeater-method-row">
            <select className="select repeater-method" value={method} onChange={(event) => setMethod(event.target.value)}>
              {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <input
              className="text-input"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://127.0.0.1:4280/..."
              spellCheck={false}
            />
          </div>
          <label className="field-label">请求头（每行 Key: Value）</label>
          <textarea
            className="text-input headers-input"
            rows={4}
            value={headersText}
            onChange={(event) => setHeadersText(event.target.value)}
            placeholder={"Cookie: security=low; PHPSESSID=...\nContent-Type: application/x-www-form-urlencoded"}
            spellCheck={false}
          />
          <label className="field-label">请求体</label>
          <textarea
            className="text-input repeater-body"
            rows={5}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={"id=1' AND '1'='1\n或 JSON：{\"username\":\"admin\"}"}
            spellCheck={false}
          />
          <div className="repeater-actions">
            <button className="btn primary" onClick={() => void send()} disabled={loading}>
              <Send size={14} />
              {loading ? "发送中…" : "发送"}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setResult(null);
                setError("");
              }}
            >
              清空响应
            </button>
          </div>
          <p className="form-hint">
            作用域守卫默认只允许 localhost / 内网地址；重放请求不会自动记录到扫描报告。
          </p>
        </div>

        <div className="card repeater-response">
          <div className="card-head">
            <h4>
              <RefreshCw size={15} /> 响应
            </h4>
            {result && (
              <span className="repeater-status">
                <b className={result.response.status < 400 ? "ok" : "bad"}>{result.response.status}</b>
                <span>{result.response.reason}</span>
                <span className="muted">· {result.response.elapsed_ms} ms · {(result.response.size / 1024).toFixed(1)} KB</span>
              </span>
            )}
          </div>

          {!result && !loading && (
            <p className="muted small">在左侧构造请求并点击「发送」，这里会显示真实响应。</p>
          )}

          {result && (
            <>
              <div className="segmented repeater-tabs">
                <button className={`segment ${responseTab === "body" ? "active" : ""}`} onClick={() => setResponseTab("body")}>
                  原始响应
                </button>
                <button className={`segment ${responseTab === "headers" ? "active" : ""}`} onClick={() => setResponseTab("headers")}>
                  响应头
                </button>
                <button className={`segment ${responseTab === "render" ? "active" : ""}`} onClick={() => setResponseTab("render")}>
                  渲染（无脚本）
                </button>
              </div>
              {responseTab === "body" && (
                <>
                  {result.response.body_truncated && (
                    <p className="form-hint">响应体过大，只显示前 300 KB。</p>
                  )}
                  <pre className="code-block repeater-output">{prettyBody}</pre>
                </>
              )}
              {responseTab === "headers" && (
                <div className="repeater-headers">
                  {Object.entries(result.response.headers).map(([key, value]) => (
                    <div key={key} className="repeater-header-row">
                      <span>{key}</span>
                      <code>{value}</code>
                    </div>
                  ))}
                </div>
              )}
              {responseTab === "render" && (
                <iframe
                  className="repeater-render"
                  title="渲染响应"
                  sandbox=""
                  srcDoc={result.response.body}
                />
              )}
              <div className="repeater-response-actions">
                <button
                  className="btn tiny ghost"
                  onClick={() => {
                    void navigator.clipboard?.writeText(result.response.body).catch(() => undefined);
                    setCopied(true);
                  }}
                >
                  {copied ? "已复制" : "复制响应体"}
                </button>
                <span className="form-hint mono">{result.response.url}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {history.length > 0 && (
        <div className="card repeater-history">
          <div className="card-head">
            <h4>
              <History size={15} /> 历史记录
            </h4>
            <button className="btn tiny ghost" onClick={clearHistory}>
              <Trash2 size={12} /> 清空
            </button>
          </div>
          <div className="repeater-history-list">
            {history.map((item) => (
              <button key={item.id} className="repeater-history-item" onClick={() => restore(item)}>
                <span className={`repeater-method-tag ${item.method.toLowerCase()}`}>{item.method}</span>
                <span className="mono ellipsis">{item.url}</span>
                <small>{item.ts}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="form-hint">
        <ExternalLink size={12} /> 小技巧：把 DVWA 的「安全等级」Cookie 改成 high/impossible，再重放同一个 payload，可以直观对比防御差异。
      </p>
    </section>
  );
}
