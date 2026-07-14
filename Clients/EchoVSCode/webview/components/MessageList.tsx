import React, { useRef, useEffect } from 'react'
import { useMessageStore, useTaskStore } from '../stores'
import { MessageItem } from './MessageItem'
import { StatusIndicator } from './StatusIndicator'

interface Props { sessionKey: string | null }

export function MessageList({ sessionKey }: Props) {
  const messages = useMessageStore((s) => (sessionKey ? s.messages[sessionKey] ?? [] : []))
  const runningTask = useTaskStore((s) => (sessionKey ? s.runningTasks[sessionKey] ?? null : null))
  const bottomRef = useRef<HTMLDivElement>(null)

  const isStreaming = runningTask !== null
  const lastMsg = messages[messages.length - 1]
  const scrollTrigger = lastMsg
    ? `${lastMsg.id}_${lastMsg.type === 'text' ? (lastMsg as { content: string }).content.length : 0}`
    : ''

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, scrollTrigger])

  if (!sessionKey || messages.length === 0) {
    return (
      <div className="eb-messages">
        <div className="eb-empty-state">
          <div className="eb-empty-icon">⚡</div>
          <div className="eb-empty-text">EchoAI ready</div>
          <div className="eb-empty-hint">Ask anything to get started</div>
        </div>
      </div>
    )
  }

  return (
    <div className="eb-messages">
      {messages.map((msg, idx) => (
        <MessageItem
          key={msg.id}
          message={msg}
          isLast={idx === messages.length - 1}
          isStreaming={isStreaming}
        />
      ))}
      {isStreaming && (
        <StatusIndicator status={runningTask.status === 'cancelling' ? 'cancelling' : 'streaming'} />
      )}
      <div ref={bottomRef} />
    </div>
  )
}
