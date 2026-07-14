import React from 'react'

interface Props {
  status: 'streaming' | 'cancelling' | 'waiting'
}

export function StatusIndicator({ status }: Props) {
  const cls = status === 'cancelling' ? 'eb-cancelling' : ''
  const text = status === 'cancelling' ? 'Cancelling' : status === 'waiting' ? 'Waiting' : 'Thinking'

  return (
    <div className={`eb-thinking-indicator ${cls}`}>
      <span className="eb-ti-dot" />
      <span className="eb-ti-label">{text}</span>
    </div>
  )
}
