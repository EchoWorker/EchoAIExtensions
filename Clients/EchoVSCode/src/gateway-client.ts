/**
 * gateway-client.ts — Node.js WebSocket JSON-RPC 2.0 client for EchoAI gateway.
 *
 * Port of EchoWork's echobot-client.ts for the VS Code extension host (Node.js).
 * Uses the `ws` npm package instead of browser WebSocket.
 */

import WebSocket from 'ws'
import type {
  SessionInfo,
  HistoryResult,
  ModelInfo,
  ChatCompletionsOpts,
  SlashBlock,
} from './protocol'

// ── Internals ───────────────────────────────────────────────────────────────

interface PendingRequest {
  resolve(v: unknown): void
  reject(e: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface PendingTurn {
  resolve(): void
  reject(e?: Error): void
}

const REQUEST_TIMEOUT = 30_000
const TURN_TIMEOUT = 600_000 // 10 min max turn

// ═════════════════════════════════════════════════════════════════════════════

export class GatewayClient {
  private ws: WebSocket | null = null
  private nextId = 1
  private pendingRequests = new Map<number, PendingRequest>()
  private pendingTurns = new Map<string, PendingTurn>()
  private sessionTurnIds = new Map<string, string>()

  private authToken = ''
  private pluginName = ''

  private log: (msg: string, ...args: unknown[]) => void

  // ── Public callbacks ────────────────────────────────────────────────────

  /** Called for every chat.event notification, routed by session_key. */
  onChatEvent: ((sessionKey: string, params: Record<string, unknown>) => void) | null = null

  /** Called when the WebSocket closes (for any reason). */
  onDisconnect: (() => void) | null = null

  constructor(logger?: (msg: string, ...args: unknown[]) => void) {
    this.log = logger ?? ((...args) => console.log('[GatewayClient]', ...args))
  }

  // ── Connection ──────────────────────────────────────────────────────────

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  setCredentials(token: string, pluginName: string): void {
    this.authToken = token
    this.pluginName = pluginName
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        try { this.ws.close() } catch { /* ignore */ }
      }

      const ws = new WebSocket(url)
      let settled = false

      ws.on('open', () => {
        this.ws = ws
        settled = true
        this.log('Connected to', url)
        resolve()
      })

      ws.on('error', (err: Error) => {
        if (!settled) {
          settled = true
          reject(err)
        }
      })

      ws.on('close', () => {
        const wasConnected = this.ws === ws
        if (this.ws === ws) {
          this.ws = null
        }
        // Reject all pending requests
        for (const [id, req] of this.pendingRequests) {
          clearTimeout(req.timer)
          req.reject(new Error('Connection closed'))
          this.pendingRequests.delete(id)
        }
        // Reject all pending turns
        for (const [tid, pt] of this.pendingTurns) {
          pt.reject(new Error('Connection closed'))
          this.pendingTurns.delete(tid)
        }
        this.sessionTurnIds.clear()
        if (wasConnected) {
          this.onDisconnect?.()
        }
        if (!settled) {
          settled = true
          reject(new Error('Connection closed before open'))
        }
      })

      ws.on('message', (data: WebSocket.Data) => {
        this._onMessage(data.toString())
      })
    })
  }

  disconnect(): void {
    if (this.ws) {
      try { this.ws.close() } catch { /* ignore */ }
      this.ws = null
    }
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  async authenticate(): Promise<void> {
    if (this.authToken) {
      await this._rpc('auth', { token: this.authToken })
    }
    if (this.pluginName) {
      await this._rpc('plugin.connect', {
        plugin_name: this.pluginName,
        plugin_type: 'client',
      })
    }
  }

  // ── Session RPCs ────────────────────────────────────────────────────────

  async listSessions(): Promise<SessionInfo[]> {
    const params: Record<string, unknown> = {}
    if (this.pluginName) params.plugin_name = this.pluginName
    const result = await this._rpc('session.list', params)
    // Gateway returns Value::Array directly, not wrapped in { sessions: [...] }
    if (Array.isArray(result)) return result as SessionInfo[]
    // Defensive fallback in case wire format changes
    if (result && typeof result === 'object' && Array.isArray((result as { sessions?: SessionInfo[] }).sessions)) {
      return (result as { sessions: SessionInfo[] }).sessions
    }
    return []
  }

  async getHistory(sessionKey: string, cursor?: string): Promise<HistoryResult> {
    const params: Record<string, unknown> = { session_key: sessionKey }
    if (cursor) params.cursor = cursor
    return await this._rpc('session.history', params) as HistoryResult
  }

  async closeSession(sessionKey: string): Promise<void> {
    await this._rpc('session.close', { session_key: sessionKey })
  }

  async deleteSession(sessionKey: string): Promise<void> {
    await this._rpc('session.delete', { session_key: sessionKey })
  }

  async renameSession(sessionKey: string, name: string): Promise<void> {
    await this._rpc('session.rename', { session_key: sessionKey, name })
  }

  async subscribeSessions(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    await this._rpc('chat.subscribe', { session_keys: keys })
  }

  async unsubscribeSessions(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    await this._rpc('chat.unsubscribe', { session_keys: keys })
  }

  // ── Chat RPCs ───────────────────────────────────────────────────────────

  async chatCompletions(
    sessionKey: string,
    content: string,
    opts: ChatCompletionsOpts = {},
  ): Promise<{ session_key: string; turn_id: string }> {
    const params: Record<string, unknown> = {
      session_key: sessionKey,
      content,
    }
    if (opts.media && opts.media.length > 0) params.media = opts.media
    if (opts.selectedFile) params.selected_file = opts.selectedFile
    if (opts.workspace) params.workspace = opts.workspace
    if (opts.model) params.model = opts.model
    if (opts.modes && opts.modes.length > 0) params.modes = opts.modes
    if (opts.pluginName) params.plugin_name = opts.pluginName
    if (opts.userMsgId) params.user_msg_id = opts.userMsgId
    if (opts.slashCommand) params.slash_command = opts.slashCommand
    if (opts.slashBlocks && opts.slashBlocks.length > 0) params.slash_blocks = opts.slashBlocks

    const result = await this._rpc('chat.completions', params, TURN_TIMEOUT) as {
      session_key: string
      turn_id: string
    }

    // Track turn for this session
    this.sessionTurnIds.set(result.session_key, result.turn_id)

    // Register pending turn (resolved by _handleChatEvent on turn/end)
    const timer = setTimeout(() => {
      this.pendingTurns.delete(result.turn_id)
    }, TURN_TIMEOUT)
    this.pendingTurns.set(result.turn_id, {
      resolve: () => { clearTimeout(timer) },
      reject: () => { clearTimeout(timer) },
    })

    return result
  }

  async enqueueMessage(
    sessionKey: string,
    message: string,
    steerId: string,
    attachments?: string[],
  ): Promise<void> {
    const params: Record<string, unknown> = {
      session_key: sessionKey,
      message,
      steer_id: steerId,
    }
    if (attachments && attachments.length > 0) params.attachments = attachments
    await this._rpc('chat.enqueue', params)
  }

  async cancelTurn(sessionKey: string): Promise<void> {
    await this._rpc('chat.cancel', { session_key: sessionKey })
  }

  // ── Model RPCs ──────────────────────────────────────────────────────────

  async listModels(): Promise<{ models: ModelInfo[]; default_model: string }> {
    const result = await this._rpc('model.list', {}) as {
      models: Array<{ id: string; provider?: string }>
      default_model: string
    }
    const models = (result.models ?? []).filter((m) => m.id)
    return { models, default_model: result.default_model ?? '' }
  }

  async setModel(sessionKey: string, model: string): Promise<void> {
    await this._rpc('model.set', { session_key: sessionKey, model })
  }

  // ── Question RPCs ─────────────────────────────────────────────────────

  async answerQuestion(
    sessionKey: string,
    questionId: string,
    answers: Record<string, string | string[]>,
  ): Promise<void> {
    await this._rpc('question.answer', {
      session_key: sessionKey,
      question_id: questionId,
      answers,
    })
  }

  // ── Background task RPCs ──────────────────────────────────────────────

  async cancelBackgroundTask(sessionKey: string, taskId: string): Promise<void> {
    await this._rpc('background.cancel', {
      session_key: sessionKey,
      task_id: taskId,
    })
  }

  // ── Message handling ──────────────────────────────────────────────────

  private _onMessage(data: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    if (!msg || msg.jsonrpc !== '2.0') return

    // Response (has id)
    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.pendingRequests.get(msg.id as number)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pendingRequests.delete(msg.id as number)

      if (msg.error) {
        const err = msg.error as { message?: string }
        pending.reject(new Error(err.message ?? 'JSON-RPC error'))
      } else {
        pending.resolve(msg.result)
      }
      return
    }

    // Notification (no id, has method)
    if (msg.method) {
      this._onNotification(
        msg.method as string,
        (msg.params ?? {}) as Record<string, unknown>,
      )
    }
  }

  private _onNotification(method: string, params: Record<string, unknown>): void {
    if (method === 'chat.event') {
      this._handleChatEvent(params)
    }
  }

  private _handleChatEvent(params: Record<string, unknown>): void {
    const sessionKey = params.session_key as string | undefined
    const turnId = params.turn_id as string | undefined
    const type = params.type as string | undefined
    const event = params.event as string | undefined

    // turn/end — resolve pending turn promise
    if (type === 'turn' && event === 'end' && turnId) {
      const status = (params.status as string) ?? 'done'
      for (const [sk, tid] of this.sessionTurnIds) {
        if (tid === turnId) {
          this.sessionTurnIds.delete(sk)
          break
        }
      }
      const pt = this.pendingTurns.get(turnId)
      if (pt) {
        pt.resolve()
        this.pendingTurns.delete(turnId)
      }
    }

    // Forward to callback
    if (sessionKey) {
      this.onChatEvent?.(sessionKey, params)
    }
  }

  // ── RPC helper ────────────────────────────────────────────────────────

  private _rpc(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT,
  ): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Not connected'))
    }

    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params, id })

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, timeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timer })
      this.ws!.send(payload, (err) => {
        if (err) {
          clearTimeout(timer)
          this.pendingRequests.delete(id)
          reject(err)
        }
      })
    })
  }
}
