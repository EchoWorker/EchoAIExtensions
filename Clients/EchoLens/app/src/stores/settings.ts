/**
 * Settings store — mirrors the Rust-persisted settings (hotkey / scope / model).
 */

import { create } from 'zustand'
import { readSettings, writeSettings, setSummonHotkey, type Settings } from '@/core/perception'

interface SettingsState extends Settings {
  loaded: boolean
  load(): Promise<void>
  setScope(scope: string): Promise<void>
  setModel(model: string): Promise<void>
  setHotkey(hotkey: string): Promise<string | null>
}

export const useSettings = create<SettingsState>((set, get) => ({
  hotkey: 'Ctrl+Shift+Space',
  scope: 'window',
  model: '',
  loaded: false,

  load: async () => {
    try {
      const s = await readSettings()
      set({ ...s, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  setScope: async (scope) => {
    set({ scope })
    await writeSettings({ hotkey: get().hotkey, scope, model: get().model })
  },

  setModel: async (model) => {
    set({ model })
    await writeSettings({ hotkey: get().hotkey, scope: get().scope, model })
  },

  // Returns an error string if the hotkey couldn't be registered, else null.
  setHotkey: async (hotkey) => {
    try {
      await setSummonHotkey(hotkey)
      set({ hotkey })
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  },
}))
