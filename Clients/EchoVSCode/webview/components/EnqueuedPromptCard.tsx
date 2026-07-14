import React from 'react'

interface Props {
  content: string
  confirmed?: boolean
}

export function EnqueuedPromptCard({ content, confirmed }: Props) {
  return (
    <div className={`eb-enqueued ${confirmed ? 'is-confirmed' : ''}`}>
      <span className="eb-enqueued-icon">{confirmed ? '✓' : '⏳'}</span>
      <span>{content}</span>
    </div>
  )
}
