import React from 'react'
import { useModelStore } from '../stores'
import { postToHost } from '../vscode'

interface Props { sessionKey: string }

export function ModelSelector({ sessionKey }: Props) {
  const models = useModelStore((s) => s.availableModels)
  const defaultModel = useModelStore((s) => s.defaultModel)
  const selected = useModelStore((s) => s.selectedModel[sessionKey] || s.defaultModel)

  if (models.length === 0) return null

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const model = e.target.value
    useModelStore.getState().setSelectedModel(sessionKey, model)
    postToHost({ type: 'set-model', sessionKey, model })
  }

  return (
    <select className="eb-model-selector" value={selected} onChange={handleChange} title="Select model">
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.id}{m.id === defaultModel ? ' ★' : ''}
        </option>
      ))}
    </select>
  )
}
