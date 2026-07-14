/**
 * task.ts — Running tasks, context usage, background tasks store.
 */

import { create } from 'zustand'

export interface RunningTask {
  turnId: string
  sessionKey: string
  status: 'streaming' | 'cancelling'
}

export interface BackgroundTask {
  taskId: string
  tool: string
  description: string
  status: 'running' | 'done' | 'failed' | 'cancelled' | 'cancelling'
}

interface TaskState {
  runningTasks: Record<string, RunningTask | null>
  contextUsage: Record<string, { tokens: number; window: number }>
  sessionExpense: Record<string, { expense: number; currency: string }>
  backgroundTasks: Record<string, BackgroundTask[]>
}

interface TaskActions {
  setRunningTask: (key: string, task: RunningTask | null) => void
  setContextUsage: (key: string, usage: { tokens: number; window: number }) => void
  setSessionExpense: (key: string, expense: { expense: number; currency: string }) => void
  addBackgroundTask: (key: string, task: BackgroundTask) => void
  updateBackgroundTask: (key: string, taskId: string, update: Partial<BackgroundTask>) => void
}

export const useTaskStore = create<TaskState & TaskActions>()((set) => ({
  runningTasks: {},
  contextUsage: {},
  sessionExpense: {},
  backgroundTasks: {},

  setRunningTask: (key, task) => {
    set((s) => ({ runningTasks: { ...s.runningTasks, [key]: task } }))
  },

  setContextUsage: (key, usage) => {
    set((s) => ({ contextUsage: { ...s.contextUsage, [key]: usage } }))
  },

  setSessionExpense: (key, expense) => {
    set((s) => ({ sessionExpense: { ...s.sessionExpense, [key]: expense } }))
  },

  addBackgroundTask: (key, task) => {
    set((s) => ({
      backgroundTasks: {
        ...s.backgroundTasks,
        [key]: [...(s.backgroundTasks[key] ?? []), task],
      },
    }))
  },

  updateBackgroundTask: (key, taskId, update) => {
    set((s) => ({
      backgroundTasks: {
        ...s.backgroundTasks,
        [key]: (s.backgroundTasks[key] ?? []).map((t) =>
          t.taskId === taskId ? { ...t, ...update } : t,
        ),
      },
    }))
  },
}))
