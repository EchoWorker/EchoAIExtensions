import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
  kind?: 'error' | 'cancelled'
}

export function ErrorCard({ content, kind }: Props) {
  if (kind === 'cancelled' && !content) {
    return (
      <div className="eb-error-card is-cancelled">
        <span className="eb-error-icon">⊘</span>
        <span>Cancelled</span>
      </div>
    )
  }
  return (
    <div className="eb-error-card">
      <span className="eb-error-icon">⚠</span>
      <div className="eb-error-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  )
}
