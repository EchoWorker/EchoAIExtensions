/**
 * connection.ts — Connection status store.
 */

import { create } from 'zustand'

interface ConnectionState {
  status: 'connected' | 'connecting' | 'disconnected'
  error: string | null
}

interface ConnectionActions {
  setStatus: (status: ConnectionState['status']) => void
  setError: (error: string | null) => void
}

export const useConnectionStore = create<ConnectionState & ConnectionActions>()((set) => ({
  status: 'disconnected',
  error: null,

  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
}))
