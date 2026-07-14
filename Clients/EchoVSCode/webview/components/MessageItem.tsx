import React from 'react'
import { UserBubble } from './UserBubble'
import { TextBubble } from './TextBubble'
import { ThinkingMessage } from './ThinkingMessage'
import { ToolCallCard } from './ToolCallCard'
import { SubagentCard } from './SubagentCard'
import { QuestionCard } from './QuestionCard'
import { ErrorCard } from './ErrorCard'
import { EnqueuedPromptCard } from './EnqueuedPromptCard'
import type { Message } from '../stores/message'
import type { Question } from '../../shared/protocol'

interface Props {
  message: Message
  isLast: boolean
  isStreaming: boolean
}

export function MessageItem({ message, isLast, isStreaming }: Props) {
  switch (message.type) {
    case 'user_prompt':
      return <UserBubble content={message.content} attachments={message.attachments} slashCommand={message.slashCommand} />

    case 'enqueued_prompt':
      return <EnqueuedPromptCard content={message.content} confirmed={message.confirmed} />

    case 'text':
      if (!message.content?.trim() && !(isLast && isStreaming)) return null
      return <TextBubble content={message.content} finished={!(isLast && isStreaming)} />

    case 'thinking':
      return <ThinkingMessage content={message.content} isActive={isLast && isStreaming} />

    case 'error':
      return <ErrorCard content={message.content} kind={message.kind} />

    case 'tool':
      return (
        <ToolCallCard
          tool={message.tool}
          input={message.input}
          output={message.output}
          status={message.status}
        />
      )

    case 'subagent':
      return (
        <SubagentCard
          label={message.label}
          taskType={message.taskType}
          innerTools={message.innerTools}
          textSegments={message.textSegments}
          result={message.result}
          status={message.status}
        />
      )

    case 'question':
      return (
        <QuestionCard
          questionId={message.questionId}
          questions={message.questions as Question[]}
          answers={message.answers}
          status={message.status}
        />
      )

    default:
      return null
  }
}
