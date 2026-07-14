import React, { useState, useRef, useEffect } from 'react'

interface Props {
  sessionKey: string
  title: string
  isActive: boolean
  isRunning: boolean
  onActivate: () => void
  onClose: () => void
  onRename: (newTitle: string) => void
  onContextMenu: (e: React.MouseEvent) => void
}

export function SessionTab({ title, isActive, isRunning, onActivate, onClose, onRename, onContextMenu }: Props) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const startEdit = () => {
    setEditValue(title)
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== title) onRename(trimmed)
  }

  return (
    <div
      className={`eb-tab ${isActive ? 'is-active' : ''}`}
      onClick={onActivate}
      onDoubleClick={startEdit}
      onContextMenu={onContextMenu}
      title={title}
    >
      {isRunning ? (
        <span className="eb-tab-running-dot" />
      ) : (
        <span className="eb-tab-icon">💬</span>
      )}
      {editing ? (
        <input
          ref={inputRef}
          className="eb-tab-edit-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="eb-tab-title">{title}</span>
      )}
      <button
        className="eb-tab-close"
        title="Close"
        onClick={(e) => { e.stopPropagation(); onClose() }}
      >✕</button>
    </div>
  )
}
