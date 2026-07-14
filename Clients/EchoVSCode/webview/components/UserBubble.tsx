import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
  attachments?: string[]
  slashCommand?: string
}

export function UserBubble({ content, attachments, slashCommand }: Props) {
  const hasContent = content.trim().length > 0

  return (
    <div className="eb-block eb-block-user-wrapper">
      <div className="eb-user-avatar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <div className="eb-block-user">
        <div className="eb-user-content">
          {slashCommand && (
            <span className="eb-cmd-pill" title={`/${slashCommand}`}>
              <span className="eb-cmd-pill-slash">/</span>{slashCommand}
            </span>
          )}
          {hasContent && (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          )}
          {attachments && attachments.length > 0 && (
            <div className="eb-user-attachments">
              {attachments.map((a, i) => (
                <span key={i} className="eb-attachment-tag">📎 Attachment {i + 1}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
