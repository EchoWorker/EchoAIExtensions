/**
 * message.ts — Per-session message store.
 */

import { create } from 'zustand'

// ── Message union type ──────────────────────────────────────────────────────

export type Message =
  | { type: 'user_prompt'; id: string; content: string; timestamp: string; attachments?: string[]; slashCommand?: string }
  | { type: 'text'; id: string; content: string; timestamp: string }
  | { type: 'thinking'; id: string; content: string; timestamp: string; collapsed: boolean }
  | { type: 'tool'; id: string; tool: string; toolCallId: string; input: unknown; output: unknown; status: 'pending' | 'done' | 'error'; timestamp: string }
  | { type: 'question'; id: string; questionId: string; questions: unknown[]; answers: unknown; status: 'pending' | 'answered' | 'timed_out'; timestamp: string; errorType?: string; retryable?: boolean }
  | { type: 'subagent'; id: string; subagentId: string; label: string; taskType?: string; innerTools: Array<{ tool: string; toolCallId: string; input: unknown; output: unknown; status: 'pending' | 'done' | 'error' }>; textSegments: string[]; result?: string; status: 'running' | 'done' | 'error'; timestamp: string }
  | { type: 'enqueued_prompt'; id: string; content: string; timestamp: string; confirmed?: boolean; attachments?: string[] }
  | { type: 'error'; id: string; content: string; timestamp: string; kind?: 'error' | 'cancelled'; errorType?: string; retryable?: boolean }

interface MessageState {
  messages: Record<string, Message[]>
}

interface MessageActions {
  setMessages: (key: string, msgs: Message[]) => void
  appendMessage: (key: string, msg: Message) => void
  updateMessage: (key: string, id: string, update: Partial<Message>) => void
  clearMessages: (key: string) => void
  findMessage: (key: string, id: string) => Message | undefined
  appendSubagentText: (key: string, subagentId: string, text: string) => void
  appendSubagentTool: (key: string, subagentId: string, tool: { tool: string; toolCallId: string; input: unknown; output: unknown; status: 'pending' | 'done' | 'error' }) => void
  updateSubagentTool: (key: string, subagentId: string, toolCallId: string, update: { output?: unknown; status?: 'pending' | 'done' | 'error' }) => void
}

export const useMessageStore = create<MessageState & MessageActions>()((set, get) => ({
  messages: {},

  setMessages: (key, msgs) => {
    set((s) => ({ messages: { ...s.messages, [key]: msgs } }))
  },

  appendMessage: (key, msg) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [key]: [...(s.messages[key] ?? []), msg],
      },
    }))
  },

  updateMessage: (key, id, update) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [key]: (s.messages[key] ?? []).map((m) =>
          m.id === id ? { ...m, ...update } as Message : m,
        ),
      },
    }))
  },

  clearMessages: (key) => {
    set((s) => ({ messages: { ...s.messages, [key]: [] } }))
  },

  findMessage: (key, id) => {
    return (get().messages[key] ?? []).find((m) => m.id === id)
  },

  appendSubagentText: (key, subagentId, text) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [key]: (s.messages[key] ?? []).map((m) => {
          if (m.type === 'subagent' && m.id === subagentId) {
            return { ...m, textSegments: [...m.textSegments, text] }
          }
          return m
        }),
      },
    }))
  },

  appendSubagentTool: (key, subagentId, tool) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [key]: (s.messages[key] ?? []).map((m) => {
          if (m.type === 'subagent' && m.id === subagentId) {
            return { ...m, innerTools: [...m.innerTools, tool] }
          }
          return m
        }),
      },
    }))
  },

  updateSubagentTool: (key, subagentId, toolCallId, update) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [key]: (s.messages[key] ?? []).map((m) => {
          if (m.type === 'subagent' && m.id === subagentId) {
            return {
              ...m,
              innerTools: m.innerTools.map((t) =>
                t.toolCallId === toolCallId ? { ...t, ...update } : t,
              ),
            }
          }
          return m
        }),
      },
    }))
  },
}))
