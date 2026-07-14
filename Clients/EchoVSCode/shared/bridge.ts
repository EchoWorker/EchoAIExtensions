/**
 * bridge.ts — Host ↔ Webview message types.
 */

import type { SessionInfo, Turn, ModelInfo, SlashBlock } from './protocol'

// ── Host → Webview ──────────────────────────────────────────────────────────

export type HostMessage =
  | { type: 'connection-status'; status: 'connected' | 'connecting' | 'disconnected'; error?: string }
  | { type: 'sessions'; sessions: SessionInfo[]; workspacePath: string; restoreTabKeys: string[]; restoreActiveKey: string | null }
  | { type: 'history'; sessionKey: string; turns: Turn[]; hasMore: boolean; cursor: string | null }
  | { type: 'chat-event'; sessionKey: string; params: Record<string, unknown> }
  | { type: 'models'; models: ModelInfo[]; defaultModel: string }
  | { type: 'session-replaced'; oldKey: string; newKey: string; title: string }
  | { type: 'turn-started'; sessionKey: string; turnId: string }
  | { type: 'workspace'; path: string }
  | { type: 'error'; message: string }
  | { type: 'session-created'; sessionKey: string; title: string; workspacePath: string }

// ── Webview → Host ──────────────────────────────────────────────────────────

export type WebviewMessage =
  | { type: 'send'; sessionKey: string; text: string; attachments?: string[]; model?: string; modes?: string[]; slashCommand?: string; slashBlocks?: SlashBlock[]; userMsgId?: string }
  | { type: 'enqueue'; sessionKey: string; text: string; steerId: string; attachments?: string[] }
  | { type: 'cancel'; sessionKey: string }
  | { type: 'new-session' }
  | { type: 'switch-session'; sessionKey: string }
  | { type: 'subscribe-session'; sessionKey: string }
  | { type: 'close-session'; sessionKey: string }
  | { type: 'delete-session'; sessionKey: string }
  | { type: 'rename-session'; sessionKey: string; title: string }
  | { type: 'set-model'; sessionKey: string; model: string }
  | { type: 'answer-question'; sessionKey: string; questionId: string; answers: Record<string, string | string[]> }
  | { type: 'load-older'; sessionKey: string; cursor: string }
  | { type: 'cancel-bg-task'; sessionKey: string; taskId: string }
  | { type: 'persist-tabs'; openTabKeys: string[]; activeTabKey: string | null }
  | { type: 'ready' }
