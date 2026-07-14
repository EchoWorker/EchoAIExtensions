import React from 'react'
import { postToHost } from '../vscode'
import { useTaskStore } from '../stores'

interface Props { sessionKey: string }

export function BackgroundTaskBar({ sessionKey }: Props) {
  const tasks = useTaskStore((s) => s.backgroundTasks[sessionKey] ?? [])
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'cancelling')

  if (running.length === 0) return null

  return (
    <div className="eb-bg-tasks">
      {running.map((task) => (
        <div key={task.taskId} className="eb-bg-task-row">
          <span className={`eb-bg-task-icon ${task.status === 'cancelling' ? 'is-cancelling' : ''}`}>
            {task.status === 'cancelling' ? '⊘' : '⟳'}
          </span>
          <span className="eb-bg-task-desc" title={task.taskId}>
            {task.description || task.tool}
          </span>
          <button
            className="eb-bg-task-cancel"
            title="Cancel"
            onClick={() => {
              useTaskStore.getState().updateBackgroundTask(sessionKey, task.taskId, { status: 'cancelling' })
              postToHost({ type: 'cancel-bg-task', sessionKey, taskId: task.taskId })
            }}
          >✕</button>
        </div>
      ))}
    </div>
  )
}
