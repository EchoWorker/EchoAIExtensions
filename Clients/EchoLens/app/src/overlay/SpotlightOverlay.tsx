import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  buildPrompt,
  capturePerception,
  getCachedPerception,
  hideOverlay,
  readGatewayLock,
  type CapturedContext,
} from '@/core/perception'
import { GatewayClient } from '@/core/gateway-client'
import { useConversation } from '@/stores/conversation'
import { useSettings } from '@/stores/settings'
import { InputBar } from './InputBar'
import { AnswerCard } from './AnswerCard'
import { ScopeSwitcher } from './ScopeSwitcher'
import { PerceptionPreview } from './PerceptionPreview'
import { SettingsPanel } from '@/settings/SettingsPanel'

// One gateway client for the app's lifetime.
const gateway = new GatewayClient()

export function SpotlightOverlay() {
  const [ctx, setCtx] = useState<CapturedContext | null>(null)
  // The (possibly user-edited) screen-context XML actually sent to the AI.
  const [contextXml, setContextXml] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const conv = useConversation()
  const settings = useSettings()

  // ── one-time setup: load settings, connect gateway ──────────────────────────
  useEffect(() => {
    settings.load()
    connectGateway()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connectGateway() {
    try {
      const creds = await readGatewayLock()
      await gateway.connect(creds)
      useConversation.getState().setConnected(true)
    } catch (e) {
      useConversation.getState().setConnected(
        false,
        e instanceof Error ? e.message : 'EchoAI gateway not reachable',
      )
    }
  }

  // ── react to hotkey-triggered capture ───────────────────────────────────────
  useEffect(() => {
    const unlistenReady = listen<CapturedContext>('perception-ready', (e) => {
      applyCapture(e.payload)
      conv.newSession()
      focusInput()
    })
    const unlistenErr = listen<string>('perception-error', (e) => {
      setCtx(null)
      setContextXml('')
      useConversation.getState().setError(`Couldn't read the screen: ${e.payload}`)
      focusInput()
    })
    const unlistenSettings = listen('open-settings', () => setShowSettings(true))

    return () => {
      unlistenReady.then((f) => f())
      unlistenErr.then((f) => f())
      unlistenSettings.then((f) => f())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyCapture(c: CapturedContext) {
    setCtx(c)
    setContextXml(c.xml)
  }

  function focusInput() {
    setShowSettings(false)
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  // ── re-capture when the user switches scope ─────────────────────────────────
  async function onScopeChange(scope: string) {
    await settings.setScope(scope)
    try {
      const c = await capturePerception(scope)
      applyCapture(c)
    } catch (e) {
      useConversation.getState().setError(
        e instanceof Error ? e.message : 'capture failed',
      )
    }
  }

  // ── submit a question ───────────────────────────────────────────────────────
  async function onSubmit(question: string) {
    if (!question.trim()) return
    if (!conv.connected) {
      conv.setError('Not connected to EchoAI gateway. Start EchoWork first.')
      return
    }
    conv.resetAnswer()
    conv.setPhase('answering')

    const prompt = ctx
      ? buildPrompt(ctx, contextXml, question)
      : question // no screen context (capture failed) — still let them ask

    try {
      await gateway.ask(conv.sessionKey, prompt, {
        onText: (delta) => useConversation.getState().appendAnswer(delta),
        onEnd: (status) => {
          const st = useConversation.getState()
          st.setPhase(status === 'error' ? 'error' : 'idle')
        },
        onError: (msg) => useConversation.getState().setError(msg),
      }, settings.model ? { model: settings.model } : undefined)
    } catch (e) {
      conv.setError(e instanceof Error ? e.message : 'request failed')
    }
  }

  // Esc dismisses (cloaks) the overlay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showSettings) {
          setShowSettings(false)
        } else {
          gateway.cancel()
          hideOverlay()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showSettings])

  // On first mount (e.g. dev open without hotkey), try the cached capture.
  useEffect(() => {
    getCachedPerception().then((c) => {
      if (c) applyCapture(c)
    })
  }, [])

  return (
    <div className="h-screen w-screen p-3" data-tauri-drag-region>
      <div className="overlay-card flex h-full flex-col overflow-hidden">
        {/* Header: scope switcher + connection status + settings gear */}
        <Header
          ctx={ctx}
          connected={conv.connected}
          connectionError={conv.connectionError}
          scope={settings.scope}
          onScopeChange={onScopeChange}
          onToggleSettings={() => setShowSettings((s) => !s)}
        />

        {showSettings ? (
          <SettingsPanel onClose={() => setShowSettings(false)} />
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4">
              {ctx && (
                <PerceptionPreview
                  ctx={ctx}
                  xml={contextXml}
                  onChange={setContextXml}
                />
              )}
              <AnswerCard />
            </div>
            <InputBar ref={inputRef} onSubmit={onSubmit} />
          </>
        )}
      </div>
    </div>
  )
}

function Header(props: {
  ctx: CapturedContext | null
  connected: boolean
  connectionError: string
  scope: string
  onScopeChange(scope: string): void
  onToggleSettings(): void
}) {
  const { ctx, connected, connectionError, scope, onScopeChange, onToggleSettings } = props
  return (
    <div
      className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5"
      data-tauri-drag-region
    >
      <span className="text-sm font-semibold text-accent">EchoLens</span>
      <ScopeSwitcher scope={scope} onChange={onScopeChange} />
      <div className="flex-1" />
      {ctx && (
        <span className="truncate text-xs text-white/50" title={ctx.title}>
          {ctx.node_count} elements · {ctx.title}
        </span>
      )}
      <span
        className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`}
        title={connected ? 'Connected to EchoAI' : connectionError || 'Connecting…'}
      />
      <button
        className="text-white/50 hover:text-white"
        onClick={onToggleSettings}
        title="Settings"
      >
        ⚙
      </button>
    </div>
  )
}
