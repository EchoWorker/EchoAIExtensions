# EchoAI VS Code Extension — 设计方案

> **项目名称**: echo-vscode  
> **定位**: EchoAI gateway 的 VS Code 客户端插件，交互体验与 EchoWork chat 面板一致  
> **状态**: 设计阶段

---

## §1 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                    │
│                    (Node.js, TypeScript)                     │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  GatewayClient (ws)                                  │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │ JSON-RPC 2.0 over WebSocket                    │  │   │
│  │  │ - auth { token }                               │  │   │
│  │  │ - plugin.connect { name, type:'client' }       │  │   │
│  │  │ - chat.completions { session_key, content, … } │  │   │
│  │  │ - chat.enqueue { session_key, content }        │  │   │
│  │  │ - chat.cancel { session_key }                  │  │   │
│  │  │ - chat.subscribe { session_keys }              │  │   │
│  │  │ - session.list / session.history               │  │   │
│  │  │ - session.create / session.close / delete      │  │   │
│  │  │ - model.list / model.set                       │  │   │
│  │  │ - question.answer                              │  │   │
│  │  │ ← chat.event (notification)                    │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │                                   │
│  ┌──────────────────────▼───────────────────────────────┐   │
│  │  ConnectionManager                                   │   │
│  │  - 读 ~/.echoai/gateway.lock                        │   │
│  │  - 自动重连 (1s interval)                            │   │
│  │  - session/model 同步                                │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │                                   │
│  ┌──────────────────────▼───────────────────────────────┐   │
│  │  ChatViewProvider (WebviewViewProvider)               │   │
│  │  - 创建/恢复 webview                                  │   │
│  │  - host↔webview postMessage 桥接                      │   │
│  │  - 状态保持 (retainContextWhenHidden)                 │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │ postMessage                        │
└─────────────────────────┼───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                     Webview (React)                          │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  SessionTabBar                                        │  │
│  │  ┌─────┐ ┌─────┐ ┌─────┐  [+]                       │  │
│  │  │ Tab │ │ Tab │ │ Tab │                              │  │
│  │  └─────┘ └─────┘ └─────┘                             │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │  ConnectionBanner (disconnected/connecting 时显示)     │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │  MessageList                                          │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  UserBubble                                     │  │  │
│  │  │  ThinkingMessage                                │  │  │
│  │  │  TextBubble (streaming markdown)                │  │  │
│  │  │  ToolCallCard (折叠/展开)                        │  │  │
│  │  │  SubagentCard                                   │  │  │
│  │  │  QuestionCard / PlanReviewCard                  │  │  │
│  │  │  ErrorCard                                      │  │  │
│  │  │  StatusIndicator (思考中…)                       │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │  InputBox                                             │  │
│  │  ┌───────────────────────────────────────┐ [■/↑]     │  │
│  │  │  textarea (multi-line, Shift+Enter)   │            │  │
│  │  └───────────────────────────────────────┘            │  │
│  │  ModelSelector (下拉) │ 45K/200K (usage)              │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Stores (Zustand): session / message / task / connection    │
│  Theme: VS Code CSS variables 映射                          │
└─────────────────────────────────────────────────────────────┘
```

---

## §2 项目结构

```
Clients/EchoVSCode/
├── package.json                  # VS Code extension manifest + deps
├── tsconfig.json                 # extension host (Node.js)
├── tsconfig.webview.json         # webview (React)
├── esbuild.mjs                   # extension host bundler
├── vite.config.ts                # webview bundler (React + CSS)
├── .vscodeignore                 # 打包排除规则
├── README.md
├── docs/
│   └── DESIGN.md                 # 本文件
├── media/
│   └── icon.png                  # 侧栏图标
│
├── src/                          # ── Extension Host (Node.js) ──
│   ├── extension.ts              # activate / deactivate
│   ├── gateway-client.ts         # WebSocket JSON-RPC 客户端
│   ├── connection-manager.ts     # gateway.lock 读取 + 重连
│   ├── chat-view-provider.ts     # WebviewViewProvider 实现
│   ├── protocol.ts               # 共享类型 (Turn/Step/Session/Model...)
│   ├── bridge.ts                 # Host↔Webview 消息类型
│   └── utils.ts                  # uniqueId, logger 等
│
└── webview/                      # ── Webview (React) ──
    ├── index.html                # Vite 入口 HTML
    ├── main.tsx                  # React 挂载 + vscode API 初始化
    ├── App.tsx                   # 顶层组件（读 connection 状态路由）
    ├── vscode.ts                 # acquireVsCodeApi 封装
    │
    ├── stores/                   # Zustand stores
    │   ├── index.ts              # 统一导出
    │   ├── session.ts            # Session[] + activeSessionKey
    │   ├── message.ts            # per-session Message[]
    │   ├── task.ts               # runningTasks / contextUsage / bgTasks
    │   ├── connection.ts         # status / error
    │   └── model.ts             # availableModels / selectedModel
    │
    ├── components/               # UI 组件（对标 EchoWork chat-panel）
    │   ├── ChatPanel.tsx         # 顶层编排
    │   ├── SessionTabBar.tsx     # Tab 栏 + [+] 新建
    │   ├── SessionTab.tsx        # 单个 tab（双击重命名、右键菜单）
    │   ├── ConnectionBanner.tsx  # 断开/重连提示条
    │   ├── MessageList.tsx       # 虚拟滚动消息列表
    │   ├── MessageItem.tsx       # 按 type 分发渲染
    │   ├── UserBubble.tsx        # 用户消息气泡
    │   ├── TextBubble.tsx        # AI 文本（streaming markdown 渲染）
    │   ├── ThinkingMessage.tsx   # 思考过程（可折叠）
    │   ├── ToolCallCard.tsx      # 工具调用卡片
    │   ├── SubagentCard.tsx      # 子代理卡片
    │   ├── QuestionCard.tsx      # AI 提问卡片（选项 + Other 输入）
    │   ├── PlanReviewCard.tsx    # Plan 审批卡片
    │   ├── ErrorCard.tsx         # 错误卡片（可重试）
    │   ├── EnqueuedPromptCard.tsx# Steering 排队消息
    │   ├── StatusIndicator.tsx   # "思考中…" 动画
    │   ├── InputBox.tsx          # 多行输入 + 发送/停止按钮
    │   ├── ModelSelector.tsx     # 模型下拉选择器
    │   ├── BackgroundTaskBar.tsx # 后台任务状态栏
    │   └── SlashCommandMenu.tsx  # 斜杠命令菜单
    │
    ├── hooks/
    │   └── useChatSubmit.ts      # send / enqueue / cancel 逻辑
    │
    ├── utils/
    │   ├── id.ts                 # uniqueId 生成
    │   ├── markdown.ts           # markdown → React 渲染
    │   └── dispatch-event.ts     # chat.event → callbacks 分发
    │
    └── styles/
        └── chat.css              # VS Code 主题适配 CSS
```

---

## §3 关键设计决策

### D1: Extension Host 持有 WebSocket 连接

**决策**: 所有网络通信在 Extension Host (Node.js) 层完成，webview 只做渲染。

**原因**:
1. VS Code webview 有严格 CSP 限制，直连 WS 需要额外配置且不稳定
2. Webview 生命周期不可控——panel 被隐藏时可能被 dispose，但 WS 连接需要持续
3. Extension Host 可以在后台接收事件，webview 恢复后补推状态
4. 可以利用 VS Code API（workspace、editor、commands）丰富上下文

**通信路径**:
```
EchoAI Gateway ←WS→ Extension Host ←postMessage→ Webview
```

### D2: Webview 技术栈 — React + Zustand + Vite

**决策**: 与 EchoWork 相同技术栈。

**原因**:
- 最大化代码复用（组件逻辑、store 结构、CSS 可直接搬）
- 团队一致的心智模型
- Vite HMR 支持 webview 开发时热更新

**依赖**:
- react 18 + react-dom
- zustand (状态管理)
- react-markdown + remark-gfm (markdown 渲染)
- highlight.js (代码高亮)

### D3: 主题集成 — VS Code CSS Variables

**决策**: 不使用独立色板，直接映射 VS Code 原生 CSS 变量。

```css
/* chat.css 顶部映射 */
:root {
  /* 背景色 */
  --color-bg: var(--vscode-editor-background);
  --color-chat-bg: var(--vscode-sideBar-background);
  --color-surface: var(--vscode-editorWidget-background);
  --color-surface-hover: var(--vscode-list-hoverBackground);

  /* 文字色 */
  --color-text: var(--vscode-editor-foreground);
  --color-text-secondary: var(--vscode-descriptionForeground);
  --color-text-muted: var(--vscode-disabledForeground);

  /* 边框/分割线 */
  --color-border: var(--vscode-panel-border);
  --color-border-subtle: var(--vscode-editorGroup-border);

  /* 强调色 */
  --color-accent: var(--vscode-focusBorder);
  --color-button-bg: var(--vscode-button-background);
  --color-button-fg: var(--vscode-button-foreground);
  --color-button-hover: var(--vscode-button-hoverBackground);

  /* 状态色 */
  --color-error: var(--vscode-errorForeground);
  --color-warning: var(--vscode-editorWarning-foreground);
  --color-success: var(--vscode-testing-iconPassed);

  /* 代码块 */
  --color-code-bg: var(--vscode-textCodeBlock-background);

  /* 输入框 */
  --color-input-bg: var(--vscode-input-background);
  --color-input-border: var(--vscode-input-border);
  --color-input-fg: var(--vscode-input-foreground);
}
```

效果：自动跟随用户 VS Code 主题（亮/暗/高对比度），零额外配置。

### D4: 连接管理策略

与 EchoWork `ConnectionController` 相同逻辑：

```
activate()
    │
    ▼
readGatewayLock()  ──失败──▶ 1s 后重试
    │ 成功
    ▼
connect(url) + auth(token) + plugin.connect
    │ 成功
    ▼
session.list + model.list → 推送给 webview
    │
    ▼
监听 chat.event → 转发给 webview

    WS 断开时
    │
    ▼
scheduleReconnect(1s) → 重读 lock → 重连
```

**gateway.lock 路径**: `~/.echoai/gateway.lock`（production），`~/.echoai.dev/gateway.lock`（dev 通过 `ECHOAI_DEV` 环境变量切换）

### D5: Session 生命周期

| 操作 | Webview 触发 | Host 处理 | Gateway RPC |
|------|-------------|-----------|-------------|
| 新建 | `new-session` | 用 workspace 路径创建临时 key | 首次 chat.completions 时 server 分配真实 key |
| 切换 | `switch-session` | subscribe 新 key + 加载 history | `chat.subscribe` |
| 关闭 | `close-session` | unsubscribe | `session.close` |
| 删除 | `delete-session` | unsubscribe + 清 store | `session.delete` |
| 重命名 | `rename-session` | — | `session.rename` |

**Session Key 约定**:
- 前端临时 key: `vsc_pending_<random>` (未提交到 server 前)
- 首次 `chat.completions` 返回 `session_key`，前端 `replaceSessionKey`

### D6: Workspace 集成

VS Code 的 workspace 信息直接映射到 EchoAI 的 workspace 概念：

```typescript
// extension.ts
const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''

// chat.completions 时传入
params.workspace = workspacePath

// selectedFile 从 active editor 读取
const activeEditor = vscode.window.activeTextEditor
params.selected_file = activeEditor?.document.uri.fsPath ?? ''
```

---

## §4 Host↔Webview 消息协议

### Host → Webview (HostMessage)

```typescript
type HostMessage =
  // 连接状态变更
  | { type: 'connection-status'; status: 'connected' | 'connecting' | 'disconnected'; error?: string }

  // 会话列表（全量推送）
  | { type: 'sessions'; sessions: SessionInfo[] }

  // 单个 session 历史加载完成
  | { type: 'history'; sessionKey: string; turns: Turn[]; hasMore: boolean; cursor: string | null }

  // 实时 chat.event 转发（与 EchoAI 协议一致）
  | { type: 'chat-event'; sessionKey: string; params: Record<string, unknown> }

  // 模型列表
  | { type: 'models'; models: ModelInfo[]; defaultModel: string }

  // session key 替换（首次提交后 server 分配真实 key）
  | { type: 'session-replaced'; oldKey: string; newKey: string; title: string }

  // chat.completions 开始确认（带 turn_id）
  | { type: 'turn-started'; sessionKey: string; turnId: string }

  // workspace 信息
  | { type: 'workspace'; path: string }

  // 错误
  | { type: 'error'; message: string }
```

### Webview → Host (WebviewMessage)

```typescript
type WebviewMessage =
  // 发送消息（新 turn）
  | { type: 'send'; sessionKey: string; text: string; attachments?: string[]; model?: string; modes?: string[]; slashCommand?: string; slashBlocks?: SlashBlock[] }

  // 追加消息（mid-stream steering）
  | { type: 'enqueue'; sessionKey: string; text: string; steerId: string; attachments?: string[] }

  // 取消当前 turn
  | { type: 'cancel'; sessionKey: string }

  // 新建 session
  | { type: 'new-session' }

  // 切换 active session（触发 subscribe + 加载 history）
  | { type: 'switch-session'; sessionKey: string }

  // 关闭 session tab
  | { type: 'close-session'; sessionKey: string }

  // 删除 session
  | { type: 'delete-session'; sessionKey: string }

  // 重命名 session
  | { type: 'rename-session'; sessionKey: string; title: string }

  // 切换模型
  | { type: 'set-model'; sessionKey: string; model: string }

  // 回答 AI 提问
  | { type: 'answer-question'; sessionKey: string; questionId: string; answers: Record<string, string | string[]> }

  // 加载更早历史
  | { type: 'load-older'; sessionKey: string; cursor: string }

  // 取消后台任务
  | { type: 'cancel-bg-task'; sessionKey: string; taskId: string }

  // Webview 就绪（请求初始状态推送）
  | { type: 'ready' }
```

---

## §5 协议层复用 — GatewayClient

Extension Host 的 `gateway-client.ts` 是 EchoWork `echobot-client.ts` 的 Node.js 移植版，核心差异：

| 方面 | EchoWork (Tauri/Browser) | echo-vscode (Node.js) |
|------|-------------------------|----------------------|
| WebSocket 库 | 浏览器原生 `WebSocket` | `ws` npm 包 |
| gateway.lock 读取 | Tauri `readTextFile` | Node.js `fs.readFile` |
| 消息转发 | Zustand store 直写 | `webview.postMessage()` |
| 生命周期 | App 存活期间 | Extension 激活期间 |
| plugin_name | `echowork.client` | `echoai.vscode` |

**保持一致的部分**:
- JSON-RPC 2.0 请求/响应协议（method + params + id）
- `chat.event` notification 的 `(type, event)` 双字段派发格式
- `chat.completions` 参数签名
- 所有 RPC method 名称

```typescript
// gateway-client.ts 核心接口
class GatewayClient {
  // 连接控制
  connect(url: string): Promise<void>
  disconnect(): void
  get connected(): boolean

  // 认证
  setCredentials(token: string, pluginName: string): void
  authenticate(): Promise<void>

  // Session
  listSessions(): Promise<SessionInfo[]>
  getHistory(sessionKey: string, cursor?: string): Promise<HistoryResult>
  createSession(workspace: string): Promise<{ session_key: string }>
  closeSession(sessionKey: string): Promise<void>
  deleteSession(sessionKey: string): Promise<void>
  subscribeSessions(keys: string[]): Promise<void>
  unsubscribeSessions(keys: string[]): Promise<void>

  // Chat
  chatCompletions(sessionKey: string, content: string, opts: ChatOpts): Promise<{ session_key: string; turn_id: string }>
  enqueueMessage(sessionKey: string, content: string, steerId: string, attachments?: string[]): Promise<void>
  cancelTurn(sessionKey: string): Promise<void>

  // Model
  listModels(): Promise<{ models: ModelInfo[]; default_model: string }>
  setModel(sessionKey: string, model: string): Promise<void>

  // Question
  answerQuestion(sessionKey: string, questionId: string, answers: Record<string, string | string[]>): Promise<void>

  // Background
  cancelBackgroundTask(sessionKey: string, taskId: string): Promise<void>

  // Events
  onChatEvent: (sessionKey: string, params: Record<string, unknown>) => void
  onDisconnect: () => void
}
```

---

## §6 Webview 组件清单（对标 EchoWork）

### 完全移植（逻辑+UI 对齐）

| EchoWork 组件 | EchoVSCode 对应 | 说明 |
|--------------|----------------|------|
| `ChatPanel.tsx` | `ChatPanel.tsx` | SessionTabBar + Banner + MessageList + InputBox |
| `SessionTabBar.tsx` | `SessionTabBar.tsx` | 多 tab + [+] 新建 + 拖拽排序 |
| `SessionTab.tsx` | `SessionTab.tsx` | 双击重命名 + X 关闭 + 运行态指示 |
| `MessageList.tsx` | `MessageList.tsx` | 自动滚底 + 向上加载更多 |
| `MessageItem.tsx` | `MessageItem.tsx` | 按 message.type 分发 |
| `TextMessageBubble.tsx` | `TextBubble.tsx` | Streaming markdown 渲染 |
| `UserMessageBubble.tsx` | `UserBubble.tsx` | 用户消息 + 附件缩略图 |
| `ThinkingMessage.tsx` | `ThinkingMessage.tsx` | 可折叠思考过程 |
| `ToolCallCard.tsx` | `ToolCallCard.tsx` | 工具名 + 参数 + 输出（折叠） |
| `SubagentCard.tsx` | `SubagentCard.tsx` | 子代理任务卡（running/done/bg） |
| `QuestionCard.tsx` | `QuestionCard.tsx` | 选项列表 + Other 输入 + 提交 |
| `PlanReviewCard.tsx` | `PlanReviewCard.tsx` | Plan markdown 展示 + Approve/Reject |
| `ErrorCard.tsx` | `ErrorCard.tsx` | 错误信息 + 可选重试 |
| `EnqueuedPromptCard.tsx` | `EnqueuedPromptCard.tsx` | Steering 排队 + ✓ 确认 |
| `StatusIndicator.tsx` | `StatusIndicator.tsx` | "思考中…" 动画 |
| `InputBox.tsx` | `InputBox.tsx` | 多行 textarea + 发送/停止 |
| `ModelSelector.tsx` | `ModelSelector.tsx` | 模型下拉选择 |
| `ConnectionBanner.tsx` | `ConnectionBanner.tsx` | 断连/重连横幅 |
| `BackgroundTaskBar.tsx` | `BackgroundTaskBar.tsx` | 后台任务列表 + 取消 |
| `SlashCommandMenu.tsx` | `SlashCommandMenu.tsx` | / 触发命令菜单 |

### 首版不移植（后续迭代）

| 组件 | 原因 |
|------|------|
| `ToolApprovalCard` | Auto 模式 VS Code 场景少用 |
| `TodoProgressPanel` | 依赖 VS Code 原生 progress API 更合适 |
| `TurnFileSummary` | 需要 git 集成，二期做 |
| `SkillMentionMenu` | 依赖 skill store 完整实现，二期 |
| `WelcomePage` | VS Code 用空态文案替代 |

---

## §7 Store 结构

### session.ts

```typescript
interface Session {
  sessionKey: string
  title: string
  workspacePath: string
  createdAt: string
  updatedAt: string
}

interface SessionState {
  sessions: Session[]
  activeSessionKey: string | null
}

interface SessionActions {
  setSessions(sessions: Session[]): void
  addSession(session: Session): void
  setActiveSession(key: string | null): void
  closeSession(key: string): void
  removeSession(key: string): void
  renameSession(key: string, title: string): void
  replaceSessionKey(oldKey: string, newKey: string, title?: string): void
}
```

### message.ts

```typescript
// Message union type — 与 EchoWork 完全一致
type Message =
  | { type: 'user_prompt'; id: string; content: string; timestamp: string; attachments?: string[]; slashCommand?: string }
  | { type: 'text'; id: string; content: string; timestamp: string }
  | { type: 'thinking'; id: string; content: string; timestamp: string; collapsed: boolean }
  | { type: 'tool'; id: string; tool: string; toolCallId: string; input: unknown; output: unknown; status: 'pending' | 'done' | 'error'; timestamp: string }
  | { type: 'question'; id: string; questionId: string; questions: unknown[]; answers: unknown; status: 'pending' | 'answered' | 'timed_out'; timestamp: string }
  | { type: 'subagent'; id: string; subagentId: string; label: string; taskType?: string; innerTools: unknown[]; textSegments: string[]; result?: string; status: 'running' | 'done' | 'error'; timestamp: string }
  | { type: 'enqueued_prompt'; id: string; content: string; timestamp: string; confirmed?: boolean }
  | { type: 'error'; id: string; content: string; timestamp: string; kind?: 'error' | 'cancelled'; retryable?: boolean }

interface MessageState {
  messages: Record<string, Message[]>  // sessionKey → messages
}

interface MessageActions {
  setMessages(key: string, msgs: Message[]): void
  appendMessage(key: string, msg: Message): void
  updateMessage(key: string, id: string, updater: Partial<Message>): void
  clearMessages(key: string): void
}
```

### task.ts

```typescript
interface RunningTask {
  turnId: string
  sessionKey: string
  status: 'streaming' | 'cancelling'
}

interface BackgroundTask {
  taskId: string
  tool: string
  description: string
  status: 'running' | 'done' | 'failed' | 'cancelled' | 'cancelling'
}

interface TaskState {
  runningTasks: Record<string, RunningTask | null>  // sessionKey → task
  contextUsage: Record<string, { tokens: number; window: number }>
  sessionExpense: Record<string, { expense: number; currency: string }>
  backgroundTasks: Record<string, BackgroundTask[]>  // sessionKey → tasks
}
```

### connection.ts

```typescript
interface ConnectionState {
  status: 'connected' | 'connecting' | 'disconnected'
  error: string | null
  gatewayUrl: string | null
}
```

### model.ts

```typescript
interface ModelInfo {
  id: string
  provider?: string
}

interface ModelState {
  availableModels: ModelInfo[]
  defaultModel: string
  selectedModel: Record<string, string>  // sessionKey → model
}
```

---

## §8 chat.event 分发逻辑

Webview 收到 `{ type: 'chat-event', sessionKey, params }` 后，复用与 EchoWork 完全相同的分发函数：

```typescript
// dispatch-event.ts (从 EchoWork dispatchChatEvent 提取)
function dispatchChatEvent(callbacks: ChatEventCallbacks, params: Record<string, unknown>): void {
  const type = params.type as string
  const event = params.event as string

  if (type === 'turn' && event === 'end') { /* onEnd */ }
  if (type === 'token' || type === 'text') { /* onText */ }
  if (type === 'thinking') { /* onThinking */ }
  if (type === 'tool' && event === 'create') { /* onToolCall */ }
  if (type === 'tool' && event === 'update') { /* onUpdate */ }
  if (type === 'question' && event === 'create') { /* onQuestion */ }
  if (type === 'user_prompt' && event === 'create') { /* onUserPrompt */ }
  if (type === 'steering' && event === 'create') { /* onSteering */ }
  if (type === 'error' && event === 'raise') { /* onError */ }
  if (type === 'usage' && event === 'report') { /* onUsageReport */ }
  if (type === 'background_task' && event === 'started') { /* onBackgroundTaskStarted */ }
  if (type === 'background_task' && event === 'completed') { /* onBackgroundTaskCompleted */ }
  if (type === 'waiting' && event === 'create') { /* onWaiting */ }
}
```

回调将事件写入对应 store（与 EchoWork `chat-bridge.ts` 中 `createChatCallbacks` 逻辑一致）。

---

## §9 package.json 关键配置

```jsonc
{
  "name": "echo-vscode",
  "displayName": "EchoAI",
  "description": "EchoAI Coding Assistant for VS Code",
  "version": "0.1.0",
  "publisher": "echoworker",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["AI", "Chat"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "echoai",
        "title": "EchoAI",
        "icon": "media/icon.png"
      }]
    },
    "views": {
      "echoai": [{
        "type": "webview",
        "id": "echoai.chatView",
        "name": "Chat"
      }]
    },
    "commands": [
      { "command": "echoai.newSession", "title": "EchoAI: New Chat Session" },
      { "command": "echoai.sendSelection", "title": "EchoAI: Send Selection to Chat" }
    ],
    "menus": {
      "editor/context": [
        { "command": "echoai.sendSelection", "when": "editorHasSelection" }
      ]
    },
    "keybindings": [
      { "command": "echoai.newSession", "key": "ctrl+shift+n", "mac": "cmd+shift+n" }
    ]
  }
}
```

---

## §10 开发与构建

### 开发模式

```bash
# Terminal 1: watch extension host
npm run watch:ext

# Terminal 2: watch webview (Vite dev server)
npm run watch:webview

# 在 VS Code 中按 F5 启动 Extension Development Host
```

### 构建打包

```bash
npm run build        # 构建 extension + webview
npx @vscode/vsce package --no-dependencies   # 输出 .vsix
```

### 构建工具链

- **Extension Host**: esbuild (fast, Node.js target, external: vscode)
- **Webview**: Vite + React plugin (output to `dist/webview/`)
- ChatViewProvider 在运行时把 `dist/webview/` 作为 webviewUri 加载

---

## §11 里程碑

| 阶段 | 交付物 | 验收标准 | 估时 |
|------|--------|---------|------|
| **M1 骨架** | package.json + extension.ts + 空 webview | F5 能弹出侧栏 webview 显示 "Hello" | 2h |
| **M2 连接** | GatewayClient + ConnectionManager | 自动读 lock 连 gateway，webview 显示 ✓ Connected | 2h |
| **M3 Chat 核心** | send → streaming text/thinking/tool 完整渲染 | 能发消息、看到流式回复、工具调用 | 4h |
| **M4 多 Session** | tab 切换 + 新建/关闭/删除/重命名 + history | 多个 session 独立运行互不干扰 | 2h |
| **M5 交互** | model selector + question card + plan review + error + cancel + enqueue | 能切模型、回答 AI 提问、审批 plan、取消 | 2h |
| **M6 打包** | .vsix + README + CI | `code --install-extension` 成功 | 1h |

**总计约 13h 有效开发时间。**

---

## §12 后续迭代方向

- [ ] 右键"Send Selection to EchoAI"上下文菜单
- [ ] 编辑器内联 diff 展示（AI 改动预览）
- [ ] Terminal 集成（bash tool 输出）
- [ ] Git 改动感知（TurnFileSummary）
- [ ] Skill 支持（@skill 触发）
- [ ] 附件支持（图片粘贴/拖拽）
- [ ] 设置页（配置 gateway 地址、主题偏好）
- [ ] Marketplace 发布
