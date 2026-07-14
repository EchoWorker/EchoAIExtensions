import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useSessionStore, useConnectionStore, useModelStore, useMessageStore, useTaskStore } from './stores'
import { dispatchChatEvent } from './utils/dispatch-event'
import { postToHost } from './vscode'
import { uniqueId } from './utils/id'
import type { HostMessage } from '../shared/bridge'
import type { Turn, Step } from '../shared/protocol'
import './styles/chat.css'

// ── Host message handler ────────────────────────────────────────────────────

function handleHostMessage(msg: HostMessage): void {
  switch (msg.type) {
    case 'connection-status':
      useConnectionStore.getState().setStatus(msg.status)
      if (msg.error) useConnectionStore.getState().setError(msg.error)
      else if (msg.status === 'connected') useConnectionStore.getState().setError(null)
      break

    case 'sessions': {
      const sessions = msg.sessions.map((s) => ({
        sessionKey: s.session_key,
        title: s.name || 'Chat',
        workspacePath: s.workspace || '',
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      }))
      // Sort by updated_at desc — most recent first
      sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

      const store = useSessionStore.getState()
      store.setSessions(sessions)

      // Restore tabs persisted in workspaceState, intersected with what gateway
      // still has. Sessions that were deleted on the server side drop out.
      const availableKeys = new Set(sessions.map((s) => s.sessionKey))
      const restoredOpenKeys = msg.restoreTabKeys.filter((k) => availableKeys.has(k))
      let activeKey = msg.restoreActiveKey
      if (!activeKey || !restoredOpenKeys.includes(activeKey)) {
        activeKey = restoredOpenKeys[0] ?? null
      }

      // Apply to store: openTabKeys in the persisted order; activate the chosen one.
      useSessionStore.setState({
        openTabKeys: restoredOpenKeys,
        activeSessionKey: activeKey,
      })

      // Subscribe each restored tab so chat-events route correctly. Active tab
      // also loads history; non-active tabs are subscribe-only (lazy history).
      for (const key of restoredOpenKeys) {
        if (key === activeKey) {
          postToHost({ type: 'switch-session', sessionKey: key })
        } else {
          postToHost({ type: 'subscribe-session', sessionKey: key })
        }
      }
      break
    }

    case 'history': {
      const messages = convertTurnsToMessages(msg.turns)
      const existing = useMessageStore.getState().messages[msg.sessionKey] ?? []
      if (existing.length === 0) {
        useMessageStore.getState().setMessages(msg.sessionKey, messages)
      } else {
        // Prepend older history
        useMessageStore.getState().setMessages(msg.sessionKey, [...messages, ...existing])
      }
      break
    }

    case 'chat-event':
      dispatchChatEvent(msg.sessionKey, msg.params)
      break

    case 'models':
      useModelStore.getState().setAvailableModels(msg.models, msg.defaultModel)
      break

    case 'session-replaced': {
      useSessionStore.getState().replaceSessionKey(msg.oldKey, msg.newKey, msg.title)
      // Migrate message store
      const oldMsgs = useMessageStore.getState().messages[msg.oldKey] ?? []
      if (oldMsgs.length > 0) {
        useMessageStore.getState().setMessages(msg.newKey, oldMsgs)
        useMessageStore.getState().clearMessages(msg.oldKey)
      }
      // Migrate task store
      const oldTask = useTaskStore.getState().runningTasks[msg.oldKey]
      if (oldTask) {
        useTaskStore.getState().setRunningTask(msg.newKey, { ...oldTask, sessionKey: msg.newKey })
        useTaskStore.getState().setRunningTask(msg.oldKey, null)
      }
      break
    }

    case 'turn-started': {
      useTaskStore.getState().setRunningTask(msg.sessionKey, {
        turnId: msg.turnId,
        sessionKey: msg.sessionKey,
        status: 'streaming',
      })
      break
    }

    case 'session-created': {
      useSessionStore.getState().createAndOpenSession({
        sessionKey: msg.sessionKey,
        title: msg.title,
        workspacePath: msg.workspacePath,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      break
    }

    case 'workspace':
      // Store workspace path if needed in the future
      break

    case 'error':
      console.error('[EchoAI]', msg.message)
      break
  }
}

// ── Convert history turns to messages ────────────────────────────────────────

function convertTurnsToMessages(turns: Turn[]): import('./stores/message').Message[] {
  const messages: import('./stores/message').Message[] = []
  for (const turn of turns) {
    // User input
    if (turn.user_input) {
      messages.push({
        type: 'user_prompt',
        id: `hist_user_${turn.turn_id}`,
        content: turn.user_input,
        timestamp: turn.created_at,
        slashCommand: turn.slash_command,
      })
    }

    // Steps
    for (const step of turn.steps) {
      switch (step.type) {
        case 'text':
          if (step.text || step.content) {
            messages.push({
              type: 'text',
              id: step.message_id,
              content: step.text || step.content || '',
              timestamp: step.timestamp || turn.created_at,
            })
          }
          break

        case 'thinking':
          if (step.thinking || step.content) {
            messages.push({
              type: 'thinking',
              id: step.message_id,
              content: step.thinking || step.content || '',
              timestamp: step.timestamp || turn.created_at,
              collapsed: true,
            })
          }
          break

        case 'tool':
          messages.push({
            type: 'tool',
            id: step.message_id,
            tool: step.tool || '',
            toolCallId: step.tool_call_id || '',
            input: step.input ?? {},
            output: step.output ?? null,
            status: (step.status as 'done' | 'error') || 'done',
            timestamp: step.timestamp || turn.created_at,
          })
          break

        case 'question':
          messages.push({
            type: 'question',
            id: step.message_id,
            questionId: step.question_id || '',
            questions: step.questions ?? [],
            answers: step.answers ?? null,
            status: step.answers ? 'answered' : 'pending',
            timestamp: step.timestamp || turn.created_at,
          })
          break

        case 'steering':
        case 'user_prompt':
          if (step.content) {
            messages.push({
              type: 'enqueued_prompt',
              id: step.message_id,
              content: step.content,
              timestamp: step.timestamp || turn.created_at,
              confirmed: true,
            })
          }
          break
      }
    }
  }
  return messages
}

// ── Mount React + listen for host messages ──────────────────────────────────

const root = createRoot(document.getElementById('root')!)
root.render(<App />)

window.addEventListener('message', (event) => {
  handleHostMessage(event.data as HostMessage)
})

// Signal ready to host
postToHost({ type: 'ready' })
