# Pentest Agent Web Console（对话式工作台前端）

React 18 + TypeScript + Vite 实现的本地靶场渗透智能体对话式工作台，交互形态参考 Codex / Claude Desktop：**左侧项目与会话，右侧对话线程**。

## 开发

```bash
npm install
npm run dev      # http://127.0.0.1:5173 ，/api 代理到 Flask 后端 8777
```

先启动后端：

```bash
cd ..
python -m pentest_agent web --no-browser
```

## 构建

```bash
npm run build    # 输出到 web/dist/
```

构建后直接访问后端地址即可（Flask 会托管 `web/dist`）：

```bash
python -m pentest_agent web
# http://127.0.0.1:8777
```

## 目录

```
src/
├── main.tsx              # 入口
├── App.tsx               # 项目管理、会话订阅、发送消息、弹窗编排
├── api.ts                # REST + SSE 客户端（含对话事件流）
├── types.ts              # 与后端 /api 对应的类型
├── utils.ts              # 状态/时间格式化、矩阵分组、Markdown 安全渲染
├── styles.css            # 深色主题样式
└── components/
    ├── chat/
    │   ├── Sidebar.tsx       # 左侧：项目 / 会话 / 靶场状态
    │   ├── ChatView.tsx      # 右侧：对话区（欢迎页、消息、实时任务）
    │   ├── MessageItem.tsx   # 消息气泡 + Markdown + 统计卡片 + 操作按钮
    │   ├── RunCard.tsx       # 实时任务卡片（进度/最新发现/日志）
    │   ├── Composer.tsx      # 输入框 + 快捷提示
    │   ├── Overlay.tsx       # 通用弹窗
    │   ├── MatrixModal.tsx   # 结果矩阵弹窗（DVWA / SQLi-Labs）
    │   ├── FindingsModal.tsx # 通用扫描发现（按风险等级分组）
    │   ├── ReportModal.tsx   # 报告弹窗
    │   └── NewProjectModal.tsx
    ├── MatrixView.tsx        # DVWA 矩阵 + SQLi 关卡网格（复用）
    ├── FindingDrawer.tsx     # 证据抽屉（复用）
    └── ReportView.tsx        # 报告渲染（复用）
```

## 平台工作区

顶部导航包含 6 个视图：

- **工作台**：左侧项目/会话 + 右侧对话，指挥 Agent 执行扫描与靶场任务（主界面）；
- **态势**：风险统计、等级分布、分类/OWASP 分布、最近扫描；
- **资产**：扫描自动沉淀的主机/端口/服务/子域/技术栈/接口；
- **漏洞**：漏洞库与生命周期（待确认/已确认/误报/已修复/接受风险 + 备注）；
- **扫描**：全部任务历史，可回看结果/矩阵；
- **设置**：项目扫描策略、认证请求头、浏览器验证与外部目标授权开关。

平台数据来自后端 `/api/dashboard`、`/api/assets`、`/api/vulnerabilities`、`/api/scans`、`/api/policies`，组件位于 `src/components/views/`。

## 进阶扫描展示

- 「发现」弹窗顶部展示攻击面摘要（技术栈 / 开放端口 / 子域 / 接口数 / 敏感信息数），数据来自 `run.result_meta`；
- 报告弹窗支持 Markdown / HTML / JSON 三种格式：HTML 报告通过 iframe 直接预览，可下载为单文件归档；
- 风险徽章、严重级别圆点使用独立的状态色令牌，避免与主题色混淆。

## 设计系统（参考 TREK）

- 主题令牌全部定义在 `src/styles.css`：`--bg-*` / `--text-*` / `--border-*` / `--accent*` / `--success` 等，light 在 `:root`、dark 在 `.dark`；
- 字体：Poppins（界面）+ Geist Sans（数字/辅助），通过 `@fontsource` 本地打包，无外部请求；
- 图标：lucide-react 线性图标；
- 布局：悬浮玻璃顶栏（`TopBar`）+ 左侧项目卡片（`Sidebar`）+ 右侧对话卡片（`ChatView`）；卡片圆角 20px、近黑主按钮、大写 eyebrow 小标题；
- 主题切换：`App.tsx` 维护 `theme` 状态并写入 `<html class="dark">`，`index.html` 首屏脚本防闪烁，localStorage 持久化（键 `pa-theme`）；
- 新增组件请复用上述令牌与 `.btn/.card/.eyebrow/.status-dot` 等基础类，避免硬编码颜色。

## 说明

- 所有数据均来自 `/api`，无本地 mock；
- 对话事件通过 SSE（`/api/conversations/{id}/stream`）实时推送：消息增量、任务进度、日志、发现；
- 报告 / 消息 Markdown 渲染前会转义原始 HTML（靶场响应可能包含脚本）；
- 默认仅连接 `127.0.0.1`，与 CLI 的作用域守卫保持一致。
