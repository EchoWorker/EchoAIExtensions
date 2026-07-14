import React, { useEffect, useRef } from 'react'

interface Props {
  x: number
  y: number
  onRename: () => void
  onClear: () => void
  onDelete: () => void
  onClose: () => void
}

export function SessionContextMenu({ x, y, onRename, onClear, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('contextmenu', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('contextmenu', handler)
    }
  }, [onClose])

  // Clamp to viewport
  const maxX = window.innerWidth - 180
  const maxY = window.innerHeight - 160

  return (
    <div
      ref={ref}
      className="eb-ctx-menu"
      style={{ left: Math.min(x, maxX), top: Math.min(y, maxY) }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button className="eb-ctx-item" onClick={onRename}>
        <span className="eb-ctx-icon">✎</span><span>Rename</span>
      </button>
      <button className="eb-ctx-item" onClick={onClear}>
        <span className="eb-ctx-icon">🧹</span><span>Clear messages</span>
      </button>
      <div className="eb-ctx-sep" />
      <button className="eb-ctx-item eb-ctx-danger" onClick={onDelete}>
        <span className="eb-ctx-icon">🗑</span><span>Delete</span>
      </button>
    </div>
  )
}
