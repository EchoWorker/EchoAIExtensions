/**
 * dispatch-event.ts — Dispatch a chat.event into store actions.
 *
 * Uses a dispatch table pattern for extensibility and testability.
 * Each handler is a pure function that reads/writes stores.
 */

import { useMessageStore } from '../stores/message'
import { useTaskStore } from '../stores/task'
import { uniqueId } from './id'
import type { Step, Question } from '../../shared/protocol'

// ── Handler type ────────────────────────────────────────────────────────────

type EventHandler = (sessionKey: string, params: Record<string, unknown>) => void

// ── Dispatch table ──────────────────────────────────────────────────────────

const handlers: Record<string, Record<string, EventHandler>> = {
  turn: { end: handleTurnEnd },
  token: { append: handleTextAppend },
  text: { append: handleTextAppend },
  thinking: { append: handleThinkingAppend },
  tool: { create: handleToolCreate, update: handleToolUpdate },
  question: { create: handleQuestionCreate, update: handleQuestionUpdate },
  user_prompt: { create: handleUserPromptCreate },
  steering: { create: handleSteeringCreate },
  error: { raise: handleErrorRaise },
  usage: { report: handleUsageReport },
  background_task: { started: handleBgTaskStarted, completed: handleBgTaskCompleted },
  waiting: { create: handleWaitingCreate },
}

// ── Public entry point ──────────────────────────────────────────────────────

export function dispatchChatEvent(
  sessionKey: string,
  params: Record<string, unknown>,
): void {
  const type = params.type as string | undefined
  const event = params.event as string | undefined
  if (!type || !event) return

  const handler = handlers[type]?.[event]
  handler?.(sessionKey, params)
}

// ── Individual handlers ─────────────────────────────────────────────────────

function handleTurnEnd(sessionKey: string, params: Record<string, unknown>): void {
  const status = (params.status as string) ?? 'done'
  useTaskStore.getState().setRunningTask(sessionKey, null)
  if (status === 'cancelled') {
    useMessageStore.getState().appendMessage(sessionKey, {
      type: 'error',
      id: uniqueId('cancelled'),
      content: '',
      timestamp: new Date().toISOString(),
      kind: 'cancelled',
    })
  }
}

function handleTextAppend(sessionKey: string, params: Record<string, unknown>): void {
  const msgId = params.message_id as string
  const content = params.content as string
  const subagentTaskId = params.subagent_task_id as string | undefined
  const msgStore = useMessageStore.getState()

  if (subagentTaskId) {
    msgStore.appendSubagentText(sessionKey, subagentTaskId, content)
  } else {
    const existing = msgStore.findMessage(sessionKey, msgId)
    if (existing && existing.type === 'text') {
      msgStore.updateMessage(sessionKey, msgId, { content: existing.content + content })
    } else {
      msgStore.appendMessage(sessionKey, {
        type: 'text',
        id: msgId,
        content,
        timestamp: new Date().toISOString(),
      })
    }
  }
}

function handleThinkingAppend(sessionKey: string, params: Record<string, unknown>): void {
  const msgId = params.message_id as string
  const content = params.content as string
  const msgStore = useMessageStore.getState()

  const existing = msgStore.findMessage(sessionKey, msgId)
  if (existing && existing.type === 'thinking') {
    msgStore.updateMessage(sessionKey, msgId, { content: existing.content + content })
  } else {
    msgStore.appendMessage(sessionKey, {
      type: 'thinking',
      id: msgId,
      content,
      timestamp: new Date().toISOString(),
      collapsed: false,
    })
  }
}

function handleToolCreate(sessionKey: string, params: Record<string, unknown>): void {
  const msgId = params.message_id as string
  const tool = params.tool as string
  const toolCallId = params.tool_call_id as string
  const input = (params.input ?? {}) as Record<string, unknown>
  const subagentTaskId = params.subagent_task_id as string | undefined
  const subagentTaskName = params.subagent_task_name as string | undefined
  const subagentTaskType = params.subagent_task_type as string | undefined
  const msgStore = useMessageStore.getState()

  if (subagentTaskId) {
    const existing = msgStore.findMessage(sessionKey, subagentTaskId)
    if (!existing) {
      msgStore.appendMessage(sessionKey, {
        type: 'subagent',
        id: subagentTaskId,
        subagentId: subagentTaskId,
        label: subagentTaskName ?? tool,
        taskType: subagentTaskType,
        innerTools: [],
        textSegments: [],
        status: 'running',
        timestamp: new Date().toISOString(),
      })
    }
    msgStore.appendSubagentTool(sessionKey, subagentTaskId, {
      tool,
      toolCallId,
      input,
      output: null,
      status: 'pending',
    })
  } else {
    msgStore.appendMessage(sessionKey, {
      type: 'tool',
      id: msgId,
      tool,
      toolCallId,
      input,
      output: null,
      status: 'pending',
      timestamp: new Date().toISOString(),
    })
  }
}

function handleToolUpdate(sessionKey: string, params: Record<string, unknown>): void {
  const step = params.step as Step | undefined
  if (!step) return
  const msgId = params.message_id as string
  const subagentTaskId = params.subagent_task_id as string | undefined
  const msgStore = useMessageStore.getState()

  if (subagentTaskId && step.tool_call_id) {
    msgStore.updateSubagentTool(sessionKey, subagentTaskId, step.tool_call_id, {
      output: step.output ?? null,
      status: (step.status as 'done' | 'error') ?? 'done',
    })
  } else {
    msgStore.updateMessage(sessionKey, msgId, {
      output: step.output ?? null,
      status: (step.status as 'done' | 'error') ?? 'done',
    })
  }
}

function handleQuestionCreate(sessionKey: string, params: Record<string, unknown>): void {
  const msgId = params.message_id as string
  const questionId = params.question_id as string
  const questions = params.questions as Question[]
  useMessageStore.getState().appendMessage(sessionKey, {
    type: 'question',
    id: msgId,
    questionId,
    questions,
    answers: null,
    status: 'pending',
    timestamp: new Date().toISOString(),
  })
}

function handleQuestionUpdate(sessionKey: string, params: Record<string, unknown>): void {
  const step = params.step as Step | undefined
  if (!step) return
  const msgId = params.message_id as string
  useMessageStore.getState().updateMessage(sessionKey, msgId, {
    answers: step.answers ?? null,
    status: (step.status as 'answered' | 'timed_out') ?? 'answered',
  })
}

function handleUserPromptCreate(sessionKey: string, params: Record<string, unknown>): void {
  const content = params.content as string
  const userMsgId = params.user_msg_id as string | undefined
  const slashCommand = params.slash_command as string | undefined
  const msgStore = useMessageStore.getState()

  // Dedupe: if we already rendered this message (self-initiated), skip
  if (userMsgId) {
    const existing = msgStore.findMessage(sessionKey, userMsgId)
    if (existing) return
  }

  msgStore.appendMessage(sessionKey, {
    type: 'user_prompt',
    id: userMsgId ?? uniqueId('up'),
    content,
    timestamp: new Date().toISOString(),
    slashCommand,
  })
}

function handleSteeringCreate(sessionKey: string, params: Record<string, unknown>): void {
  const content = params.content as string
  const steerId = params.steer_id as string | undefined
  const msgStore = useMessageStore.getState()

  // Match and confirm the enqueued prompt
  if (steerId) {
    const existing = msgStore.findMessage(sessionKey, steerId)
    if (existing && existing.type === 'enqueued_prompt') {
      msgStore.updateMessage(sessionKey, steerId, { confirmed: true })
      return
    }
  }

  msgStore.appendMessage(sessionKey, {
    type: 'enqueued_prompt',
    id: steerId ?? uniqueId('steer'),
    content,
    timestamp: new Date().toISOString(),
    confirmed: true,
  })
}

function handleErrorRaise(sessionKey: string, params: Record<string, unknown>): void {
  const message = params.message as string
  const errorType = params.error_type as string | undefined
  const retryable = params.retryable as boolean | undefined
  useMessageStore.getState().appendMessage(sessionKey, {
    type: 'error',
    id: uniqueId('err'),
    content: message,
    timestamp: new Date().toISOString(),
    kind: 'error',
    errorType,
    retryable,
  })
}

function handleUsageReport(sessionKey: string, params: Record<string, unknown>): void {
  const fromSubagent = params.from_subagent as boolean | undefined
  if (fromSubagent) return

  const taskStore = useTaskStore.getState()
  taskStore.setContextUsage(sessionKey, {
    tokens: params.session_context_tokens as number,
    window: params.context_window as number,
  })
  taskStore.setSessionExpense(sessionKey, {
    expense: params.session_expense as number,
    currency: (params.currency as string) ?? 'USD',
  })
}

function handleBgTaskStarted(sessionKey: string, params: Record<string, unknown>): void {
  useTaskStore.getState().addBackgroundTask(sessionKey, {
    taskId: params.task_id as string,
    tool: params.tool as string,
    description: params.description as string,
    status: 'running',
  })
}

function handleBgTaskCompleted(sessionKey: string, params: Record<string, unknown>): void {
  const taskId = params.task_id as string
  const status = params.status as string
  const taskStore = useTaskStore.getState()

  taskStore.updateBackgroundTask(sessionKey, taskId, {
    status: status === 'done' ? 'done' : status === 'cancelled' ? 'cancelled' : 'failed',
  })

  // Update subagent card if the bg task was a subagent
  const result = params.result as string | undefined
  if (result) {
    const msgStore = useMessageStore.getState()
    const msgs = msgStore.messages[sessionKey] ?? []
    const subMsg = msgs.find((m) => m.type === 'subagent' && m.id === taskId)
    if (subMsg) {
      msgStore.updateMessage(sessionKey, taskId, {
        result,
        status: status === 'done' ? 'done' : 'error',
      })
    }
  }
}

function handleWaitingCreate(_sessionKey: string, _params: Record<string, unknown>): void {
  // No-op in VS Code extension UI (could show a waiting indicator in future)
}
