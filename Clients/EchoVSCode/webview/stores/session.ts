/**
 * session.ts — Session store.
 *
 * Two separate concepts:
 *  - `sessions`: full list of sessions (known to the gateway) for the current workspace.
 *  - `openTabKeys`: subset of sessionKeys currently shown as tabs.
 *  - `activeSessionKey`: which tab is focused (must be in openTabKeys).
 *
 * Restart persistence: the host writes openTabKeys + activeSessionKey to
 * vscode.workspaceState and replays them on next startup via the `sessions`
 * message (restoreTabKeys / restoreActiveKey).
 */

import { create } from 'zustand'

export interface Session {
  sessionKey: string
  title: string
  workspacePath: string
  createdAt: string
  updatedAt: string
}

interface SessionState {
  /** Every session known to belong to the current workspace (from gateway + locally created pending ones). */
  sessions: Session[]
  /** Subset of session keys currently rendered as tabs. Order = tab order. */
  openTabKeys: string[]
  /** The active tab (must be a member of openTabKeys, or null when no tab is open). */
  activeSessionKey: string | null
}

interface SessionActions {
  /** Replace the full session list (called from host's `sessions` message). */
  setSessions: (sessions: Session[]) => void

  /** Add or upsert a session into the full list (no effect on openTabKeys). */
  upsertSession: (session: Session) => void

  /** Create a new pending session AND open it in a tab AND activate it. */
  createAndOpenSession: (session: Session) => void

  /** Open a session as a tab (idempotent) and activate it. */
  openTab: (key: string) => void

  /** Close a tab (removes from openTabKeys). Session stays in `sessions`. */
  closeTab: (key: string) => void

  /** Delete a session entirely (removes from both openTabKeys and sessions). */
  deleteSession: (key: string) => void

  /** Switch active tab. */
  setActiveSession: (key: string | null) => void

  renameSession: (key: string, title: string) => void

  /** When backend assigns a real session_key to a previously-pending temp key. */
  replaceSessionKey: (oldKey: string, newKey: string, title?: string) => void
}

export const useSessionStore = create<SessionState & SessionActions>()((set, get) => ({
  sessions: [],
  openTabKeys: [],
  activeSessionKey: null,

  setSessions: (sessions) => set({ sessions }),

  upsertSession: (session) => {
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.sessionKey === session.sessionKey)
      if (idx >= 0) {
        const next = s.sessions.slice()
        next[idx] = { ...next[idx], ...session }
        return { sessions: next }
      }
      return { sessions: [...s.sessions, session] }
    })
  },

  createAndOpenSession: (session) => {
    set((s) => ({
      sessions: s.sessions.some((x) => x.sessionKey === session.sessionKey)
        ? s.sessions
        : [...s.sessions, session],
      openTabKeys: s.openTabKeys.includes(session.sessionKey)
        ? s.openTabKeys
        : [...s.openTabKeys, session.sessionKey],
      activeSessionKey: session.sessionKey,
    }))
  },

  openTab: (key) => {
    set((s) => ({
      openTabKeys: s.openTabKeys.includes(key) ? s.openTabKeys : [...s.openTabKeys, key],
      activeSessionKey: key,
    }))
  },

  closeTab: (key) => {
    set((s) => {
      const idx = s.openTabKeys.indexOf(key)
      const nextKeys = s.openTabKeys.filter((k) => k !== key)
      let nextActive = s.activeSessionKey
      if (s.activeSessionKey === key) {
        nextActive = nextKeys.length === 0
          ? null
          : nextKeys[Math.min(idx, nextKeys.length - 1)] ?? null
      }
      return { openTabKeys: nextKeys, activeSessionKey: nextActive }
    })
  },

  deleteSession: (key) => {
    set((s) => {
      const idx = s.openTabKeys.indexOf(key)
      const nextKeys = s.openTabKeys.filter((k) => k !== key)
      let nextActive = s.activeSessionKey
      if (s.activeSessionKey === key) {
        nextActive = nextKeys.length === 0
          ? null
          : nextKeys[Math.min(idx, nextKeys.length - 1)] ?? null
      }
      return {
        sessions: s.sessions.filter((x) => x.sessionKey !== key),
        openTabKeys: nextKeys,
        activeSessionKey: nextActive,
      }
    })
  },

  setActiveSession: (key) => set({ activeSessionKey: key }),

  renameSession: (key, title) => {
    set((s) => ({
      sessions: s.sessions.map((x) => (x.sessionKey === key ? { ...x, title } : x)),
    }))
  },

  replaceSessionKey: (oldKey, newKey, title) => {
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.sessionKey === oldKey
          ? { ...x, sessionKey: newKey, ...(title ? { title } : {}) }
          : x,
      ),
      openTabKeys: s.openTabKeys.map((k) => (k === oldKey ? newKey : k)),
      activeSessionKey: s.activeSessionKey === oldKey ? newKey : s.activeSessionKey,
    }))
  },
}))
