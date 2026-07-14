/**
 * protocol.ts — Shared type definitions for EchoAI gateway communication.
 * Extracted from EchoWork's types/protocol.ts for the VS Code extension.
 */

// ── Slash blocks ────────────────────────────────────────────────────────────

export interface SlashBlock {
  tag: string
  content: string
}

// ── Question types ──────────────────────────────────────────────────────────

export interface QuestionOption {
  label: string
  description?: string
}

export interface Question {
  question: string
  header?: string
  multiSelect?: boolean
  options?: QuestionOption[]
  plan_text?: string
  tool_approval?: {
    tool_name: string
    arguments: Record<string, unknown>
  }
}

// ── Step — a single step within a Turn ──────────────────────────────────────

export interface Step {
  type: 'text' | 'thinking' | 'tool' | 'question' | 'user_prompt' | 'steering'
  message_id: string
  text?: string
  thinking?: string
  content?: string
  tool?: string
  tool_call_id?: string
  input?: Record<string, unknown>
  output?: string | null
  question_id?: string
  questions?: Question[]
  answers?: Record<string, string | string[]> | null
  status?: string
  timestamp?: string
  task_id?: string
  task_name?: string
  background_task_id?: string
}

// ── Turn — a single conversation turn ──────────────────────────────────────

export interface Turn {
  turn_id: string
  session_key: string
  user_input: string
  created_at: string
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled' | 'superseded'
  model: string
  steps: Step[]
  attachments: string[]
  selected_file?: string
  selected_text?: string
  slash_command?: string
}

// ── History result ──────────────────────────────────────────────────────────

export interface HistoryResult {
  turns: Turn[]
  next_cursor: string | null
  has_more: boolean
}

// ── Session info ────────────────────────────────────────────────────────────

export interface SessionInfo {
  session_key: string
  name: string
  workspace: string
  created_at: string
  updated_at: string
  agent_backend?: string
  is_running?: boolean
  current_model?: string
}

// ── Model info ──────────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string
  provider?: string
}

// ── Error meta ──────────────────────────────────────────────────────────────

export interface ChatErrorMeta {
  errorType?: string
  retryable?: boolean
  kind?: 'error' | 'cancelled'
}

// ── Usage report ────────────────────────────────────────────────────────────

export interface UsageReportEvent {
  session_context_tokens: number
  context_window: number
  expense: number
  currency: string
  session_expense: number
  session_cache_hit_rate: number
  from_subagent?: boolean
}

// ── Background task ─────────────────────────────────────────────────────────

export type BackgroundTaskStatus = 'done' | 'failed' | 'cancelled'

// ── Chat event callbacks ────────────────────────────────────────────────────

export interface ChatEventCallbacks {
  onText?: (msgId: string, content: string, subagentTaskId?: string) => void
  onThinking?: (msgId: string, content: string) => void
  onToolCall?: (msgId: string, tool: string, toolCallId: string, input: Record<string, unknown>, taskId?: string, taskName?: string, taskType?: string) => void
  onUpdate?: (msgId: string, step: Step) => void
  onQuestion?: (msgId: string, questionId: string, questions: Question[]) => void
  onUserPrompt?: (content: string, userMsgId?: string, slashCommand?: string) => void
  onSteering?: (content: string, steerId?: string) => void
  onEnd?: (turnId: string, status: string) => void
  onError?: (error: string, meta?: ChatErrorMeta) => void
  onUsageReport?: (report: UsageReportEvent) => void
  onBackgroundTaskStarted?: (taskId: string, tool: string, description: string, command?: string) => void
  onBackgroundTaskCompleted?: (taskId: string, tool: string, elapsedSecs: number, status: BackgroundTaskStatus, exitCode?: number, result?: string) => void
  onWaiting?: () => void
}

// ── Chat completions options ────────────────────────────────────────────────

export interface ChatCompletionsOpts {
  media?: string[]
  selectedFile?: string
  workspace?: string
  model?: string
  modes?: string[]
  pluginName?: string
  userMsgId?: string
  slashCommand?: string
  slashBlocks?: SlashBlock[]
}
