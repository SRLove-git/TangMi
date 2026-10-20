import type {
  AssetItem,
  Catalog,
  ChatEvent,
  ChatMode,
  ConversationMeta,
  ConversationState,
  DeployCatalog,
  DeployDisk,
  DeployLab,
  DeployLogs,
  DeployTask,
  KnowledgeResponse,
  LabContext,
  LabSource,
  LatestResult,
  LearningReport,
  LearningSnapshot,
  LocalLabSources,
  QuizGenerateResult,
  QuizGradeResult,
  QuizQuestion,
  LLMSettings,
  DashboardData,
  Project,
  ReportFile,
  ScanPolicy,
  ScanRecord,
  VulnerabilityItem,
  RunConfig,
  RunEvent,
  RunMeta,
  RepeaterResult,
  RunSnapshot,
  SendMessageResponse,
  SystemInfo,
  ExtensionsSnapshot,
  SkillDetail,
  SkillItem,
  MCPServerConfig,
  MCPTestResult,
  MCPToolInfo,
  MCPUpsertPayload,
} from "./types";

const API = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) detail = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const api = {
  system: () => request<SystemInfo>("/system"),
  catalog: () => request<Catalog>("/catalog"),
  runs: (limit = 50) => request<{ runs: RunMeta[] }>(`/runs?limit=${limit}`),
  run: (id: string, after = 0) =>
    request<RunSnapshot>(`/runs/${id}?after=${after}`),
  startRun: (config: RunConfig) =>
    request<RunSnapshot>("/runs", {
      method: "POST",
      body: JSON.stringify(config),
    }),
  cancelRun: (id: string) =>
    request<{ cancelled: boolean }>(`/runs/${id}/cancel`, { method: "POST" }),
  reports: () => request<{ reports: ReportFile[] }>("/reports"),
  report: async (name: string) => {
    const res = await fetch(`${API}/reports/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`报告读取失败: ${res.status}`);
    if (name.endsWith(".json")) return res.text();
    return res.text();
  },
  latestResult: () => request<LatestResult>("/results/latest"),

  // ------------------------------------------------------------ 平台数据
  policies: () => request<{ policies: ScanPolicy[] }>("/policies"),
  dashboard: (projectId?: string) =>
    request<DashboardData>(`/dashboard${projectId ? `?project_id=${projectId}` : ""}`),
  assets: (projectId?: string) =>
    request<{ assets: AssetItem[] }>(`/assets${projectId ? `?project_id=${projectId}` : ""}`),
  vulnerabilities: (params: { projectId?: string; status?: string; severity?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params.projectId) query.set("project_id", params.projectId);
    if (params.status) query.set("status", params.status);
    if (params.severity) query.set("severity", params.severity);
    if (params.search) query.set("search", params.search);
    const suffix = query.toString();
    return request<{ vulnerabilities: VulnerabilityItem[] }>(`/vulnerabilities${suffix ? `?${suffix}` : ""}`);
  },
  updateVulnerability: (id: string, changes: { status?: string; note?: string }) =>
    request<{ vulnerability: VulnerabilityItem }>(`/vulnerabilities/${id}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    }),
  scans: (projectId?: string) =>
    request<{ scans: ScanRecord[] }>(`/scans${projectId ? `?project_id=${projectId}` : ""}`),

  // ------------------------------------------------------------ 对话工作区
  projects: () => request<{ projects: Project[] }>("/projects"),
  createProject: (name: string, target: string) =>
    request<{ project: Project }>("/projects", {
      method: "POST",
      body: JSON.stringify({ name, target }),
    }),
  updateProject: (id: string, changes: Record<string, unknown>) =>
    request<{ project: Project }>(`/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    }),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),
  detectProject: (id: string) =>
    request<{ project: Project }>(`/projects/${id}/detect`, { method: "POST" }),
  createConversation: (projectId: string, title?: string) =>
    request<ConversationState>(`/projects/${projectId}/conversations`, {
      method: "POST",
      body: JSON.stringify({ title: title ?? "新对话" }),
    }),
  conversation: (id: string) =>
    request<ConversationState>(`/conversations/${id}`),
  deleteConversation: (id: string) =>
    request<{ ok: boolean }>(`/conversations/${id}`, { method: "DELETE" }),
  sendMessage: (
    conversationId: string,
    content: string,
    mode: ChatMode = "agent",
    data?: Record<string, unknown>,
  ) =>
    request<SendMessageResponse>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, mode, data: data ?? {} }),
    }),
  cancelConversation: (id: string) =>
    request<{ cancelled: boolean }>(`/conversations/${id}/cancel`, {
      method: "POST",
    }),

  // ------------------------------------------------------------ AI 教学模型
  llmSettings: () => request<LLMSettings>("/settings/llm"),
  saveLLMSettings: (payload: {
    base_url?: string;
    model?: string;
    api_key?: string;
    temperature?: number;
    max_tokens?: number;
  }) =>
    request<LLMSettings>("/settings/llm", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  llmModels: () =>
    request<{
      ok: boolean;
      models: string[];
      base_url: string;
      current_model: string;
      endpoint: string;
    }>("/settings/llm/models"),
  testLLMSettings: () =>
    request<{ ok: boolean; message?: string; latency_ms?: number; model?: string; reply?: string }>(
      "/settings/llm/test",
      { method: "POST" },
    ),

  // ------------------------------------------------------------ 靶场部署
  deployCatalog: () => request<DeployCatalog>("/deploy/catalog"),
  labSources: () => request<LocalLabSources>("/labs/local"),
  deployStatus: (key: string) =>
    request<DeployLab>(`/deploy/${encodeURIComponent(key)}/status`),
  deployAction: (key: string, action: "install" | "start" | "stop" | "remove") =>
    request<{ task: DeployTask }>(`/deploy/${encodeURIComponent(key)}/${action}`, {
      method: "POST",
    }),
  deployLogs: (key: string, tail = 200) =>
    request<DeployLogs>(`/deploy/${encodeURIComponent(key)}/logs?tail=${tail}`),
  deployDisk: () => request<DeployDisk>("/deploy/disk"),
  deployPrune: () =>
    request<{ ok: boolean; message: string; removed: Array<{ image: string; size_mb: number }>; freed_mb: number; errors: string[] }>(
      "/deploy/prune",
      { method: "POST" },
    ),

  // ------------------------------------------------------------ 学习进度
  learning: (reseed = false) =>
    request<LearningSnapshot>(`/learning${reseed ? "?reseed=1" : ""}`),
  updateLearning: (
    itemKey: string,
    changes: { status?: string; note?: string; review_done?: boolean },
  ) =>
    request<{ item: import("./types").LearningItem }>(
      `/learning/${encodeURIComponent(itemKey)}`,
      { method: "PATCH", body: JSON.stringify(changes) },
    ),
  labSource: (itemKey: string) =>
    request<LabSource>(`/lab/source?item_key=${encodeURIComponent(itemKey)}`),
  labKnowledge: (itemKey: string) =>
    request<KnowledgeResponse>(`/lab/knowledge?item_key=${encodeURIComponent(itemKey)}`),
  quizGenerate: (itemKey: string, count = 3) =>
    request<QuizGenerateResult>(
      `/learning/${encodeURIComponent(itemKey)}/quiz/generate`,
      { method: "POST", body: JSON.stringify({ count }) },
    ),
  quizGrade: (
    itemKey: string,
    payload: {
      questions: QuizQuestion[];
      answers: Array<{ id: number; answer: string }>;
      hints_used: number;
    },
  ) =>
    request<{ result: QuizGradeResult; item: import("./types").LearningItem }>(
      `/learning/${encodeURIComponent(itemKey)}/quiz/grade`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  learningReport: (includeAi = false) =>
    request<LearningReport>(`/learning/report${includeAi ? "?ai=1" : ""}`),
  labContext: (payload: { item_key?: string; text?: string; refresh?: boolean }) =>
    request<LabContext>("/lab/context", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // ------------------------------------------------------------ 请求重放器
  repeaterSend: (payload: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  }) =>
    request<RepeaterResult>("/repeater/send", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // ------------------------------------------------------------ 扩展（技能 / MCP）
  extensions: () => request<ExtensionsSnapshot>("/extensions"),
  skills: () => request<{ skills: SkillItem[] }>("/extensions/skills"),
  skillDetail: (id: string) =>
    request<SkillDetail>(`/extensions/skills/${encodeURIComponent(id)}`),
  installSkillZip: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API}/extensions/skills/install`, {
      method: "POST",
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      skill?: SkillItem;
    };
    if (!res.ok) throw new Error(data.error || `安装失败（${res.status}）`);
    return data;
  },
  installSkillPath: (path: string) =>
    request<{ ok: boolean; skill: SkillItem }>("/extensions/skills/install-path", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  toggleSkill: (id: string, enabled: boolean) =>
    request<{ ok: boolean; skill: SkillItem }>(
      `/extensions/skills/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ enabled }) },
    ),
  deleteSkill: (id: string) =>
    request<{ ok: boolean; skills: SkillItem[] }>(
      `/extensions/skills/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  mcpServers: () =>
    request<{
      servers: MCPServerConfig[];
      status: { enabled: number; connected: number; tools: number };
    }>("/extensions/mcp"),
  saveMcpServer: (payload: MCPUpsertPayload) =>
    request<{ ok: boolean; server: MCPServerConfig }>("/extensions/mcp", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  toggleMcpServer: (id: string, enabled: boolean) =>
    request<{ ok: boolean; server: MCPServerConfig }>(
      `/extensions/mcp/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ enabled }) },
    ),
  deleteMcpServer: (id: string) =>
    request<{ ok: boolean; servers: MCPServerConfig[] }>(
      `/extensions/mcp/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  testMcpServer: (id: string) =>
    request<MCPTestResult>(`/extensions/mcp/${encodeURIComponent(id)}/test`, {
      method: "POST",
    }),
  mcpServerTools: (id: string) =>
    request<{ server_id: string; tools: MCPToolInfo[] }>(
      `/extensions/mcp/${encodeURIComponent(id)}/tools`,
    ),
};

export interface StreamHandlers<T = RunEvent> {
  onEvent: (event: T) => void;
  onEnd?: () => void;
  onError?: (error: Event) => void;
}

/**
 * 订阅运行事件流（SSE）。返回取消订阅函数。
 * 后端会先回放 after 之后的历史事件，再推送实时事件。
 */
export function streamRun(
  runId: string,
  after: number,
  handlers: StreamHandlers<RunEvent>,
): () => void {
  const source = new EventSource(
    `${API}/runs/${encodeURIComponent(runId)}/stream?after=${after}`,
  );
  let closed = false;
  source.onmessage = (message) => {
    let event: RunEvent;
    try {
      event = JSON.parse(message.data) as RunEvent;
    } catch {
      return;
    }
    if (event.type === "end") {
      if (!closed) {
        closed = true;
        source.close();
        handlers.onEnd?.();
      }
      return;
    }
    handlers.onEvent(event);
    if (event.type === "done") {
      if (!closed) {
        closed = true;
        source.close();
        handlers.onEnd?.();
      }
    }
  };
  source.onerror = (error) => {
    if (!closed && source.readyState === EventSource.CLOSED) {
      closed = true;
      handlers.onError?.(error);
      handlers.onEnd?.();
    }
  };
  return () => {
    if (!closed) {
      closed = true;
      source.close();
    }
  };
}


/** 订阅对话事件流（SSE）。 */
export function streamConversation(
  conversationId: string,
  after: number,
  handlers: StreamHandlers<ChatEvent>,
): () => void {
  const source = new EventSource(
    `${API}/conversations/${encodeURIComponent(conversationId)}/stream?after=${after}`,
  );
  let closed = false;
  source.onmessage = (message) => {
    let event: ChatEvent;
    try {
      event = JSON.parse(message.data) as ChatEvent;
    } catch {
      return;
    }
    if (event.type === "end") {
      if (!closed) {
        closed = true;
        source.close();
        handlers.onEnd?.();
      }
      return;
    }
    handlers.onEvent(event);
    if (event.type === "done") {
      if (!closed) {
        closed = true;
        source.close();
        handlers.onEnd?.();
      }
    }
  };
  source.onerror = (error) => {
    if (!closed && source.readyState === EventSource.CLOSED) {
      closed = true;
      handlers.onError?.(error);
      handlers.onEnd?.();
    }
  };
  return () => {
    if (!closed) {
      closed = true;
      source.close();
    }
  };
}
