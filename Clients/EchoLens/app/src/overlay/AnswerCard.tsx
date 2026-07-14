import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { useConversation } from '@/stores/conversation'

/**
 * Streaming answer card. Renders the assistant's markdown answer; shows a
 * blinking caret while streaming, and an error banner on failure.
 */
export function AnswerCard() {
  const answer = useConversation((s) => s.answer)
  const phase = useConversation((s) => s.phase)
  const error = useConversation((s) => s.error)

  if (phase === 'error' && error) {
    return (
      <div className="my-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
        {error}
      </div>
    )
  }

  if (!answer && phase !== 'answering') {
    return null
  }

  const streaming = phase === 'answering'

  return (
    <div className="my-3 rounded-lg bg-black/20 px-4 py-3">
      <div className={`answer-md selectable ${streaming ? 'streaming-caret' : ''}`}>
        {answer ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {answer}
          </ReactMarkdown>
        ) : (
          <span className="text-white/40">Thinking…</span>
        )}
      </div>
    </div>
  )
}
