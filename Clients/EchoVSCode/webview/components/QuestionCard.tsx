import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { postToHost } from '../vscode'
import { useSessionStore } from '../stores'
import type { Question } from '../../shared/protocol'

interface Props {
  questionId: string
  questions: Question[]
  answers: unknown
  status: 'pending' | 'answered' | 'timed_out'
}

export function QuestionCard({ questionId, questions, answers, status }: Props) {
  const sessionKey = useSessionStore((s) => s.activeSessionKey)
  const [localAnswers, setLocalAnswers] = useState<Record<string, string | string[]>>({})
  const [otherInputs, setOtherInputs] = useState<Record<number, string>>({})
  const isAnswered = status !== 'pending'

  const handleSelect = (q: Question, label: string) => {
    if (isAnswered) return
    if (q.multiSelect) {
      const current = (localAnswers[q.question] ?? []) as string[]
      const updated = current.includes(label) ? current.filter((l) => l !== label) : [...current, label]
      setLocalAnswers({ ...localAnswers, [q.question]: updated })
    } else {
      setLocalAnswers({ ...localAnswers, [q.question]: label })
    }
  }

  const handleSubmit = () => {
    if (!sessionKey || isAnswered) return
    const final = { ...localAnswers }
    for (const [idx, text] of Object.entries(otherInputs)) {
      const q = questions[Number(idx)]
      if (q && text.trim()) final[q.question] = text.trim()
    }
    postToHost({ type: 'answer-question', sessionKey, questionId, answers: final })
  }

  // Plan review handling
  const planQuestion = questions.find((q) => q.plan_text)
  if (planQuestion) {
    return <PlanReview question={planQuestion} questionId={questionId} sessionKey={sessionKey} isAnswered={isAnswered} />
  }

  return (
    <div className={`eb-question-card ${isAnswered ? 'is-answered' : ''}`}>
      {questions.map((q, qIdx) => (
        <div key={qIdx} className="eb-question-item">
          <div className="eb-question-text">{q.question}</div>
          {q.options && (
            <div className="eb-question-options">
              {q.options.map((opt, oIdx) => {
                const selected = q.multiSelect
                  ? ((localAnswers[q.question] ?? []) as string[]).includes(opt.label)
                  : localAnswers[q.question] === opt.label
                return (
                  <button
                    key={oIdx}
                    className={`eb-option-btn ${selected ? 'is-selected' : ''}`}
                    disabled={isAnswered}
                    onClick={() => handleSelect(q, opt.label)}
                  >
                    {opt.label}
                    {opt.description && <span className="eb-option-desc">{opt.description}</span>}
                  </button>
                )
              })}
              {!isAnswered && (
                <input
                  type="text"
                  className="eb-other-input"
                  placeholder="Other…"
                  value={otherInputs[qIdx] ?? ''}
                  onChange={(e) => setOtherInputs({ ...otherInputs, [qIdx]: e.target.value })}
                />
              )}
            </div>
          )}
        </div>
      ))}
      {!isAnswered && <button className="eb-submit-btn" onClick={handleSubmit}>Submit</button>}
      {isAnswered && (
        <div className="eb-answered-tag">{status === 'answered' ? '✓ Answered' : '⏰ Timed out'}</div>
      )}
    </div>
  )
}

function PlanReview({ question, questionId, sessionKey, isAnswered }: {
  question: Question
  questionId: string
  sessionKey: string | null
  isAnswered: boolean
}) {
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)

  const approve = () => {
    if (!sessionKey) return
    postToHost({ type: 'answer-question', sessionKey, questionId, answers: { [question.question]: 'Approve' } })
  }

  const reject = () => {
    if (!sessionKey || !rejectReason.trim()) return
    postToHost({ type: 'answer-question', sessionKey, questionId, answers: { [question.question]: `Reject: ${rejectReason.trim()}` } })
  }

  return (
    <div className={`eb-question-card ${isAnswered ? 'is-answered' : ''}`}>
      <div className="eb-plan-header">📋 Plan Review</div>
      <div className="eb-plan-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{question.plan_text ?? ''}</ReactMarkdown>
      </div>
      {!isAnswered && (
        <div className="eb-plan-actions">
          <button className="eb-submit-btn" onClick={approve}>✓ Approve</button>
          <button className="eb-option-btn" onClick={() => setShowReject(!showReject)}>✗ Reject</button>
          {showReject && (
            <>
              <input
                type="text"
                className="eb-other-input"
                placeholder="Reason for rejection…"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && reject()}
                autoFocus
                style={{ flex: 1, minWidth: 200 }}
              />
              <button className="eb-submit-btn" onClick={reject} disabled={!rejectReason.trim()}>Send</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
