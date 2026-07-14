/**
 * useChatSubmit.ts — Send / enqueue / cancel hook.
 *
 * In VS Code, workspace = the currently open folder. No workspace picker needed.
 * If no session exists, the first send auto-creates one (temporary key →
 * server assigns real key via session-replaced message).
 */

import { useCallback } from 'react'
import { useSessionStore, useMessageStore, useTaskStore, useModelStore } from '../stores'
import { postToHost } from '../vscode'
import { uniqueId } from '../utils/id'

function ensureActiveSession(): string {
  const state = useSessionStore.getState()
  if (state.activeSessionKey) return state.activeSessionKey

  // Auto-create a pending session
  const tempKey = `vsc_pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  useSessionStore.getState().createAndOpenSession({
    sessionKey: tempKey,
    title: 'New Chat',
    workspacePath: '',  // host fills in the real workspace path
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  return tempKey
}

export function useChatSubmit() {
  const send = useCallback((
    text: string,
    attachments: string[] = [],
    opts?: { modes?: string[]; slashCommand?: string },
  ): boolean => {
    const sessionKey = ensureActiveSession()
    const runningTask = useTaskStore.getState().runningTasks[sessionKey] ?? null

    if (runningTask) {
      // Mid-stream enqueue (steering)
      const steerId = uniqueId('eq')
      useMessageStore.getState().appendMessage(sessionKey, {
        id: steerId,
        type: 'enqueued_prompt',
        content: text,
        timestamp: new Date().toISOString(),
        ...(attachments.length > 0 ? { attachments } : {}),
      })
      postToHost({
        type: 'enqueue',
        sessionKey,
        text,
        steerId,
        attachments: attachments.length > 0 ? attachments : undefined,
      })
    } else {
      // Normal submit
      const userMsgId = uniqueId('up')
      useMessageStore.getState().appendMessage(sessionKey, {
        id: userMsgId,
        type: 'user_prompt',
        content: text || (attachments.length > 0 ? '🖼️' : ''),
        timestamp: new Date().toISOString(),
        ...(opts?.slashCommand ? { slashCommand: opts.slashCommand } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      })

      // Mark streaming
      useTaskStore.getState().setRunningTask(sessionKey, {
        turnId: '',
        sessionKey,
        status: 'streaming',
      })

      const modelState = useModelStore.getState()
      const selectedModel = modelState.selectedModel[sessionKey] || modelState.defaultModel

      postToHost({
        type: 'send',
        sessionKey,
        text,
        attachments: attachments.length > 0 ? attachments : undefined,
        model: selectedModel || undefined,
        modes: opts?.modes,
        slashCommand: opts?.slashCommand,
        userMsgId,
      })

      // First message: rename tab
      if (text) {
        const msgs = useMessageStore.getState().messages[sessionKey] ?? []
        if (msgs.filter((m) => m.type === 'user_prompt').length <= 1) {
          useSessionStore.getState().renameSession(sessionKey, text.slice(0, 30))
        }
      }
    }
    return true
  }, [])

  const cancel = useCallback(() => {
    const { activeSessionKey } = useSessionStore.getState()
    if (!activeSessionKey) return

    const task = useTaskStore.getState().runningTasks[activeSessionKey]
    if (!task) return

    useTaskStore.getState().setRunningTask(activeSessionKey, {
      ...task,
      status: 'cancelling',
    })
    postToHost({ type: 'cancel', sessionKey: activeSessionKey })

    // Clean up un-confirmed enqueued prompts — backend won't consume them after cancel.
    const msgState = useMessageStore.getState()
    const msgs = msgState.messages[activeSessionKey] ?? []
    const remaining = msgs.filter(
      (m) => !(m.type === 'enqueued_prompt' && !m.confirmed),
    )
    if (remaining.length !== msgs.length) {
      msgState.setMessages(activeSessionKey, remaining)
    }

    // 5s timeout fallback
    setTimeout(() => {
      const current = useTaskStore.getState().runningTasks[activeSessionKey]
      if (current?.status === 'cancelling') {
        useTaskStore.getState().setRunningTask(activeSessionKey, null)
      }
    }, 5000)
  }, [])

  return { send, cancel }
}
