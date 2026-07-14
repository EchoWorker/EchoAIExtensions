/**
 * connection-manager.ts — Reads gateway.lock + manages auto-reconnect.
 *
 * Mirrors EchoWork's ConnectionController logic:
 *   1. Read ~/.echoai/gateway.lock → get url + token
 *   2. Connect WS → auth → plugin.connect
 *   3. Sync sessions + models
 *   4. On disconnect → 1s retry
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { GatewayClient } from './gateway-client'
import type { SessionInfo, ModelInfo } from './protocol'

export interface GatewayLock {
  url: string
  token: string
  pid?: number
}

export interface ConnectionManagerCallbacks {
  onStatusChange: (status: 'connected' | 'connecting' | 'disconnected') => void
  onError: (error: string | null) => void
  onSessions: (sessions: SessionInfo[]) => void
  onModels: (models: ModelInfo[], defaultModel: string) => void
  onChatEvent: (sessionKey: string, params: Record<string, unknown>) => void
  onReconnected?: () => void
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000
const PLUGIN_NAME = 'echoai.vscode'

export class ConnectionManager {
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectInFlight = false
  private desired: 'connected' | 'disconnected' = 'connected'
  private disposed = false
  private reconnectAttempts = 0

  constructor(
    public readonly client: GatewayClient,
    private callbacks: ConnectionManagerCallbacks,
    private log: (msg: string, ...args: unknown[]) => void = console.log,
  ) {
    client.onDisconnect = () => {
      if (this.disposed) return
      this.callbacks.onStatusChange('disconnected')
      this.scheduleReconnect()
    }

    client.onChatEvent = (sessionKey, params) => {
      this.callbacks.onChatEvent(sessionKey, params)
    }
  }

  // ── Public ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.desired = 'connected'
    await this.tryConnect()
  }

  stop(): void {
    this.desired = 'disconnected'
    this.clearReconnectTimer()
    this.client.disconnect()
    this.callbacks.onStatusChange('disconnected')
  }

  dispose(): void {
    this.disposed = true
    this.stop()
  }

  // ── Subscribe opened sessions ─────────────────────────────────────────

  async subscribeSession(key: string): Promise<void> {
    if (this.client.connected) {
      try {
        await this.client.subscribeSessions([key])
      } catch (err) {
        this.log('Subscribe failed:', err)
      }
    }
  }

  async unsubscribeSession(key: string): Promise<void> {
    if (this.client.connected) {
      try {
        await this.client.unsubscribeSessions([key])
      } catch (err) {
        this.log('Unsubscribe failed:', err)
      }
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async tryConnect(): Promise<void> {
    if (this.connectInFlight || this.disposed) return
    if (this.desired !== 'connected') return

    this.connectInFlight = true
    this.callbacks.onStatusChange('connecting')
    this.callbacks.onError(null)

    try {
      const lock = await this.readGatewayLock()
      if (!lock) {
        this.callbacks.onError('gateway.lock not found')
        this.scheduleReconnect()
        return
      }

      this.client.setCredentials(lock.token, PLUGIN_NAME)
      await this.client.connect(lock.url)
      await this.client.authenticate()

      // Sync sessions
      const sessions = await this.client.listSessions()
      this.log(`[sessions] listSessions returned ${sessions.length} entries; sample workspaces: ${sessions.slice(0, 3).map(s => s.workspace ?? '<none>').join(' | ')}`)
      this.callbacks.onSessions(sessions)

      // Sync models
      const { models, default_model } = await this.client.listModels()
      this.callbacks.onModels(models, default_model)

      this.reconnectAttempts = 0 // Reset on success
      this.callbacks.onStatusChange('connected')
      this.callbacks.onError(null)
      this.callbacks.onReconnected?.()
      this.log('Connected to gateway at', lock.url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed'
      this.log('Connect failed:', msg)
      this.callbacks.onError(msg)
      this.client.disconnect()
      this.callbacks.onStatusChange('disconnected')
      this.scheduleReconnect()
    } finally {
      this.connectInFlight = false
    }
  }

  private async readGatewayLock(): Promise<GatewayLock | null> {
    const home = os.homedir()
    const isDev = process.env.ECHOAI_DEV === '1'
    const echoaiDir = isDev ? '.echoai.dev' : '.echoai'
    const lockPath = path.join(home, echoaiDir, 'gateway.lock')

    try {
      const content = await fs.readFile(lockPath, 'utf-8')
      const lock = JSON.parse(content) as GatewayLock
      if (!lock.url) return null
      return lock
    } catch {
      return null
    }
  }

  private getReconnectDelay(): number {
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts), RECONNECT_MAX_MS)
    this.reconnectAttempts++
    return delay
  }

  private scheduleReconnect(): void {
    if (this.desired !== 'connected') return
    if (this.client.connected) return
    if (this.connectInFlight || this.reconnectTimer) return
    if (this.disposed) return

    this.callbacks.onStatusChange('connecting')
    const delay = this.getReconnectDelay()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.tryConnect()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
