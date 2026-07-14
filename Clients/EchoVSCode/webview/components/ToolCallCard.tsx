import React, { useState } from 'react'

interface Props {
  tool: string
  input: unknown
  output: unknown
  status: 'pending' | 'done' | 'error'
}

function formatSummary(tool: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  // Per-tool short summaries
  if (tool === 'bash') return String(obj.command ?? '')
  if (tool === 'write' || tool === 'edit' || tool === 'read') return String(obj.path ?? obj.file_path ?? '')
  if (tool === 'grep' || tool === 'find') return `${obj.pattern ?? ''}${obj.path ? ' · ' + obj.path : ''}`
  if (tool === 'web_fetch') return String(obj.url ?? '')
  if (tool === 'web_search') return String(obj.query ?? '')
  // Generic: take first string-ish value
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v.length < 200) return v
  }
  return ''
}

function formatBody(input: unknown, output: unknown): string {
  const parts: string[] = []
  if (input && typeof input === 'object') {
    parts.push('▸ Input:')
    parts.push(JSON.stringify(input, null, 2))
  }
  if (output != null) {
    parts.push('▸ Output:')
    parts.push(typeof output === 'string' ? output : JSON.stringify(output, null, 2))
  }
  return parts.join('\n')
}

export function ToolCallCard({ tool, input, output, status }: Props) {
  const [expanded, setExpanded] = useState(false)
  const summary = formatSummary(tool, input)
  const statusIcon = status === 'pending' ? '⟳' : status === 'done' ? '✓' : '✗'
  const statusClass = status === 'pending' ? 'is-running' : status === 'done' ? 'is-done' : 'is-error'

  return (
    <div className="eb-block eb-block-tool">
      <div className="eb-tool-line" onClick={() => setExpanded(!expanded)}>
        <span className="eb-tool-chevron">{expanded ? '▾' : '▸'}</span>
        <span className="eb-tool-name">{tool}</span>
        {summary && <span className="eb-tool-summary">{summary}</span>}
        <span className={`eb-tool-status ${statusClass}`}>{statusIcon}</span>
      </div>
      {expanded && (
        <div className="eb-tool-body">
          <pre>{formatBody(input, output)}</pre>
        </div>
      )}
    </div>
  )
}
