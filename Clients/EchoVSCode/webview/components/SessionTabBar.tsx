import React, { useState } from 'react'
import { useSessionStore, useTaskStore, useMessageStore } from '../stores'
import { postToHost } from '../vscode'
import { SessionTab } from './SessionTab'
import { SessionContextMenu } from './SessionContextMenu'

interface CtxState {
  x: number
  y: number
  sessionKey: string
}

export function SessionTabBar() {
  const sessions = useSessionStore((s) => s.sessions)
  const openTabKeys = useSessionStore((s) => s.openTabKeys)
  const activeSessionKey = useSessionStore((s) => s.activeSessionKey)
  const runningTasks = useTaskStore((s) => s.runningTasks)
  const [ctx, setCtx] = useState<CtxState | null>(null)

  // Derive ordered list of open sessions for rendering
  const openSessions = openTabKeys
    .map((k) => sessions.find((s) => s.sessionKey === k))
    .filter((s): s is NonNullable<typeof s> => s != null)

  const handleNewSession = () => postToHost({ type: 'new-session' })

  const handleActivate = (sessionKey: string) => {
    useSessionStore.getState().setActiveSession(sessionKey)
    postToHost({ type: 'switch-session', sessionKey })
  }

  const handleClose = (sessionKey: string) => {
    useSessionStore.getState().closeTab(sessionKey)
    postToHost({ type: 'close-session', sessionKey })
  }

  const handleDelete = (sessionKey: string) => {
    useSessionStore.getState().deleteSession(sessionKey)
    useMessageStore.getState().clearMessages(sessionKey)
    postToHost({ type: 'delete-session', sessionKey })
    setCtx(null)
  }

  const handleClear = (sessionKey: string) => {
    useMessageStore.getState().clearMessages(sessionKey)
    setCtx(null)
  }

  const handleRename = (sessionKey: string, title: string) => {
    useSessionStore.getState().renameSession(sessionKey, title)
    postToHost({ type: 'rename-session', sessionKey, title })
  }

  const handleContextMenu = (e: React.MouseEvent, sessionKey: string) => {
    e.preventDefault()
    setCtx({ x: e.clientX, y: e.clientY, sessionKey })
  }

  const ctxSession = ctx ? sessions.find((s) => s.sessionKey === ctx.sessionKey) : null

  return (
    <div className="eb-tab-bar"
      onWheel={(e) => {
        // Convert vertical wheel to horizontal scroll
        if (e.deltaY !== 0) {
          (e.currentTarget as HTMLDivElement).scrollLeft += e.deltaY
        }
      }}
    >
      {openSessions.map((s) => (
        <SessionTab
          key={s.sessionKey}
          sessionKey={s.sessionKey}
          title={s.title}
          isActive={s.sessionKey === activeSessionKey}
          isRunning={!!runningTasks[s.sessionKey]}
          onActivate={() => handleActivate(s.sessionKey)}
          onClose={() => handleClose(s.sessionKey)}
          onRename={(t) => handleRename(s.sessionKey, t)}
          onContextMenu={(e) => handleContextMenu(e, s.sessionKey)}
        />
      ))}
      <button className="eb-tab-add" onClick={handleNewSession} title="New Chat">+</button>

      {ctx && ctxSession && (
        <SessionContextMenu
          x={ctx.x}
          y={ctx.y}
          onRename={() => {
            // Just close menu — actual rename UX is double-click on tab.
            // For parity, we could trigger inline edit here, but keeping it simple.
            setCtx(null)
          }}
          onClear={() => handleClear(ctx.sessionKey)}
          onDelete={() => handleDelete(ctx.sessionKey)}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  )
}
