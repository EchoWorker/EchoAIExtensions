import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useSessionStore, useTaskStore } from '../stores'
import { useChatSubmit } from '../hooks/useChatSubmit'
import { useAttachmentStaging, formatBytes } from '../hooks/useAttachmentStaging'
import { ModelSelector } from './ModelSelector'
import { BackgroundTaskBar } from './BackgroundTaskBar'

/** Format token count: <1K raw, <10K one decimal, ≥10K integer */
function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) {
    const v = n / 1000
    return v % 1 === 0 ? `${v}K` : `${v.toFixed(1)}K`
  }
  return `${Math.round(n / 1000)}K`
}

export function InputBox() {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { send, cancel } = useChatSubmit()
  const {
    stagedAttachments,
    stageFile,
    removeAttachment,
    clearAttachments,
    handlePaste,
    handleDrop,
    handleDragOver,
  } = useAttachmentStaging()

  const activeSessionKey = useSessionStore((s) => s.activeSessionKey)
  const runningTask = useTaskStore((s) =>
    activeSessionKey ? s.runningTasks[activeSessionKey] ?? null : null,
  )
  const contextUsage = useTaskStore((s) =>
    activeSessionKey ? s.contextUsage[activeSessionKey] : undefined,
  )
  const isStreaming = runningTask !== null

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 240) + 'px'
    }
  }, [input])

  const handleSend = useCallback(() => {
    const text = input.trim()
    const hasAttach = stagedAttachments.length > 0
    if (!text && !hasAttach && isStreaming) {
      cancel()
      return
    }
    if (!text && !hasAttach) return
    const dataUris = stagedAttachments.map((a) => a.dataUri)
    send(text, dataUris)
    setInput('')
    clearAttachments()
  }, [input, stagedAttachments, isStreaming, send, cancel, clearAttachments])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleFilePicker = useCallback(() => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.multiple = true
    inp.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? [])
      for (const f of files) stageFile(f)
    }
    inp.click()
  }, [stageFile])

  const placeholder = isStreaming
    ? 'Send a follow-up while AI is working…'
    : 'Ask EchoAI anything… (Enter to send, Shift+Enter for newline)'

  return (
    <div className="eb-input-area">
      {activeSessionKey && <BackgroundTaskBar sessionKey={activeSessionKey} />}
      <div className="eb-input-box" onDrop={handleDrop} onDragOver={handleDragOver}>
        {stagedAttachments.length > 0 && (
          <div className="eb-input-attachments">
            {stagedAttachments.map((a, i) => (
              <span key={i} className="eb-input-attachment" title={`${a.name} (${formatBytes(a.size)})`}>
                {a.type === 'image' ? (
                  <img src={a.dataUri} alt={a.name} style={{ width: 18, height: 18, objectFit: 'cover', borderRadius: 2 }} />
                ) : (
                  <span>📎</span>
                )}
                <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                <span
                  className="eb-input-attachment-close"
                  onClick={() => removeAttachment(i)}
                  title="Remove"
                >×</span>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="eb-input"
          placeholder={placeholder}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <div className="eb-toolbar">
          <div className="eb-toolbar-left">
            <button
              className="eb-toolbar-btn"
              onClick={handleFilePicker}
              title="Attach file"
            >📎</button>
            {activeSessionKey && <ModelSelector sessionKey={activeSessionKey} />}
            {contextUsage && contextUsage.window > 0 && (
              <span className="eb-usage-badge">
                {formatTokens(contextUsage.tokens)}/{formatTokens(contextUsage.window)}
              </span>
            )}
          </div>
          <div className="eb-toolbar-right">
            <button
              className={`eb-toolbar-btn ${isStreaming ? 'eb-btn-stop' : 'eb-btn-send'}`}
              onClick={handleSend}
              title={isStreaming ? 'Stop' : 'Send (Enter)'}
            >
              {isStreaming ? '■' : '↑'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
