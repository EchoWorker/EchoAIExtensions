/**
 * Conversation + connection state for the overlay.
 */

import { create } from 'zustand'

export type Phase = 'idle' | 'capturing' | 'asking' | 'answering' | 'error'

interface ConversationState {
  /** Stable session key for follow-up turns within one overlay session. */
  sessionKey: string
  phase: Phase
  /** The streamed assistant answer (markdown). */
  answer: string
  /** Error text, if any. */
  error: string
  /** Whether the gateway is connected. */
  connected: boolean
  /** Connection problem to surface (e.g. gateway not running). */
  connectionError: string

  setPhase(phase: Phase): void
  appendAnswer(delta: string): void
  resetAnswer(): void
  setError(error: string): void
  setConnected(connected: boolean, error?: string): void
  newSession(): void
}

function freshSessionKey(): string {
  return `echolens_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export const useConversation = create<ConversationState>((set) => ({
  sessionKey: freshSessionKey(),
  phase: 'idle',
  answer: '',
  error: '',
  connected: false,
  connectionError: '',

  setPhase: (phase) => set({ phase }),
  appendAnswer: (delta) => set((s) => ({ answer: s.answer + delta })),
  resetAnswer: () => set({ answer: '', error: '' }),
  setError: (error) => set({ error, phase: 'error' }),
  setConnected: (connected, error = '') => set({ connected, connectionError: error }),
  newSession: () =>
    set({ sessionKey: freshSessionKey(), answer: '', error: '', phase: 'idle' }),
}))
