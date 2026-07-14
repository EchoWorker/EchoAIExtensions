import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
  finished: boolean
}

export function TextBubble({ content, finished }: Props) {
  if (!content?.trim() && finished) return null
  return (
    <div className="eb-block eb-block-assistant">
      <div className="eb-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || '...'}</ReactMarkdown>
        {!finished && <span className="eb-cursor-dot" />}
      </div>
    </div>
  )
}
