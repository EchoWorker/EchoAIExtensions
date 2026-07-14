import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ToolCallCard } from './ToolCallCard'

interface Props {
  label: string
  taskType?: string
  innerTools: Array<{ tool: string; toolCallId: string; input: unknown; output: unknown; status: 'pending' | 'done' | 'error' }>
  textSegments: string[]
  result?: string
  status: 'running' | 'done' | 'error'
}

export function SubagentCard({ label, taskType, innerTools, textSegments, result, status }: Props) {
  const [expanded, setExpanded] = useState(false)
  const icon = status === 'running' ? '⟳' : status === 'done' ? '✓' : '✗'

  return (
    <div className="eb-subagent-card">
      <div className="eb-subagent-header" onClick={() => setExpanded(!expanded)}>
        <span className="eb-subagent-icon">{icon}</span>
        <span className="eb-subagent-label">{label}</span>
        {taskType && <span className="eb-subagent-type">{taskType}</span>}
        <span className="eb-tool-chevron">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="eb-subagent-body">
          {innerTools.map((t, i) => (
            <ToolCallCard
              key={t.toolCallId || i}
              tool={t.tool}
              input={t.input}
              output={t.output}
              status={t.status}
            />
          ))}
          {textSegments.length > 0 && (
            <div className="eb-subagent-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{textSegments.join('')}</ReactMarkdown>
            </div>
          )}
          {result && (
            <div className="eb-subagent-result">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
