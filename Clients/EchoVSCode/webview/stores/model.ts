/**
 * model.ts — Model list store.
 */

import { create } from 'zustand'

export interface ModelInfo {
  id: string
  provider?: string
}

interface ModelState {
  availableModels: ModelInfo[]
  defaultModel: string
  selectedModel: Record<string, string> // sessionKey → model
}

interface ModelActions {
  setAvailableModels: (models: ModelInfo[], defaultModel: string) => void
  setSelectedModel: (sessionKey: string, model: string) => void
}

export const useModelStore = create<ModelState & ModelActions>()((set) => ({
  availableModels: [],
  defaultModel: '',
  selectedModel: {},

  setAvailableModels: (models, defaultModel) => set({ availableModels: models, defaultModel }),

  setSelectedModel: (sessionKey, model) => {
    set((s) => ({
      selectedModel: { ...s.selectedModel, [sessionKey]: model },
    }))
  },
}))
