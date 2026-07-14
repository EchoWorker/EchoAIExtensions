import React from 'react'
import { ChatPanel } from './components/ChatPanel'
import { useTabPersistence } from './hooks/useTabPersistence'

export function App() {
  useTabPersistence()
  return <ChatPanel />
}
