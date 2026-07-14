import { useState } from 'react'
import type { CapturedContext } from '@/core/perception'

interface Props {
  ctx: CapturedContext
  xml: string
  onChange(xml: string): void
}

/**
 * Privacy preview — lets the user see (and edit) the exact screen context that
 * will be sent to the AI before asking. Collapsed by default.
 */
export function PerceptionPreview({ ctx, xml, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)

  return (
    <div className="my-3 rounded-lg border border-white/5 bg-black/10">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-white/60 hover:text-white"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="font-medium">Screen context</span>
        <span className="text-white/40">
          {ctx.node_count} elements
          {ctx.omitted > 0 ? ` · ${ctx.omitted} omitted` : ''}
        </span>
        <span className="flex-1" />
        <span className="text-white/30">what gets sent to the AI</span>
      </button>

      {open && (
        <div className="px-3 pb-3">
          <div className="mb-2 flex items-center gap-2">
            <button
              className="rounded bg-white/5 px-2 py-0.5 text-xs text-white/60 hover:text-white"
              onClick={() => setEditing((e) => !e)}
            >
              {editing ? 'Done editing' : 'Edit'}
            </button>
            <span className="text-xs text-white/30">
              Remove anything sensitive before asking.
            </span>
          </div>
          {editing ? (
            <textarea
              className="selectable h-48 w-full resize-none rounded bg-black/30 p-2 font-mono text-xs text-white/80 outline-none"
              value={xml}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <pre className="selectable max-h-48 overflow-auto rounded bg-black/30 p-2 font-mono text-xs text-white/70">
              {xml}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
