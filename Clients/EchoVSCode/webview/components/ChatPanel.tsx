import React from 'react'
import { useSessionStore, useConnectionStore, useUIStore } from '../stores'
import { SessionTabBar } from './SessionTabBar'
import { ConnectionBanner } from './ConnectionBanner'
import { MessageList } from './MessageList'
import { InputBox } from './InputBox'

export function ChatPanel() {
  const status = useConnectionStore((s) => s.status)
  const activeSessionKey = useSessionStore((s) => s.activeSessionKey)
  const hasOpenTabs = useSessionStore((s) => s.openTabKeys.length > 0)
  const centered = useUIStore((s) => s.chatContentCentered)

  return (
    <div className={`eb-chat-panel ${centered ? 'eb-chat-centered' : ''}`}>
      {hasOpenTabs && <SessionTabBar />}
      {status !== 'connected' && <ConnectionBanner />}
      <MessageList sessionKey={activeSessionKey} />
      {status === 'connected' && <InputBox />}
    </div>
  )
}
