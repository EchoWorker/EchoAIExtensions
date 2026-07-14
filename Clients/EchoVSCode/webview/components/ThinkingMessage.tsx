import React, { useState } from 'react'

interface Props {
  content: string
  isActive: boolean
}

export function ThinkingMessage({ content, isActive }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`eb-block eb-block-thinking ${expanded ? 'is-expanded' : ''}`}>
      <span
        className={`eb-thinking-label ${isActive ? 'is-active' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        {isActive ? 'Thinking…' : 'Thought'}
      </span>
      <div className="eb-content">{content}</div>
    </div>
  )
}
