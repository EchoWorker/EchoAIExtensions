import React from 'react'
import { useConnectionStore } from '../stores'

export function ConnectionBanner() {
  const status = useConnectionStore((s) => s.status)
  const error = useConnectionStore((s) => s.error)

  return (
    <div className="eb-conn-banner">
      <span className="eb-conn-banner-icon">{status === 'connecting' ? '⟳' : '⚠'}</span>
      <div className="eb-conn-banner-text">
        {status === 'connecting' ? 'Connecting to EchoAI…' : 'Disconnected from EchoAI'}
        {error && <div className="eb-conn-banner-error">{error}</div>}
      </div>
    </div>
  )
}
