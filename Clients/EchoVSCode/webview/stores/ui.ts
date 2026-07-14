/**
 * ui.ts — UI preferences (centered layout, theme, etc).
 */

import { create } from 'zustand'

interface UIState {
  chatContentCentered: boolean
}

interface UIActions {
  setChatContentCentered: (v: boolean) => void
}

export const useUIStore = create<UIState & UIActions>()((set) => ({
  chatContentCentered: true,
  setChatContentCentered: (v) => set({ chatContentCentered: v }),
}))
