import { forwardRef, useState, type KeyboardEvent } from 'react'
import { useConversation } from '@/stores/conversation'

interface Props {
  onSubmit(question: string): void
}

/**
 * The Spotlight input bar. Enter submits; Shift+Enter inserts a newline.
 */
export const InputBar = forwardRef<HTMLTextAreaElement, Props>(function InputBar(
  { onSubmit },
  ref,
) {
  const [value, setValue] = useState('')
  const phase = useConversation((s) => s.phase)
  const busy = phase === 'answering'

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (busy) return
      const q = value.trim()
      if (q) {
        onSubmit(q)
        setValue('')
      }
    }
  }

  return (
    <div className="border-t border-white/5 p-3">
      <div className="flex items-end gap-2 rounded-lg bg-white/5 px-3 py-2">
        <textarea
          ref={ref}
          className="selectable max-h-28 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-white outline-none placeholder:text-white/30"
          rows={1}
          autoFocus
          placeholder="Ask about what's on your screen…  (Enter to send, Esc to dismiss)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="rounded-md bg-accent/90 px-3 py-1 text-xs font-medium text-black hover:bg-accent disabled:opacity-40"
          disabled={busy || !value.trim()}
          onClick={() => {
            const q = value.trim()
            if (q) {
              onSubmit(q)
              setValue('')
            }
          }}
        >
          {busy ? '…' : 'Ask'}
        </button>
      </div>
    </div>
  )
})
