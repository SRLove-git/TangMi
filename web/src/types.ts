/** 与后端 /api 接口对应的类型定义。 */

export type Tab = "overview" | "run" | "results" | "report";

export type Status = "exploited" | "protected" | "failed" | "skipped" | "error";

export interface Finding {
  lab: string;
  target: string;
  level: string;
  status: Status;
  title: string;
  severity: string;
  technique: string;
  payload: string;
  evidence: string;
  request?: string;
  response?: string;
  notes: string;
  category?: string;
  cwe?: string;
  remediation?: string;
  cvss?: number;
  duration_ms: number;
  timestamp?: string;
  attempts?: number;
}

export interface LabSummary {
  lab: string;
  target_url: string;
  total: number;
  exploited: number;
  protected: number;
  failed: number;
  skipped: number;
  expected_exploit: number;
  expected_protected: number;
  fully_solved: boolean;
  coverage: number;
  started_at?: string;
  finished_at?: string;
}

export interface RunResult {
  lab: string;
  target_url: string;
  summary: LabSummary;
  findings: Finding[];
  meta?: Record<string, unknown>;
}

export interface LogEntry {
  level: string;
  message: string;
}

export interface Progress {
  done: number;
  total: number;
  percent: number;
}

export interface RunEvent {
  seq: number;
  ts: string;
  type: "log" | "finding" | "progress" | "status" | "done" | "end";
  payload: Record<string, unknown>;
}

export interface RunConfig {
  target: string;
  lab: string;
  allow_remote?: boolean;
  browser?: boolean | null;
  label?: string;
  modules?: string[];
  levels?: string[];
  lessons?: string | string[];
}

export interface RunSnapshot {
  id: string;
  kind: "scan" | "lab";
  config: RunConfig & { action?: string };
  status: string;
  created_at: string;
  started_at: string;
  finished_at: string;
  error: string;
  summary: Record<string, unknown> | null;
  progress: Progress;
  findings: Finding[];
  logs: LogEntry[];
  events?: RunEvent[];
  seq: number;
  /** 扫描结果元信息（技术栈 / 端口 / 子域 / 接口 / 敏感信息数） */
  result_meta?: {
    tech?: string[];
    open_ports?: number[];
    ports?: Array<{ port: number }>;
    subdomains?: string[];
    endpoints?: string[];
    secrets_count?: number;
    [key: string]: unknown;
  };
  /** 前端附加：历史运行时由 result 字段恢复 */
  result?: {
    runs?: RunResult[];
    meta?: {
      tech?: string[];
      open_ports?: number[];
      ports?: Array<{ port: number }>;
      subdomains?: string[];
      endpoints?: string[];
      secrets_count?: number;
      [key: string]: unknown;
    };
  } | null;
}

export interface RunMeta {
  id: string;
  kind: "scan" | "lab";
  lab: string;
  target: string;
  action?: string;
  status: string;
  created_at: string;
  started_at: string;
  finished_at: string;
  summary: Record<string, unknown> | null;
  error: string;
  progress: Progress;
  findings_count: number;
}

export interface ModuleInfo {
  key: string;
  title: string;
  exploitable: string[];
}

export interface Catalog {
  dvwa: { levels: string[]; modules: ModuleInfo[] };
  sqli_labs: { lessons: string[] };
}

export interface SystemInfo {
  version: string;
  python: string;
  project_root: string;
  lab_urls: { dvwa: string; sqli_labs: string };
  lab_http: { dvwa: boolean; sqli_labs: boolean };
  web_dist_exists: boolean;
  runs: number;
  /** AI 教学模式（导师）是否已配置 LLM */
  llm_configured?: boolean;
  /** 当前使用的模型名（未配置时为空） */
  llm_model?: string;
}

export interface LabStatus {
  docker: boolean;
  dvwa_image: boolean;
  sqli_image: boolean;
  dvwa_http: boolean;
  sqli_http: boolean;
  compose_ps?: string;
}

export interface ReportFile {
  name: string;
  size: number;
  mtime: string;
  kind: "markdown" | "json" | "html";
}

export interface LatestResult {
  tool?: string;
  generated_at?: string;
  runs: RunResult[];
}


/* ------------------------------------------------------------- 对话工作区 */
/** agent = 执行模式（LLM Agent 调工具跑靶场/扫描，未配置模型时回退规则引擎）；tutor = 教学模式（LLM 导师答疑） */
export type ChatMode = "agent" | "tutor";

export interface ConversationMeta {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  busy: boolean;
  message_count: number;
}

export interface Project {
  id: string;
  name: string;
  target: string;
  lab: "dvwa" | "sqli-labs" | "web" | "unknown";
  browser: boolean;
  allow_remote: boolean;
  policy?: string;
  headers?: Record<string, string>;
  created_at: string;
  updated_at: string;
  conversations: ConversationMeta[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind: string;
  created_at: string;
  data: {
    actions?: string[];
    run_id?: string;
    summary?: Record<string, unknown>;
    /** 该条用户消息使用的模式（tutor 时前端展示教学标记） */
    mode?: ChatMode;
    /** 教学模式回复使用的模型 */
    model?: string;
    /** 学习条目（如 dvwa:sqli:low / sqli:Less-5） */
    item_key?: string;
    /** 分层提示层级（1~4，4=答案） */
    hint_level?: number;
    /** 部署/扫描等附加信息 */
    url?: string;
    task_id?: string;
    /** 大模型思考过程（reasoning_content 流式累积） */
    reasoning?: string;
    /** 本轮 Agent 调用过的工具（按执行顺序） */
    tools?: ToolCallView[];
    /** update_plan 工具产出的执行计划 */
    plan?: PlanState;
    /** 该条助手消息是否仍在流式生成 */
    streaming?: boolean;
    /** 用户主动停止生成 */
    stopped?: boolean;
    [key: string]: unknown;
  };
}

/** Agent 工具调用卡片 */
export interface ToolCallView {
  id: string;
  name: string;
  label?: string;
  args?: Record<string, unknown>;
  status: "running" | "done" | "error";
  output?: string;
  elapsed_ms?: number;
  run_id?: string;
  actions?: string[];
  started_at?: string;
}

/** Agent 执行计划（update_plan 工具） */
export interface PlanState {
  steps: { text: string; status: "pending" | "running" | "completed" }[];
}

export interface ConversationState {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  busy: boolean;
  active_run_id: string | null;
  last_run_id: string | null;
  messages: ChatMessage[];
  seq: number;
}

export interface ChatEvent {
  seq: number;
  ts: string;
  type:
    | "message"
    | "delta"
    | "reasoning"
    | "run"
    | "run_log"
    | "turn"
    | "done"
    | "end";
  payload: Record<string, unknown>;
}

export interface LatestFindingBrief {
  target: string;
  level: string;
  status: string;
  title: string;
}

export interface RunLive {
  run_id: string;
  label?: string;
  lab?: string;
  target?: string;
  status: string;
  progress: Progress;
  findings_count: number;
  latest_finding?: LatestFindingBrief | null;
  summary?: Record<string, unknown> | null;
  logs: { level: string; message: string }[];
}

export interface SendMessageResponse {
  message: ChatMessage;
  seq: number;
  conversation: ConversationMeta;
}


// ------------------------------------------------------------ 平台视图
export type AppView =
  | "chat"
  | "deploy"
  | "learning"
  | "repeater"
  | "records"
  | "settings";

export interface ScanPolicy {
  id: string;
  name: string;
  description: string;
  profile: string;
  modules: string[];
}

export interface VulnerabilityItem {
  id: string;
  project_id: string;
  run_id: string;
  title: string;
  severity: string;
  category: string;
  cwe: string;
  owasp: string;
  target: string;
  technique: string;
  payload: string;
  evidence: string;
  remediation: string;
  cvss: number;
  status: string;
  status_label: string;
  note: string;
  first_seen: string;
  last_seen: string;
}

export interface AssetItem {
  kind: string;
  host: string;
  port: number | null;
  service: string;
  url: string;
  tech: string[];
  detail: string;
  first_seen: string;
  last_seen: string;
  hits: number;
}

export interface ScanRecord {
  run_id: string;
  project_id: string;
  target: string;
  lab: string;
  profile: string;
  status: string;
  findings_count: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  started_at: string;
  finished_at: string;
  created_at: string;
}

export interface DashboardData {
  severity: Record<string, number>;
  status: Record<string, number>;
  categories: Array<{ category: string; count: number }>;
  owasp: Array<{ owasp: string; count: number }>;
  vuln_total: number;
  open_total: number;
  scans: number;
  findings_total: number;
  assets: number;
  asset_kinds: Record<string, number>;
  recent_scans: ScanRecord[];
  trend: Array<{ day: string; findings: number }>;
}

/** AI 教学模式（导师）的 LLM 配置视图（密钥只返回掩码）。 */
export interface LLMSettings {
  configured: boolean;
  base_url: string;
  model: string;
  temperature: number;
  max_tokens: number;
  api_key_masked: string;
  has_api_key: boolean;
  source: "ui" | "env" | "none" | string;
  is_local: boolean;
  settings_path: string;
}

/* --------------------------------------------------------- 靶场部署中心 */
export interface DeployTask {
  id: string;
  lab_key: string;
  action: "install" | "start" | "stop" | "remove";
  status: "running" | "success" | "failed";
  message: string;
  error: string;
  started_at: string;
  finished_at: string;
  logs: string[];
}

export interface DeployRuntime {
  state: "running" | "stopped" | "not_installed";
  container: string;
  port: number | null;
  url: string;
  adopted: boolean;
  healthy: boolean | null;
  image_present: boolean;
  status_text: string;
  task: DeployTask | null;
}

export interface DeployLab {
  key: string;
  name: string;
  subtitle: string;
  category: string;
  category_label: string;
  difficulty: string;
  description: string;
  tags: string[];
  image: string;
  builtin: boolean;
  heavy: boolean;
  credentials: string;
  notes: string;
  repo: string;
  container_port: number;
  preferred_port: number;
  health_kind: "http" | "tcp";
  runtime: DeployRuntime;
}

export interface DeployCatalog {
  docker: {
    available: boolean;
    version: string;
    platform: string;
    arch: string;
  };
  categories: Array<{ key: string; label: string }>;
  labs: DeployLab[];
  generated_at: string;
  running: number;
  total: number;
}

export interface DeployLogs {
  lab: string;
  lines: string[];
}


/* --------------------------------------------------------- 学习进度 */
export type LearningStatus = "not_started" | "learning" | "solved" | "review";

export interface LearningItem {
  key: string;
  lab: "dvwa" | "sqli-labs";
  module: string | null;
  module_title: string | null;
  level: string | null;
  lesson: string | null;
  title: string;
  url: string;
  status: LearningStatus;
  status_label: string;
  hints: number;
  notes: string;
  tutor_turns: number;
  auto_verified: boolean;
  auto_status: string;
  updated_at: string;
  review_at: string;
  review_count: number;
  best_score: number;
  quiz_attempts: Array<{ ts: string; score: number; passed: boolean; summary: string; questions: number }>;
  last_quiz_at: string;
}

export interface LearningSummary {
  total: number;
  solved: number;
  learning: number;
  review: number;
  not_started: number;
  notes: number;
  auto_verified: number;
  percent: number;
  dvwa_total: number;
  sqli_total: number;
  due_review: number;
  streak: number;
  quiz_passed: number;
}

export interface LearningSnapshot {
  items: string[];
  labs: { dvwa: LearningItem[]; "sqli-labs": LearningItem[] };
  summary: LearningSummary;
  labels: Record<string, string>;
  events: Array<{ ts: string; item: string; type: string; value: string }>;
  seeded: boolean;
  updated_at: string;
}

/* --------------------------------------------------------- 关卡源码 / 上下文 */
export interface LabSource {
  kind: "dvwa" | "sqli-labs";
  item_key: string;
  title: string;
  module?: string;
  module_title?: string;
  current_level?: string | null;
  levels: Record<string, { path: string; code: string }>;
  source?: { path: string; code: string };
  diffs: Array<{ from: string; to: string; text: string; has_changes: boolean }>;
  warnings: string[];
}

export interface LabContext {
  ok: boolean;
  item_key: string;
  title: string;
  lab: string;
  module: string | null;
  level: string | null;
  lesson: string | null;
  target: string;
  page: {
    url: string;
    title: string;
    text: string;
    forms: Array<{ action: string; method: string; fields: Array<{ name: string; type: string; value: string }> }>;
    query_params: string[];
    html: string;
  } | null;
  source: { path: string; code: string };
  warnings: string[];
  captured_at: string;
  note: string;
}

/* --------------------------------------------------------- 请求重放器 */
export interface RepeaterResult {
  ok: boolean;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  };
  response: {
    status: number;
    reason: string;
    headers: Record<string, string>;
    content_type: string;
    body: string;
    body_truncated: boolean;
    size: number;
    elapsed_ms: number;
    url: string;
  };
}

/* --------------------------------------------------------- 部署磁盘 */
export interface DeployDiskImage {
  image: string;
  size_mb: number;
  in_use: boolean;
  containers: string[];
}

export interface DeployDisk {
  available: boolean;
  images: DeployDiskImage[];
  total_mb: number;
  prune_candidates: string[];
  prune_mb: number;
  catalog_image_count?: number;
  docker_reclaim_hint?: string;
}


/* --------------------------------------------------------- 知识卡片 / AI 出题 / 报告 */
export interface KnowledgeCard {
  kind?: string;
  module?: string;
  level?: string;
  lesson?: string;
  title: string;
  cwe: string;
  owasp: string;
  principle: string;
  key_points: string[];
  defense: string;
  related?: string[];
  lessons?: string[];
}

export interface KnowledgeResponse {
  item_key: string;
  card: KnowledgeCard;
  stats: { dvwa_modules: number; sqli_groups: number; sqli_lessons: number };
}

export interface QuizQuestion {
  id: number;
  difficulty: string;
  question: string;
  hint: string;
  reference?: string;
}

export interface QuizGenerateResult {
  item_key: string;
  title: string;
  questions: QuizQuestion[];
  generated_at: string;
}

export interface QuizGradeResult {
  item_key: string;
  title: string;
  score: number;
  passed: boolean;
  summary: string;
  per_question: Array<{ id: number; correct: boolean; comment: string }>;
  improvements: string[];
  graded_at: string;
}

export interface LearningReport {
  markdown: string;
  filename: string;
  path: string;
  generated_at: string;
  summary: LearningSummary;
  include_ai: boolean;
}


/* --------------------------------------------------------- 本机靶场源（新建项目） */
export interface LocalLabSource {
  key: string;
  name: string;
  target: string;
  kind: "builtin" | "deploy" | "demo";
  lab: string;
  online: boolean;
  credentials: string;
  note: string;
  tags: string[];
}

export interface LocalLabSources {
  sources: LocalLabSource[];
  total: number;
  online: number;
  root: string;
}
